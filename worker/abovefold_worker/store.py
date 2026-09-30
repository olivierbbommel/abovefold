"""Persistence for the app schema.

The pipeline talks to a Store, never to psycopg directly. That keeps the
orchestration logic testable without a database, and keeps every SQL string
in one file. The worker NEVER writes to Miniflux's `public` schema, read
and mutate that only through the REST API.
"""
from __future__ import annotations

from typing import Protocol

import psycopg

from .config import Settings


class Store(Protocol):
    def existing_miniflux_ids(self, ids: list[int]) -> set[int]: ...
    def insert_article(self, *, miniflux_id: int, feed_id: int, feed_title: str, url: str,
                       title: str, author: str | None, published_at, extracted_text: str,
                       extract_status: str, lead_image: str | None,
                       word_count: int) -> int: ...
    def recent_embeddings(self, hours: int = 48) -> list[tuple[int, int, list[float]]]: ...
    def insert_ai(self, *, article_id: int, embedding: list[float], model: str,
                  summary: str | None, bullets: list[str] | None,
                  topics: list[str] | None, cost_usd: float) -> None: ...
    def create_cluster(self, canonical_article_id: int) -> int: ...
    def assign_cluster(self, article_id: int, cluster_id: int, similarity: float) -> None: ...
    def cluster_size(self, cluster_id: int) -> int: ...
    def upsert_score(self, article_id: int, scored, reason: str) -> None: ...
    def month_to_date_cost(self) -> float: ...
    def read_cursor(self) -> int: ...
    def write_cursor(self, last_entry_id: int) -> None: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


def connect(settings: Settings) -> psycopg.Connection:
    return psycopg.connect(settings.database_url, autocommit=False)


class PgStore:
    """Store backed by Postgres."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        self.conn.rollback()

    def existing_miniflux_ids(self, ids: list[int]) -> set[int]:
        if not ids:
            return set()
        with self.conn.cursor() as cur:
            cur.execute("select miniflux_id from app.article where miniflux_id = any(%s)", (ids,))
            return {r[0] for r in cur.fetchall()}

    def insert_article(self, *, miniflux_id, feed_id, feed_title, url, title, author,
                       published_at, extracted_text, extract_status, lead_image,
                       word_count) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.article
                   (miniflux_id, feed_id, feed_title, url, title, author, published_at,
                    extracted_text, extract_status, lead_image, word_count)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   on conflict (miniflux_id) do nothing
                   returning id""",
                (miniflux_id, feed_id, feed_title, url, title, author, published_at,
                 extracted_text, extract_status, lead_image, word_count),
            )
            row = cur.fetchone()
            if row:
                return row[0]
            cur.execute("select id from app.article where miniflux_id = %s", (miniflux_id,))
            return cur.fetchone()[0]

    def recent_embeddings(self, hours: int = 48) -> list[tuple[int, int, list[float]]]:
        with self.conn.cursor() as cur:
            cur.execute(
                """select ac.cluster_id, a.id, ai.embedding::text
                   from app.article a
                   join app.article_ai ai on ai.article_id = a.id
                   join app.article_cluster ac on ac.article_id = a.id
                   where a.published_at > now() - make_interval(hours => %s)
                     and ai.embedding is not null""",
                (hours,),
            )
            out = []
            for cluster_id, article_id, vec_text in cur.fetchall():
                out.append((cluster_id, article_id, [float(x) for x in vec_text.strip("[]").split(",")]))
            return out

    def insert_ai(self, *, article_id, embedding, model, summary, bullets, topics, cost_usd) -> None:
        import json
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.article_ai
                   (article_id, summary, bullets, topics, embedding, model, cost_usd)
                   values (%s,%s,%s,%s,%s,%s,%s)
                   on conflict (article_id) do update set
                     summary = coalesce(excluded.summary, app.article_ai.summary),
                     bullets = coalesce(excluded.bullets, app.article_ai.bullets),
                     topics  = coalesce(excluded.topics,  app.article_ai.topics),
                     cost_usd = app.article_ai.cost_usd + excluded.cost_usd""",
                (article_id, summary, json.dumps(bullets) if bullets else None,
                 topics, str(embedding), model, cost_usd),
            )

    def create_cluster(self, canonical_article_id: int) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "insert into app.cluster (canonical_article_id) values (%s) returning id",
                (canonical_article_id,),
            )
            return cur.fetchone()[0]

    def assign_cluster(self, article_id: int, cluster_id: int, similarity: float) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.article_cluster (article_id, cluster_id, similarity)
                   values (%s,%s,%s) on conflict (article_id) do nothing""",
                (article_id, cluster_id, similarity),
            )

    def cluster_size(self, cluster_id: int) -> int:
        with self.conn.cursor() as cur:
            cur.execute("select count(*) from app.article_cluster where cluster_id = %s", (cluster_id,))
            return int(cur.fetchone()[0])

    def upsert_score(self, article_id: int, scored, reason: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.score (article_id, relevance, source_affinity, novelty,
                                          recency, noise_penalty, final_score, reason)
                   values (%s,%s,%s,%s,%s,%s,%s,%s)
                   on conflict (article_id) do update set
                     relevance=excluded.relevance, source_affinity=excluded.source_affinity,
                     novelty=excluded.novelty, recency=excluded.recency,
                     noise_penalty=excluded.noise_penalty, final_score=excluded.final_score,
                     reason=excluded.reason, computed_at=now()""",
                (article_id, scored.relevance, scored.source_affinity, scored.novelty,
                 scored.recency, scored.noise_penalty, scored.final, reason),
            )

    def month_to_date_cost(self) -> float:
        with self.conn.cursor() as cur:
            cur.execute("select coalesce(sum(cost_usd),0) from app.article_ai "
                        "where created_at >= date_trunc('month', now())")
            return float(cur.fetchone()[0])

    def read_cursor(self) -> int:
        with self.conn.cursor() as cur:
            cur.execute("select last_entry_id from app.sync_state where id = 1")
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def write_cursor(self, last_entry_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.sync_state (id, last_entry_id, updated_at)
                   values (1, %s, now())
                   on conflict (id) do update set
                     last_entry_id = excluded.last_entry_id, updated_at = now()""",
                (last_entry_id,),
            )


    def scorable_rows(self, centroid: list[float] | None = None) -> list[dict]:
        """Everything needed to recompute a score, with novelty (and, when a
        centroid is supplied, relevance) done in SQL.

        pgvector's `<=>` is cosine DISTANCE, which is exactly 1 - similarity , 
        so the minimum distance to any other article IS the novelty, and
        `1 - distance to the centroid` IS the relevance. Doing both here
        avoids pulling every vector into Python.

        `centroid` is the caller's interest centroid (see
        `recent_read_embeddings` + pipeline's `_centroid`), or None when there
        isn't enough interaction history yet, see pipeline.MIN_RELEVANCE_INTERACTIONS.
        With no centroid, `relevance` comes back NULL and the caller must
        substitute the cold-start placeholder rather than read it.
        """
        relevance_col = "1 - (ai.embedding <=> %(centroid)s::vector)" if centroid is not None else "null"
        params = {"centroid": str(centroid)} if centroid is not None else {}
        with self.conn.cursor() as cur:
            cur.execute(f"""
                select a.id,
                       a.published_at,
                       a.feed_id,
                       coalesce(a.feed_title, '') as feed_title,
                       coalesce((select min(ai2.embedding <=> ai.embedding)
                                 from app.article_ai ai2
                                 where ai2.article_id <> ai.article_id
                                   and ai2.embedding is not null), 1.0) as novelty,
                       -- count(*) over zero rows returns 0, not NULL, so
                       -- coalesce alone never fires. greatest() is the guard.
                       greatest(coalesce((select count(*) from app.article_cluster x
                                 where x.cluster_id = ac.cluster_id), 1), 1) as cluster_size,
                       (ai.topics)[1] as top_topic,
                       {relevance_col} as relevance
                from app.article a
                join app.article_ai ai on ai.article_id = a.id
                left join app.article_cluster ac on ac.article_id = a.id
                where ai.embedding is not null
            """, params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    def qualifying_read_count(self, dwell_threshold_ms: int) -> int:
        """How many opens are 'genuine reads' per spec §4 (opened, dwell over
        the threshold). This is the signal the personalisation gate checks , 
        see pipeline.MIN_RELEVANCE_INTERACTIONS."""
        with self.conn.cursor() as cur:
            cur.execute(
                "select count(*) from app.interaction where action = 'opened' and dwell_ms > %s",
                (dwell_threshold_ms,),
            )
            return int(cur.fetchone()[0])

    def recent_read_embeddings(self, dwell_threshold_ms: int, limit: int) -> list[list[float]]:
        """Embeddings of the most recent genuine reads, most recent first.
        The caller averages these into the interest centroid (spec §4:
        "centroid of the last 200 articles opened with dwell > 20s"). Articles
        whose embedding is missing (extraction/embed failure) are silently
        excluded rather than raising, a partial centroid beats none."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select ai.embedding::text
                   from app.interaction i
                   join app.article_ai ai on ai.article_id = i.article_id
                   where i.action = 'opened' and i.dwell_ms > %s
                     and ai.embedding is not null
                   order by i.created_at desc
                   limit %s""",
                (dwell_threshold_ms, limit),
            )
            return [[float(x) for x in row[0].strip("[]").split(",")] for row in cur.fetchall()]

    def feed_interaction_counts(self) -> dict[int, tuple[int, int]]:
        """Raw (opens, total) interaction counts per feed. The Bayesian
        smoothing math lives in pipeline.py as a pure function so it's
        testable without a database, this just supplies the counts."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select a.feed_id,
                          count(*) filter (where i.action = 'opened') as opens,
                          count(*) as total
                   from app.interaction i
                   join app.article a on a.id = i.article_id
                   group by a.feed_id"""
            )
            return {int(feed_id): (int(opens), int(total)) for feed_id, opens, total in cur.fetchall()}


    def set_ai_state(self, article_id: int, state: str) -> None:
        with self.conn.cursor() as cur:
            cur.execute("update app.article set ai_state = %s where id = %s", (state, article_id))

    def pending_ai_articles(self, limit: int = 100) -> list[dict]:
        """The paid-work queue. Ingestion is free and advances the cursor; this
        is what actually costs money, and it survives failures because a row
        only leaves the queue once its embedding is stored."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select id, feed_id, coalesce(feed_title,'') as feed_title, title, url,
                          published_at, extracted_text, extract_status, word_count
                   from app.article
                   where ai_state = 'pending' and extract_status in ('ok','fallback')
                     and extracted_text is not null
                   order by published_at desc
                   limit %s""",
                (limit,),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def articles_needing_summary(self, limit: int = 50, max_attempts: int = 3) -> list[dict]:
        """Canonicals that were embedded but never summarised, the cost cap
        tripped, or the model errored. Spec says the cap PAUSES summarisation;
        a pause needs a resume, and this is it."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select a.id, a.title, a.extracted_text, coalesce(a.feed_title,'') as feed_title,
                          ac.cluster_id
                   from app.article a
                   join app.article_ai ai on ai.article_id = a.id
                   join app.article_cluster ac on ac.article_id = a.id
                   join app.cluster c on c.id = ac.cluster_id and c.canonical_article_id = a.id
                   where ai.summary is null and ai.summary_attempts < %s
                     and a.extracted_text is not null
                   order by a.published_at desc
                   limit %s""",
                (max_attempts, limit),
            )
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def store_embedding(self, article_id: int, embedding: list[float], model: str,
                        embed_cost: float) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """insert into app.article_ai (article_id, embedding, model, embed_cost_usd)
                   values (%s,%s,%s,%s)
                   on conflict (article_id) do update set
                     embedding = excluded.embedding, model = excluded.model,
                     embed_cost_usd = coalesce(app.article_ai.embed_cost_usd, 0)
                                      + excluded.embed_cost_usd""",
                (article_id, str(embedding), model, embed_cost),
            )

    def store_summary(self, article_id: int, summary, model: str) -> None:
        import json
        with self.conn.cursor() as cur:
            cur.execute(
                """update app.article_ai set
                     summary = %s, bullets = %s, topics = %s, summary_model = %s,
                     cost_usd = coalesce(cost_usd, 0) + %s,
                     prompt_tokens = %s, completion_tokens = %s,
                     summary_attempts = summary_attempts + 1
                   where article_id = %s""",
                (summary.tldr, json.dumps(summary.bullets), summary.topics, model,
                 summary.cost_usd, summary.prompt_tokens, summary.completion_tokens,
                 article_id),
            )

    def record_summary_attempt(self, article_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "update app.article_ai set summary_attempts = summary_attempts + 1 "
                "where article_id = %s", (article_id,))

    def month_to_date_spend(self) -> float:
        """ALL spend, not just summaries. Embeddings were previously invisible
        to the cap, so roughly half the bill sat outside the ceiling.

        Also includes app.api_spend, the web app's own search and AI Feed
        query embeddings (web/lib/api-spend.ts, web/lib/embed.ts). Those were
        reintroduced as invisible-to-the-cap the same way article embeddings
        once were; this sums both so one number is the true monthly total."""
        with self.conn.cursor() as cur:
            cur.execute(
                "select coalesce((select sum(cost_usd + embed_cost_usd) from app.article_ai "
                "where created_at >= date_trunc('month', now())), 0) "
                "+ coalesce((select sum(cost_usd) from app.api_spend "
                "where created_at >= date_trunc('month', now())), 0)"
            )
            return float(cur.fetchone()[0])

    def nearest_similarity(self, article_id: int) -> float:
        """Novelty from pgvector: `<=>` is cosine DISTANCE, so 1 - distance is
        the similarity. Doing it in SQL keeps run_once and --rescore agreeing."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select 1 - min(ai2.embedding <=> ai.embedding)
                   from app.article_ai ai, app.article_ai ai2
                   where ai.article_id = %s and ai2.article_id <> ai.article_id
                     and ai2.embedding is not null""",
                (article_id,),
            )
            row = cur.fetchone()
            return float(row[0]) if row and row[0] is not None else 0.0

    def cluster_candidates(self, article_id: int, hours: int = 48,
                           threshold: float = 0.92) -> tuple[int, float] | None:
        """Nearest neighbour above the clustering bar, in SQL."""
        with self.conn.cursor() as cur:
            cur.execute(
                """select ac.cluster_id, 1 - (ai2.embedding <=> ai.embedding) as sim
                   from app.article_ai ai
                   join app.article_ai ai2 on ai2.article_id <> ai.article_id
                   join app.article a2 on a2.id = ai2.article_id
                   join app.article_cluster ac on ac.article_id = ai2.article_id
                   where ai.article_id = %s
                     and a2.published_at > now() - make_interval(hours => %s)
                   order by ai.embedding <=> ai2.embedding
                   limit 1""",
                (article_id, hours),
            )
            row = cur.fetchone()
            if row and row[1] is not None and float(row[1]) >= threshold:
                return int(row[0]), float(row[1])
            return None
