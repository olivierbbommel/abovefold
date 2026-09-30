"""Orchestration, in two halves.

INGESTION is free: fetch, extract, store, prefilter. It advances the cursor.
AI PROCESSING is paid: embed, cluster, summarise, score. It works off a queue
(`app.article.ai_state = 'pending'`) rather than off the batch just fetched.

That split is deliberate. Previously an embed failure or a tripped cost cap
left articles committed with no embedding and no summary, and because the
cursor had moved past them nothing ever looked at them again. Now an article
leaves the queue only once its embedding is stored, so every failure mode , 
rate limit, cap, crash, is simply retried on the next run.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import embed as embed_mod
from . import extract as extract_mod
from . import prefilter as prefilter_mod
from . import score as score_mod
from . import summarize as summarize_mod

log = logging.getLogger("abovefold.pipeline")

FETCH_LIMIT = 100
# Some feeds publish their whole archive: OpenAI's carries 1,149 entries back
# to 2015. The worker walks entries in cursor order, so without this it spends
# real money summarising decade-old posts before it ever reaches today's news.
# Old entries still advance the cursor; they are simply never stored or paid for.
MAX_AGE_DAYS = 30
AI_BATCH_LIMIT = 100
SUMMARY_BATCH_LIMIT = 50
COLD_START_RELEVANCE = 0.5
COLD_START_AFFINITY = 0.5

# --- personalisation (spec §4) ---------------------------------------------
#
# A "genuine read" is an open with dwell over this threshold, matches the
# spec's "centroid of the last 200 articles opened with dwell > 20s".
DWELL_THRESHOLD_MS = 20_000
RELEVANCE_CENTROID_LIMIT = 200
# The personalisation gate. Below this many genuine reads, a cosine to the
# "interest centroid" is a coin flip dressed up as a number, 20 is a round
# floor at 10% of the centroid window (RELEVANCE_CENTROID_LIMIT above), enough
# that the centroid isn't dominated by one or two outlier articles. Real data
# volume as of 2026-08-27 is 4 rows in app.interaction total, well under this,
# so personalisation stays off; never seed test interactions into a real instance.
MIN_RELEVANCE_INTERACTIONS = 20
# Bayesian smoothing prior strength (the "m" in (opens + m*mean)/(total + m))
# for a feed's own open rate. At exactly this many interactions a feed's own
# rate and the global mean weigh equally; below it the global mean dominates,
# above it the feed's own signal does, so a feed with two opens is pulled
# hard toward the mean without ever being hard-cut to a placeholder. Chosen
# as half of MIN_RELEVANCE_INTERACTIONS: affinity needs less evidence than a
# full centroid because it's one scalar per feed, not a 1536-dim average.
MIN_FEED_INTERACTIONS = 10


@dataclass
class RunReport:
    fetched: int = 0
    skipped_existing: int = 0
    skipped_archive: int = 0
    prefiltered_out: int = 0
    embedded: int = 0
    clustered: int = 0
    summarised: int = 0
    scored: int = 0
    cost_usd: float = 0.0
    cap_reached: bool = False
    errors: list[str] = field(default_factory=list)


@dataclass
class Clients:
    miniflux: object
    extract_fn: object = extract_mod.extract
    embed_fn: object = embed_mod.embed_batch_with_cost
    summarize_fn: object = summarize_mod.summarize


def _age_hours(published_at: datetime, now: datetime) -> float:
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    return max(0.0, (now - published_at).total_seconds() / 3600.0)


def _clean(text: str | None) -> str:
    """Postgres text cannot hold NUL bytes; one in a feed used to abort the
    whole transaction and stall ingestion permanently."""
    return (text or "").replace("\x00", "")


# --------------------------------------------------------------------------
# Ingestion, free
# --------------------------------------------------------------------------

def ingest(store, clients: Clients, muted_feed_ids: set[int], report: RunReport,
           now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    cursor = store.read_cursor()
    entries = clients.miniflux.fetch_entries(cursor, limit=FETCH_LIMIT)
    report.fetched = len(entries)
    if not entries:
        return

    known = store.existing_miniflux_ids([e.id for e in entries])

    for entry in entries:
        if entry.id in known:
            report.skipped_existing += 1
            continue
        if _age_hours(entry.published_at, now) > MAX_AGE_DAYS * 24:
            report.skipped_archive += 1
            continue

        try:
            ex = clients.extract_fn(entry.url, entry.content)
            lead = extract_mod.clean_image_url(
                ex.lead_image or (entry.enclosure_urls[0] if entry.enclosure_urls else None)
            )
            article_id = store.insert_article(
                miniflux_id=entry.id, feed_id=entry.feed_id, feed_title=entry.feed_title,
                url=entry.url, title=_clean(entry.title), author=entry.author,
                published_at=entry.published_at, extracted_text=_clean(ex.text),
                extract_status=ex.status, lead_image=lead, word_count=ex.word_count,
            )

            if ex.status == "failed":
                # The fetch failed, so the only text we have is the RSS teaser.
                # Embedding and summarising that is paying full price for a stub.
                store.set_ai_state(article_id, "skipped")
                report.prefiltered_out += 1
            store.commit()          # per-entry boundary: one bad row cannot undo the rest
        except Exception as exc:
            store.rollback()
            report.errors.append(f"ingest {entry.id}: {exc}")
            # The cursor is about to move past this entry, so failing here
            # used to lose the article for good (16 Hacker News items were
            # lost to one trafilatura crash). Keep it with its feed text,
            # skipped for AI like any failed fetch.
            try:
                teaser = extract_mod._html_to_text(entry.content or "")
                # Postgres rejects NUL in text; strip it from every field in
                # case that is what failed the first insert.
                article_id = store.insert_article(
                    miniflux_id=entry.id, feed_id=entry.feed_id, feed_title=_clean(entry.feed_title) or None,
                    url=_clean(entry.url), title=_clean(entry.title),
                    author=_clean(entry.author) or None,
                    published_at=entry.published_at, extracted_text=_clean(teaser),
                    extract_status="failed", lead_image=None,
                    word_count=extract_mod._word_count(teaser),
                )
                store.set_ai_state(article_id, "skipped")
                store.commit()
            except Exception as again:
                store.rollback()
                report.errors.append(f"ingest fallback {entry.id}: {again}")

    store.write_cursor(max(e.id for e in entries))
    store.commit()


# --------------------------------------------------------------------------
# AI processing, paid, queue-driven
# --------------------------------------------------------------------------

def process_ai(store, clients: Clients, settings, report: RunReport,
               now: datetime, muted_feed_ids: set[int] | None = None,
               rescore_due: bool = True) -> None:
    muted_feed_ids = muted_feed_ids or set()
    queued = store.pending_ai_articles(limit=AI_BATCH_LIMIT)

    # The prefilter guards the QUEUE, not just ingestion. Backlog articles
    # (re-queued after a cap, a failure, or a threshold change) reach the paid
    # calls through here too, and were previously bypassing the check entirely , 
    # 10-word stubs were being embedded and summarised at full price.
    pending = []
    for row in queued:
        ok, reason = prefilter_mod.should_process(
            row["word_count"] or 0, row["title"], row["feed_id"], muted_feed_ids
        )
        if ok:
            pending.append(row)
        else:
            try:
                store.set_ai_state(row["id"], "skipped")
                store.commit()
            except Exception:
                store.rollback()
            report.prefiltered_out += 1
            log.info("prefiltered article=%s reason=%s", row["id"], reason)

    if pending:
        texts = [f"{r['title']}\n\n{r['extracted_text']}" for r in pending]
        try:
            vectors, embed_cost = clients.embed_fn(texts, settings)
        except Exception as exc:
            report.errors.append(f"embed: {exc}")
            store.rollback()
            vectors, embed_cost = [], 0.0

        if vectors:
            if len(vectors) != len(pending):
                report.errors.append(
                    f"embed returned {len(vectors)} vectors for {len(pending)} articles"
                )
            else:
                per_article = embed_cost / len(vectors) if vectors else 0.0
                report.cost_usd += embed_cost
                for row, vec in zip(pending, vectors):
                    try:
                        store.store_embedding(row["id"], vec, settings.embed_model, per_article)
                        hit = store.cluster_candidates(row["id"])
                        if hit:
                            cluster_id, similarity = hit
                        else:
                            cluster_id = store.create_cluster(row["id"])
                            similarity = 1.0
                        store.assign_cluster(row["id"], cluster_id, similarity)
                        store.set_ai_state(row["id"], "done")
                        store.commit()
                        report.embedded += 1
                        report.clustered += 1
                    except Exception as exc:
                        store.rollback()
                        report.errors.append(f"store {row['id']}: {exc}")

    # --- summaries: cap-aware, and resumable across runs -------------------
    spend = store.month_to_date_spend()
    if spend >= settings.monthly_cost_cap_usd:
        report.cap_reached = True
        log.warning("cost cap reached ($%.4f >= $%.2f), summaries paused, ingestion continues",
                    spend, settings.monthly_cost_cap_usd)
    else:
        for row in store.articles_needing_summary(limit=SUMMARY_BATCH_LIMIT):
            if spend >= settings.monthly_cost_cap_usd:
                report.cap_reached = True
                break
            try:
                s = clients.summarize_fn(row["title"], row["extracted_text"], settings)
                store.store_summary(row["id"], s, settings.summary_model)
                store.commit()
                report.summarised += 1
                report.cost_usd += s.cost_usd
                spend += s.cost_usd
            except Exception as exc:
                store.rollback()
                try:
                    store.record_summary_attempt(row["id"])   # bounded retries
                    store.commit()
                except Exception:
                    store.rollback()
                report.errors.append(f"summarize {row['id']}: {exc}")

    # Rescoring compares every article with every other (about 7 minutes at
    # 7,600 articles), so it runs when this pass added something, or when the
    # caller says it is due (recency decay and new reading still move scores).
    if report.embedded or report.summarised or rescore_due:
        report.scored = rescore_all(store, now=now)


def run_once(store, clients: Clients, settings, muted_feed_ids=None, now=None,
             rescore_due: bool = True) -> RunReport:
    report = RunReport()
    now = now or datetime.now(timezone.utc)
    muted = muted_feed_ids or set()
    ingest(store, clients, muted, report, now)
    process_ai(store, clients, settings, report, now, muted, rescore_due=rescore_due)
    return report


def _centroid(vectors: list[list[float]]) -> list[float] | None:
    """Mean of a list of equal-length vectors, or None for an empty list.

    Pure, no I/O, no clock, so it's testable directly with plain lists
    rather than through a fake database.
    """
    if not vectors:
        return None
    dims = len(vectors[0])
    sums = [0.0] * dims
    for v in vectors:
        for i, x in enumerate(v):
            sums[i] += x
    return [x / len(vectors) for x in sums]


def _global_mean(counts: dict[int, tuple[int, int]]) -> float | None:
    """Overall open rate across every feed with any interaction history, or
    None when there is no interaction data at all (sum_total == 0).

    Shared by `_smoothed_source_affinity` (the prior every feed's own rate is
    pulled toward) and `rescore_all` (the fallback for a feed that is absent
    from the counts map entirely, see the module-level note there on why
    that fallback must be this, and not the cold-start placeholder).
    """
    sum_total = sum(t for _, t in counts.values())
    if sum_total == 0:
        return None
    sum_opens = sum(o for o, _ in counts.values())
    return sum_opens / sum_total


def _smoothed_source_affinity(
    counts: dict[int, tuple[int, int]], prior_strength: float
) -> dict[int, float]:
    """Bayesian-smoothed open rate per feed: (opens + m*global_mean) / (total + m).

    `counts` is {feed_id: (opens, total)}, raw interaction counts, no I/O.
    `prior_strength` (m) is the pseudo-count of "average" interactions mixed
    into every feed's total; it's what stops a feed with two opens (a 100%
    open rate on n=2) from outranking every established source. Returns {}
    when there is no interaction data at all (sum_total == 0), callers must
    fall back to the cold-start placeholder for any feed missing from the map.
    """
    global_mean = _global_mean(counts)
    if global_mean is None:
        return {}
    return {
        feed_id: (opens + prior_strength * global_mean) / (total + prior_strength)
        for feed_id, (opens, total) in counts.items()
    }


def rescore_all(store, now=None) -> int:
    """Recompute every score from stored data. Zero API spend, novelty comes
    from pgvector, so this and run_once agree by construction (process_ai's
    tail call is literally this function, not a re-implementation of it).

    Personalisation (spec §4: real relevance + source_affinity) only turns on
    once there is enough interaction history to trust it, see
    MIN_RELEVANCE_INTERACTIONS. Below that, this degrades to exactly the
    cold-start behaviour it always had: neutral placeholders, personalised=False.
    """
    now = now or datetime.now(timezone.utc)

    qualifying = store.qualifying_read_count(DWELL_THRESHOLD_MS)
    personalised = qualifying >= MIN_RELEVANCE_INTERACTIONS

    centroid = None
    affinity: dict[int, float] = {}
    # Default for a feed that is absent from the affinity map entirely (no
    # interaction rows at all). This must be the global mean, not the
    # cold-start placeholder: every feed WITH history is Bayesian-smoothed
    # toward the mean (see _smoothed_source_affinity), which in any real
    # history sits well below 0.5 because it is opens over ALL interactions,
    # archived/skipped included. Leaving the default at 0.5 gave a feed you
    # have never touched a standing bonus over sources you actively skip.
    default_affinity = COLD_START_AFFINITY
    if personalised:
        centroid = _centroid(
            store.recent_read_embeddings(DWELL_THRESHOLD_MS, RELEVANCE_CENTROID_LIMIT)
        )
        # Interactions can outnumber embeddings (an article's embedding row
        # can go missing after a failed re-embed, though that path doesn't
        # exist today), if every qualifying read ended up embedding-less,
        # there is nothing to compute a centroid from. Degrade rather than
        # score everything against nothing.
        personalised = centroid is not None
    if personalised:
        counts = store.feed_interaction_counts()
        affinity = _smoothed_source_affinity(counts, MIN_FEED_INTERACTIONS)
        global_mean = _global_mean(counts)
        if global_mean is not None:
            default_affinity = global_mean

    rows = store.scorable_rows(centroid=centroid)
    for r in rows:
        if personalised:
            raw_relevance = r["relevance"]
            relevance = (COLD_START_RELEVANCE if raw_relevance is None
                        else max(0.0, min(1.0, float(raw_relevance))))
            source_affinity = affinity.get(int(r["feed_id"]), default_affinity)
        else:
            relevance = COLD_START_RELEVANCE
            source_affinity = COLD_START_AFFINITY

        feats = score_mod.Features(
            relevance=relevance,
            source_affinity=source_affinity,
            novelty=max(0.0, min(1.0, float(r["novelty"]))),
            age_hours=_age_hours(r["published_at"], now),
            # A learned skip model is the spec'd noise signal, gated at ~500
            # interactions to avoid overfitting (spec §4, "Noise muting").
            # Real volume is nowhere near that (see MIN_RELEVANCE_INTERACTIONS
            # comment above), so the plumbing exists, this field is threaded
            # through end to end, but it honestly has nothing to compute from
            # yet and stays 0.0 rather than fabricate a penalty.
            noise_penalty=0.0,
            cluster_size=int(r["cluster_size"]),
            source_name=r["feed_title"],
            top_topic=r["top_topic"],
            personalised=personalised,
        )
        scored = score_mod.score(feats)
        store.upsert_score(r["id"], scored, scored.reason)
    store.commit()
    return len(rows)
