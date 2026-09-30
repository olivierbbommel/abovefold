"""Phase 3 personalised ranking: real relevance + source_affinity, gated on
having enough interaction history to trust them (spec §4, "Cold start").

No database, FakeStore (from test_pipeline) plus pipeline's pure helpers.
"""
from datetime import datetime, timezone

import pytest

from abovefold_worker.pipeline import (
    COLD_START_AFFINITY,
    DWELL_THRESHOLD_MS,
    MIN_FEED_INTERACTIONS,
    MIN_RELEVANCE_INTERACTIONS,
    Clients,
    RunReport,
    _centroid,
    _global_mean,
    _smoothed_source_affinity,
    process_ai,
    rescore_all,
)
from tests.test_pipeline import SETTINGS, FakeStore

NOW = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)


def _seed_article(store, aid, *, feed_id=1, feed_title="Stratechery", vec=None,
                  published_at=NOW):
    """Puts an article far enough through the pipeline to be scorable:
    a row, an embedding, and a (trivial) cluster of one."""
    store.rows[aid] = {
        "id": aid, "feed_id": feed_id, "feed_title": feed_title,
        "published_at": published_at, "ai_state": "done",
    }
    store.ai[aid] = {"vec": vec or [1.0] + [0.0] * 1535}
    cid = store.create_cluster(aid)
    store.assign_cluster(aid, cid, 1.0)


# --- the pure helpers, tested directly ---------------------------------


def test_centroid_of_empty_list_is_none():
    assert _centroid([]) is None


def test_centroid_is_the_mean():
    assert _centroid([[1.0, 1.0], [0.0, 3.0]]) == pytest.approx([0.5, 2.0])


def test_smoothed_affinity_empty_counts_is_empty_map():
    assert _smoothed_source_affinity({}, MIN_FEED_INTERACTIONS) == {}


def test_bayesian_smoothing_pulls_a_two_open_feed_toward_the_mean():
    # Feed A: 2 opens out of 2 (100% raw rate), a brand new feed the user
    # happened to click twice. Feed B: 40 opens out of 200 (20%, the global
    # average, dominating the totals). Without smoothing, A's raw rate (1.0)
    # would trounce every established source.
    counts = {1: (2, 2), 2: (40, 200)}
    smoothed = _smoothed_source_affinity(counts, prior_strength=10)
    global_mean = 42 / 202  # ~0.208

    assert smoothed[1] < 1.0, "raw 100% must not survive smoothing"
    assert smoothed[1] == pytest.approx((2 + 10 * global_mean) / (2 + 10))
    # And it should land noticeably closer to the global mean than to 1.0.
    assert abs(smoothed[1] - global_mean) < abs(smoothed[1] - 1.0)
    # Feed B has 200 interactions, 20x the prior strength, so smoothing
    # barely moves it off its own raw rate.
    assert smoothed[2] == pytest.approx(40 / 200, abs=0.02)


def test_smoothing_with_zero_prior_strength_is_the_raw_rate():
    # A prior_strength of 0 means "trust every feed's own rate outright" , 
    # sanity-checks the formula degenerates correctly at the edge.
    counts = {1: (3, 10)}
    assert _smoothed_source_affinity(counts, prior_strength=0) == {1: pytest.approx(0.3)}


# --- the gate: rescore_all() ---------------------------------------------


def test_below_threshold_stays_cold_start():
    """Fewer than MIN_RELEVANCE_INTERACTIONS genuine reads: neutral
    placeholders and personalised=False, byte-for-byte what today's
    behaviour already is."""
    store = FakeStore()
    _seed_article(store, 1)
    for i in range(MIN_RELEVANCE_INTERACTIONS - 1):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1000)

    rescore_all(store, now=NOW)

    scored = store.scores[1]
    assert scored.relevance == pytest.approx(0.5)
    assert scored.source_affinity == pytest.approx(0.5)
    assert "match to your" not in scored.reason
    assert "You open" not in scored.reason


def test_at_or_above_threshold_turns_on_real_values():
    store = FakeStore()
    # The reader's interest: an article near [1, 0, 0, ...].
    _seed_article(store, 1, feed_id=1, vec=[1.0] + [0.0] * 1535)
    # A second, unrelated article the user has never touched.
    _seed_article(store, 2, feed_id=2, vec=[0.0, 1.0] + [0.0] * 1534)

    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1000)

    rescore_all(store, now=NOW)

    matched = store.scores[1]
    unmatched = store.scores[2]
    assert matched.relevance > unmatched.relevance, (
        "the article matching the centroid must score more relevant than an orthogonal one"
    )
    assert matched.relevance == pytest.approx(1.0, abs=1e-6)
    assert unmatched.relevance == pytest.approx(0.0, abs=1e-6)


def test_dwell_under_threshold_does_not_count_as_a_genuine_read():
    """A drive-by open (dwell under 20s) is not a signal, the spec's cold
    start language is explicit about dwell, not just 'opened'."""
    store = FakeStore()
    _seed_article(store, 1)
    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS - 1)

    rescore_all(store, now=NOW)

    assert store.scores[1].relevance == pytest.approx(0.5), "short dwells must not count"


def test_non_opened_actions_do_not_count_toward_the_gate():
    store = FakeStore()
    _seed_article(store, 1)
    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "skipped", dwell_ms=None)
        store.add_interaction(1, "read_later", dwell_ms=99_999)  # no dwell semantics

    rescore_all(store, now=NOW)

    assert store.scores[1].relevance == pytest.approx(0.5)


def test_missing_embeddings_for_every_qualifying_read_degrades_to_cold_start():
    """The gate counts interaction rows, but the centroid needs embeddings.
    If every qualifying read's article has no stored embedding (edge case , 
    an embed failure after the fact), there is nothing to average: degrade
    rather than divide by zero or score against an empty centroid."""
    store = FakeStore()
    store.rows[1] = {"id": 1, "feed_id": 1, "feed_title": "X", "published_at": NOW}
    store.ai[1] = {}  # article_ai row exists (it's scorable) but no embedding
    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)

    n = rescore_all(store, now=NOW)

    assert n == 1
    assert store.scores[1].relevance == pytest.approx(0.5), (
        "an empty centroid (no embeddings among qualifying reads) must fall back to cold start"
    )
    assert "match to your" not in store.scores[1].reason, "must not claim personalisation with no centroid"


def test_a_single_scorable_row_missing_its_embedding_falls_back_to_cold_start_relevance():
    """Unlike the case above, personalisation IS on here (a real centroid
    exists), only ONE scorable row happens to have no embedding, which
    FakeStore.scorable_rows reports as relevance=None. The real Postgres
    query can't produce this (its `embedding is not null` join excludes such
    rows), but the Python must not assume that and blow up on
    `float(None)` the day the schema or the query changes."""
    store = FakeStore()
    _seed_article(store, 1, vec=[1.0] + [0.0] * 1535)  # gives the centroid its data
    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)

    store.rows[2] = {"id": 2, "feed_id": 1, "feed_title": "X", "published_at": NOW}
    store.ai[2] = {}  # article_ai row exists (it's scorable) but no embedding

    rescore_all(store, now=NOW)  # must not raise TypeError: float() argument must be a string...

    assert store.scores[2].relevance == pytest.approx(0.5)


def test_feed_with_too_few_interactions_still_uses_the_smoothed_affinity_map():
    """Above the global gate, a feed the reader has barely touched doesn't
    get a separate hard cutoff, Bayesian smoothing already pulls it toward
    the mean (see test_bayesian_smoothing_pulls_a_two_open_feed_toward_the_mean).
    This just confirms rescore_all wires that through end to end."""
    store = FakeStore()
    _seed_article(store, 1, feed_id=1)   # established feed: 20 opens, 5 skips
    _seed_article(store, 2, feed_id=2)   # brand new feed: 2 opens, 100% raw rate
    # A third feed the reader mostly skips, pulls the global mean well
    # below 100%, so smoothing has somewhere real to pull feed 2 toward.
    store.rows[3] = {"id": 3, "feed_id": 3, "feed_title": "Noisy", "published_at": NOW}

    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    for i in range(5):
        store.add_interaction(1, "skipped")
    store.add_interaction(2, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    store.add_interaction(2, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    for i in range(50):
        store.add_interaction(3, "skipped")

    rescore_all(store, now=NOW)

    # Feed 2's raw rate is 100% (2/2) but must not land at 1.0, smoothing
    # must have pulled it toward the (much lower) global mean.
    assert store.scores[2].source_affinity < 0.6
    assert store.scores[2].source_affinity < store.scores[1].source_affinity


def test_absent_feed_defaults_to_the_global_mean_not_the_cold_start_placeholder():
    """A feed with ZERO interaction rows is absent from the affinity map
    entirely (`_smoothed_source_affinity` only has entries for feeds that
    appear in `feed_interaction_counts`). It must default to the global
    mean, the exact prior every OTHER feed is already smoothed toward , 
    not the unrelated 0.5 cold-start placeholder. The old default of 0.5
    gave a feed you have never touched a standing bonus over the global
    mean itself, which in any realistic history sits well below 0.5
    because it's opens over ALL interactions, archived/skipped included.

    Reproduces the measured scenario: counts {1:(30,40), 2:(5,60), 3:(2,25)}
    → global_mean = 37/125 = 0.296, not 0.5.
    """
    store = FakeStore()
    _seed_article(store, 1, feed_id=1)
    _seed_article(store, 2, feed_id=2)
    _seed_article(store, 3, feed_id=3)
    _seed_article(store, 4, feed_id=99)  # never interacted with, absent from the map

    for i in range(30):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    for i in range(10):
        store.add_interaction(1, "skipped")
    for i in range(5):
        store.add_interaction(2, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    for i in range(55):
        store.add_interaction(2, "skipped")
    for i in range(2):
        store.add_interaction(3, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)
    for i in range(23):
        store.add_interaction(3, "skipped")

    rescore_all(store, now=NOW)

    counts = store.feed_interaction_counts()
    assert counts == {1: (30, 40), 2: (5, 60), 3: (2, 25)}
    global_mean = _global_mean(counts)
    assert global_mean == pytest.approx(37 / 125)
    assert global_mean == pytest.approx(0.296, abs=0.001)

    assert store.scores[4].source_affinity == pytest.approx(global_mean)
    assert store.scores[4].source_affinity != pytest.approx(COLD_START_AFFINITY)


def test_process_ai_tail_call_and_a_standalone_rescore_agree():
    """process_ai's own tail call to rescore_all must land on the same score
    as a standalone --rescore pass over the same data. This actually runs
    process_ai (embedding queue empty, one article needing a summary) rather
    than calling rescore_all twice, so it proves the two entry points share
    one implementation instead of merely asserting rescore_all is
    deterministic (which the old, identically-named test actually tested)."""
    from abovefold_worker.summarize import Summary

    def summarize_fn(title, text, settings, http=None):
        return Summary(tldr="t", bullets=["a"], topics=["tech"], cost_usd=0.001)

    store = FakeStore()
    _seed_article(store, 1)
    for i in range(MIN_RELEVANCE_INTERACTIONS):
        store.add_interaction(1, "opened", dwell_ms=DWELL_THRESHOLD_MS + 1)

    clients = Clients(miniflux=None, summarize_fn=summarize_fn)
    report = RunReport()
    process_ai(store, clients, SETTINGS, report, now=NOW)
    via_process_ai = store.scores[1]

    direct = rescore_all(store, now=NOW)  # a second, independent --rescore pass
    assert direct == 1

    assert via_process_ai.final == pytest.approx(store.scores[1].final)
    assert via_process_ai.relevance == pytest.approx(store.scores[1].relevance)
    assert via_process_ai.source_affinity == pytest.approx(store.scores[1].source_affinity)


# --- score() purity is unaffected by any of this ---------------------------


def test_score_stays_pure_regardless_of_call_order():
    from abovefold_worker.score import Features, score

    f = Features(relevance=0.7, source_affinity=0.6, novelty=0.4, age_hours=10.0,
                noise_penalty=0.1, cluster_size=2, source_name="X", top_topic=None,
                personalised=True)
    a = score(f)
    # Score something else in between, then re-score the same features.
    score(Features(relevance=0.1, source_affinity=0.1, novelty=0.1, age_hours=0.0,
                   noise_penalty=0.0, cluster_size=1, source_name="Y", top_topic=None))
    b = score(f)
    assert a == b
