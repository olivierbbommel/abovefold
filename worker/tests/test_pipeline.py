"""Orchestration tests. No database, no network, a FakeStore and stub clients."""
from datetime import datetime, timedelta, timezone

import pytest

from abovefold_worker.config import Settings
from abovefold_worker.extract import Extraction
from abovefold_worker.miniflux import Entry
from abovefold_worker.pipeline import Clients, run_once
from abovefold_worker.summarize import Summary

NOW = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)

SETTINGS = Settings.from_env({
    "DATABASE_URL": "postgres://x", "MINIFLUX_URL": "http://m",
    "MINIFLUX_API_TOKEN": "t", "OPENROUTER_API_KEY": "k",
    "ABOVEFOLD_MONTHLY_COST_CAP_USD": "5.00",
})


class FakeStore:
    """In-memory Store. Mirrors the real transaction boundaries closely enough
    that a per-article failure is observable."""

    def __init__(self, spent=0.0):
        self.articles = {}          # miniflux_id -> article_id
        self.rows = {}              # article_id -> dict
        self.ai = {}
        self.clusters = {}
        self.assignments = {}
        self.scores = {}
        self.interactions = []      # list of {article_id, action, dwell_ms}
        self.cursor = 0
        self.spent = spent
        self.commits = 0
        self.rollbacks = 0
        self._next_article = 1
        self._next_cluster = 1

    # --- txn ---
    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    # --- ingestion ---
    def existing_miniflux_ids(self, ids):
        return {i for i in ids if i in self.articles}

    def insert_article(self, *, miniflux_id, **kw):
        if miniflux_id in self.articles:
            return self.articles[miniflux_id]
        aid = self._next_article
        self._next_article += 1
        self.articles[miniflux_id] = aid
        self.rows[aid] = {"id": aid, "ai_state": "pending", **kw}
        return aid

    def set_ai_state(self, article_id, state):
        self.rows[article_id]["ai_state"] = state

    def read_cursor(self):
        return self.cursor

    def write_cursor(self, last_entry_id):
        self.cursor = last_entry_id

    # --- queue ---
    def pending_ai_articles(self, limit=100):
        return [
            {"id": r["id"], "feed_id": r.get("feed_id"), "feed_title": r.get("feed_title", ""),
             "title": r.get("title", ""), "url": r.get("url", ""),
             "published_at": r.get("published_at"),
             "extracted_text": r.get("extracted_text", ""),
             "extract_status": r.get("extract_status", "ok"),
             "word_count": r.get("word_count", 0)}
            for r in self.rows.values()
            if r["ai_state"] == "pending" and r.get("extract_status") in ("ok", "fallback")
        ][:limit]

    def articles_needing_summary(self, limit=50, max_attempts=3):
        out = []
        for aid, rec in self.ai.items():
            cid = self.assignments.get(aid, (None, None))[0]
            canonical = self.clusters.get(cid, [None])[0] == aid if cid else False
            if rec.get("summary") is None and canonical and rec.get("attempts", 0) < max_attempts:
                r = self.rows[aid]
                out.append({"id": aid, "title": r.get("title", ""),
                            "extracted_text": r.get("extracted_text", ""),
                            "feed_title": r.get("feed_title", ""), "cluster_id": cid})
        return out[:limit]

    # --- ai writes ---
    def store_embedding(self, article_id, embedding, model, embed_cost):
        self.ai.setdefault(article_id, {"summary": None, "attempts": 0})
        self.ai[article_id].update({"dims": len(embedding), "embed_cost": embed_cost,
                                    "model": model, "vec": list(embedding)})

    def store_summary(self, article_id, summary, model):
        self.ai[article_id].update({"summary": summary.tldr, "cost": summary.cost_usd,
                                    "summary_model": model})
        self.ai[article_id]["attempts"] = self.ai[article_id].get("attempts", 0) + 1
        self.spent += summary.cost_usd

    def record_summary_attempt(self, article_id):
        self.ai[article_id]["attempts"] = self.ai[article_id].get("attempts", 0) + 1

    # --- clustering ---
    def cluster_candidates(self, article_id, hours=48, threshold=0.92):
        """Real cosine against stored vectors, the production path does this in
        SQL, so stubbing it to None would make the dedupe tests prove nothing."""
        from abovefold_worker.dedupe import cosine
        me = self.ai.get(article_id, {}).get("vec")
        if not me:
            return None
        best = None
        for other_id, rec in self.ai.items():
            if other_id == article_id or "vec" not in rec:
                continue
            cid = self.assignments.get(other_id, (None, None))[0]
            if cid is None:
                continue
            sim = cosine(me, rec["vec"])
            if sim >= threshold and (best is None or sim > best[1]):
                best = (cid, sim)
        return best

    def create_cluster(self, canonical_article_id):
        cid = self._next_cluster
        self._next_cluster += 1
        self.clusters[cid] = [canonical_article_id]
        return cid

    def assign_cluster(self, article_id, cluster_id, similarity):
        self.assignments[article_id] = (cluster_id, similarity)
        self.clusters.setdefault(cluster_id, [])
        if article_id not in self.clusters[cluster_id]:
            self.clusters[cluster_id].append(article_id)

    # --- scoring ---
    def scorable_rows(self, centroid=None):
        from abovefold_worker.dedupe import cosine
        out = []
        for aid in self.ai:
            row = self.rows.get(aid, {})
            relevance = None
            if centroid is not None:
                vec = self.ai[aid].get("vec")
                relevance = cosine(vec, centroid) if vec else None
            out.append({
                "id": aid, "published_at": row.get("published_at"),
                "feed_id": row.get("feed_id"),
                "feed_title": row.get("feed_title", ""),
                "novelty": 0.5,
                "cluster_size": len(self.clusters.get(self.assignments.get(aid, (None,))[0], [1])),
                "top_topic": None,
                "relevance": relevance,
            })
        return out

    def upsert_score(self, article_id, scored, reason):
        self.scores[article_id] = scored

    def month_to_date_spend(self):
        return self.spent

    # --- personalisation (interactions) ---
    def add_interaction(self, article_id, action, dwell_ms=None):
        """Test helper, not part of the Store protocol. Populates
        app.interaction-shaped rows for the personalisation tests."""
        self.interactions.append(
            {"article_id": article_id, "action": action, "dwell_ms": dwell_ms}
        )

    def qualifying_read_count(self, dwell_threshold_ms):
        return sum(
            1 for i in self.interactions
            if i["action"] == "opened" and (i["dwell_ms"] or 0) > dwell_threshold_ms
        )

    def recent_read_embeddings(self, dwell_threshold_ms, limit):
        qualifying = [
            i for i in self.interactions
            if i["action"] == "opened" and (i["dwell_ms"] or 0) > dwell_threshold_ms
        ]
        # Most-recent-first, mirroring `order by created_at desc`, the fake
        # doesn't track timestamps, so insertion order stands in for recency.
        qualifying = list(reversed(qualifying))[:limit]
        out = []
        for i in qualifying:
            vec = self.ai.get(i["article_id"], {}).get("vec")
            if vec:
                out.append(vec)
        return out

    def feed_interaction_counts(self):
        counts = {}
        for i in self.interactions:
            feed_id = self.rows.get(i["article_id"], {}).get("feed_id")
            if feed_id is None:
                continue
            opens, total = counts.get(feed_id, (0, 0))
            total += 1
            if i["action"] == "opened":
                opens += 1
            counts[feed_id] = (opens, total)
        return counts


def make_entry(i, title="A perfectly ordinary article about something", words=300):
    return Entry(id=i, feed_id=1, title=title, url=f"https://ex.com/{i}",
                 author="A", published_at=NOW - timedelta(hours=2),
                 content="<p>body</p>", enclosure_urls=[], feed_title="Example")


def stub_clients(entries, vectors=None, summary_cost=0.01, embed_spy=None):
    class MF:
        def fetch_entries(self, after_entry_id, limit=100):
            return entries

    def extract_fn(url, feed_content, fetch=None):
        return Extraction(text="word " * 300, status="ok", word_count=300, lead_image=None)

    def embed_fn(texts, settings, http=None):
        if embed_spy is not None:
            embed_spy.append(len(texts))
        if vectors is not None:
            return vectors[: len(texts)], 0.0001
        return [[0.1 * (i + 1)] + [0.0] * 1535 for i in range(len(texts))], 0.0001

    def summarize_fn(title, text, settings, http=None):
        return Summary(tldr="A summary.", bullets=["a", "b", "c"],
                       topics=["tech"], cost_usd=summary_cost)

    return Clients(miniflux=MF(), extract_fn=extract_fn,
                   embed_fn=embed_fn, summarize_fn=summarize_fn)


def test_prefilter_rejects_do_not_reach_the_embedder():
    entries = [make_entry(1), make_entry(2),
               make_entry(3, title="Links for Wednesday"),
               make_entry(4, title="Open thread"),
               make_entry(5)]
    spy = []
    store = FakeStore()
    report = run_once(store, stub_clients(entries, embed_spy=spy), SETTINGS, now=NOW)

    assert report.prefiltered_out == 2
    assert report.embedded == 3
    assert spy == [3], "only accepted articles may be sent to the paid embeddings API"
    # rejected articles are still stored, we keep the record, we just don't pay for it
    assert len(store.articles) == 5


def test_near_duplicates_are_summarised_once():
    entries = [make_entry(1), make_entry(2)]
    identical = [[1.0] + [0.0] * 1535, [1.0] + [0.0] * 1535]
    store = FakeStore()
    report = run_once(store, stub_clients(entries, vectors=identical), SETTINGS, now=NOW)

    assert report.clustered == 2
    assert report.summarised == 1, "only the cluster canonical gets a paid summary"
    assert len(store.clusters) == 1


def test_distinct_articles_each_get_their_own_summary():
    entries = [make_entry(1), make_entry(2)]
    orthogonal = [[1.0] + [0.0] * 1535, [0.0, 1.0] + [0.0] * 1534]
    store = FakeStore()
    report = run_once(store, stub_clients(entries, vectors=orthogonal), SETTINGS, now=NOW)

    assert report.summarised == 2
    assert len(store.clusters) == 2


def test_cost_cap_stops_spending_but_not_ingestion():
    entries = [make_entry(i) for i in (1, 2, 3)]
    store = FakeStore(spent=5.00)   # already at the cap
    report = run_once(store, stub_clients(entries), SETTINGS, now=NOW)

    assert report.cap_reached is True
    assert report.summarised == 0, "the cap must stop paid summaries"
    assert report.embedded == 3, "the cap must NOT stop ingestion or embedding"
    assert report.scored == 3, "articles still rank without a summary"


def test_cap_trips_mid_run_once_spend_crosses_the_line():
    entries = [make_entry(i) for i in (1, 2, 3)]
    orthogonal = [[1.0] + [0.0] * 1535,
                  [0.0, 1.0] + [0.0] * 1534,
                  [0.0, 0.0, 1.0] + [0.0] * 1533]
    store = FakeStore(spent=4.99)
    report = run_once(store, stub_clients(entries, vectors=orthogonal, summary_cost=0.01),
                      SETTINGS, now=NOW)

    assert report.summarised == 1, "spend crosses the cap after the first summary"
    assert report.cap_reached is True
    assert report.scored == 3


def test_rerun_is_idempotent_and_creates_no_duplicates():
    entries = [make_entry(1), make_entry(2)]
    store = FakeStore()
    first = run_once(store, stub_clients(entries), SETTINGS, now=NOW)
    second = run_once(store, stub_clients(entries), SETTINGS, now=NOW)

    assert first.embedded == 2
    assert second.skipped_existing == 2
    assert second.embedded == 0
    assert len(store.articles) == 2, "re-running must not duplicate articles"


def test_cursor_advances_to_the_highest_entry_id():
    entries = [make_entry(7), make_entry(3), make_entry(11)]
    store = FakeStore()
    run_once(store, stub_clients(entries), SETTINGS, now=NOW)
    assert store.cursor == 11


def test_extraction_failure_does_not_kill_the_run():
    entries = [make_entry(1), make_entry(2)]

    clients = stub_clients(entries)
    calls = {"n": 0}

    def flaky(url, feed_content, fetch=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("network exploded")
        return Extraction(text="word " * 300, status="ok", word_count=300, lead_image=None)

    clients.extract_fn = flaky
    store = FakeStore()
    report = run_once(store, clients, SETTINGS, now=NOW)

    assert report.embedded == 1, "the surviving article still processes"
    assert len(report.errors) == 1


def test_empty_batch_is_a_clean_noop():
    store = FakeStore()
    report = run_once(store, stub_clients([]), SETTINGS, now=NOW)
    assert report == type(report)()   # an all-zero report


def test_backlog_articles_are_prefiltered_before_any_paid_call():
    """Re-queued articles reach the paid calls through the queue, not through
    ingest. A 10-word stub must not be embedded just because it was pending."""
    store = FakeStore()
    aid = store.insert_article(miniflux_id=99, feed_id=1, feed_title="X",
                               title="A stub", url="https://ex.com/x",
                               published_at=NOW, extracted_text="ten words only here",
                               extract_status="ok", lead_image=None, word_count=10)
    spy = []
    report = run_once(store, stub_clients([], embed_spy=spy), SETTINGS, now=NOW)

    assert report.prefiltered_out == 1
    assert report.embedded == 0
    assert spy == [], "no paid embedding call may be made for a prefiltered stub"
    assert store.rows[aid]["ai_state"] == "skipped"


def test_archive_entries_never_reach_a_paid_call():
    """OpenAI's feed carries 1,149 entries back to 2015. Walking them in cursor
    order meant paying to summarise decade-old posts before reaching today."""
    from datetime import timedelta
    old = make_entry(1)
    object.__setattr__(old, "published_at", NOW - timedelta(days=400))
    fresh = make_entry(2)
    spy = []
    store = FakeStore()
    report = run_once(store, stub_clients([old, fresh], embed_spy=spy), SETTINGS, now=NOW)

    assert report.skipped_archive == 1
    assert report.embedded == 1, "only the fresh entry is processed"
    assert spy == [1], "the archive entry must not reach the embeddings API"
    assert store.cursor == 2, "the cursor still advances past it"


def test_an_entry_that_fails_to_ingest_is_kept_not_lost():
    # The cursor moves past a failed entry, so dropping it lost the article
    # for good: 16 Hacker News items vanished to one trafilatura crash.
    entries = [make_entry(1), make_entry(2)]
    clients = stub_clients(entries)

    def crashes_on_first(url, feed_content, fetch=None):
        if url.endswith("/1"):
            raise TypeError("'NoneType' object is not subscriptable")
        return Extraction(text="word " * 300, status="ok", word_count=300, lead_image=None)

    clients.extract_fn = crashes_on_first
    store = FakeStore()
    run_once(store, clients, SETTINGS, now=NOW)

    assert 1 in store.articles, "the crashing entry is still stored"
    row = store.rows[store.articles[1]]
    assert row["extract_status"] == "failed"
    assert row["ai_state"] == "skipped", "a teaser is never sent to a paid call"
    assert store.cursor == 2


def test_rescoring_is_skipped_when_nothing_new_and_not_due():
    # A full rescore is O(n^2) (about 7 minutes at 7,600 articles); a pass
    # that added nothing should not pay for it unless the caller says it is due.
    store = FakeStore()
    run_once(store, stub_clients([make_entry(1)]), SETTINGS, now=NOW)
    idle = run_once(store, stub_clients([]), SETTINGS, now=NOW, rescore_due=False)
    assert idle.scored == 0
    due = run_once(store, stub_clients([]), SETTINGS, now=NOW, rescore_due=True)
    assert due.scored >= 1
    fresh = run_once(store, stub_clients([make_entry(2)]), SETTINGS, now=NOW, rescore_due=False)
    assert fresh.scored >= 1, "new articles are always scored"


def test_fallback_survives_missing_content_and_nul_bytes():
    e = make_entry(7)
    e = Entry(id=e.id, feed_id=e.feed_id, title="T\x00itle", url="https://ex.com/7\x00",
              author="A\x00B", published_at=e.published_at, content=None,
              enclosure_urls=[], feed_title="Example")
    clients = stub_clients([e])

    def boom(url, feed_content, fetch=None):
        raise TypeError("'NoneType' object is not subscriptable")

    clients.extract_fn = boom
    store = FakeStore()
    run_once(store, clients, SETTINGS, now=NOW)
    row = store.rows[store.articles[7]]
    assert "\x00" not in row["url"] + row["title"] + row["author"]
    assert row["ai_state"] == "skipped"
