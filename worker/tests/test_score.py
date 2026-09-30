import pytest

from abovefold_worker.score import (
    RECENCY_HALF_LIFE_HOURS,
    W_NOISE,
    W_NOVELTY,
    W_RECENCY,
    W_RELEVANCE,
    W_SOURCE,
    Features,
    score,
)


def make_features(**overrides):
    defaults = dict(
        relevance=0.5,
        source_affinity=0.5,
        novelty=0.5,
        age_hours=24.0,
        noise_penalty=0.0,
        cluster_size=1,
        source_name="Stratechery",
        top_topic=None,
        # These fixtures exercise the personalised reason paths, so they must
        # declare that premise. Cold-start behaviour is covered separately below.
        personalised=True,
    )
    defaults.update(overrides)
    return Features(**defaults)


def test_weights_match_spec():
    # Locks the weights in spec §4, a silent change here would silently
    # re-rank the Today view.
    assert W_RELEVANCE == 0.35
    assert W_SOURCE == 0.20
    assert W_NOVELTY == 0.20
    assert W_RECENCY == 0.15
    assert W_NOISE == 0.10
    assert RECENCY_HALF_LIFE_HOURS == 24.0


def test_known_feature_set_hand_computed():
    # age_hours=24 gives recency = 0.5**(24/24) = 0.5 exactly, so the whole
    # sum can be checked by hand without floating-point noise:
    #   final = 0.35*0.6 + 0.20*0.4 + 0.20*0.8 + 0.15*0.5 - 0.10*0.2
    #         = 0.21    + 0.08     + 0.16     + 0.075    - 0.02
    #         = 0.505
    features = make_features(
        relevance=0.6,
        source_affinity=0.4,
        novelty=0.8,
        age_hours=24.0,
        noise_penalty=0.2,
    )
    result = score(features)
    assert result.final == pytest.approx(0.505, abs=1e-4)
    assert result.relevance == pytest.approx(0.6, abs=1e-4)
    assert result.source_affinity == pytest.approx(0.4, abs=1e-4)
    assert result.novelty == pytest.approx(0.8, abs=1e-4)
    assert result.noise_penalty == pytest.approx(0.2, abs=1e-4)


def test_recency_halves_every_24_hours():
    assert score(make_features(age_hours=0.0)).recency == pytest.approx(1.0, abs=1e-4)
    assert score(make_features(age_hours=24.0)).recency == pytest.approx(0.5, abs=1e-4)
    assert score(make_features(age_hours=48.0)).recency == pytest.approx(0.25, abs=1e-4)


def test_high_relevance_old_article_outranks_low_relevance_new_article():
    # A: strongly relevant, 3 days old.
    #    recency = 0.5**3 = 0.125
    #    final = 0.35*0.9 + 0.20*0.5 + 0.20*0.5 + 0.15*0.125 - 0
    #          = 0.315    + 0.1     + 0.1      + 0.01875
    #          = 0.53375
    old_relevant = make_features(
        relevance=0.9, source_affinity=0.5, novelty=0.5, age_hours=72.0, noise_penalty=0.0
    )
    # B: barely relevant, brand new.
    #    recency = 1.0
    #    final = 0.35*0.1 + 0.20*0.5 + 0.20*0.5 + 0.15*1.0 - 0
    #          = 0.035    + 0.1     + 0.1      + 0.15
    #          = 0.385
    new_irrelevant = make_features(
        relevance=0.1, source_affinity=0.5, novelty=0.5, age_hours=0.0, noise_penalty=0.0
    )
    assert score(old_relevant).final > score(new_irrelevant).final
    assert score(old_relevant).final == pytest.approx(0.53375, abs=1e-4)
    assert score(new_irrelevant).final == pytest.approx(0.385, abs=1e-4)


def test_noise_penalty_genuinely_subtracts():
    quiet = make_features(noise_penalty=0.0)
    noisy = make_features(noise_penalty=0.5)
    assert score(noisy).final < score(quiet).final
    assert score(quiet).final - score(noisy).final == pytest.approx(
        W_NOISE * 0.5, abs=1e-4
    )


def test_neutral_cold_start_gives_mid_range_score():
    # Cold-start callers pass relevance=source_affinity=0.5; score() must
    # not special-case this, the neutral values alone should produce a
    # sane mid-range figure, not a collapse to 0.
    features = make_features(
        relevance=0.5, source_affinity=0.5, novelty=0.5, age_hours=24.0, noise_penalty=0.0
    )
    result = score(features)
    assert 0.3 < result.final < 0.8


# --- reason: dominant-component naming ---


def test_reason_names_relevance_when_dominant():
    features = make_features(
        relevance=1.0,
        source_affinity=0.1,
        novelty=0.1,
        age_hours=1000.0,
        noise_penalty=0.0,
        top_topic=None,
    )
    reason = score(features).reason
    assert "match" in reason.lower()


def test_reason_mentions_topic_when_relevance_dominant_and_topic_known():
    features = make_features(
        relevance=1.0,
        source_affinity=0.1,
        novelty=0.1,
        age_hours=1000.0,
        noise_penalty=0.0,
        top_topic="LLM pricing",
    )
    reason = score(features).reason
    assert "LLM pricing" in reason


def test_reason_names_source_when_dominant():
    features = make_features(
        relevance=0.1,
        source_affinity=1.0,
        novelty=0.1,
        age_hours=1000.0,
        noise_penalty=0.0,
        source_name="Stratechery",
    )
    reason = score(features).reason
    assert "Stratechery" in reason


def test_reason_names_novelty_when_dominant():
    features = make_features(
        relevance=0.1,
        source_affinity=0.1,
        novelty=1.0,
        age_hours=1000.0,
        noise_penalty=0.0,
    )
    reason = score(features).reason
    assert "no similar story" in reason.lower() or "fresh angle" in reason.lower()


def test_reason_names_recency_when_dominant():
    features = make_features(
        relevance=0.1,
        source_affinity=0.1,
        novelty=0.1,
        age_hours=0.0,
        noise_penalty=0.0,
    )
    reason = score(features).reason
    assert "just published" in reason.lower() or "new" in reason.lower()


def test_reason_appends_cluster_size_when_greater_than_one():
    features = make_features(
        relevance=1.0,
        source_affinity=0.1,
        novelty=0.1,
        age_hours=1000.0,
        noise_penalty=0.0,
        cluster_size=4,
    )
    reason = score(features).reason
    assert reason.endswith("4 sources")


def test_reason_does_not_append_cluster_size_when_one():
    features = make_features(
        relevance=1.0,
        source_affinity=0.1,
        novelty=0.1,
        age_hours=1000.0,
        noise_penalty=0.0,
        cluster_size=1,
    )
    reason = score(features).reason
    assert "source" not in reason.lower()


# --- tie guard: added after a real run made all 95 reasons identical -------

def test_cold_start_never_claims_personalisation():
    """relevance=0.5 is a placeholder. Saying "matches your reading" would be a lie."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.55,
                 age_hours=2.0, noise_penalty=0.0, cluster_size=1,
                 source_name="Ars Technica", top_topic=None)
    r = score(f)
    assert "match to your" not in r.reason
    assert "You open" not in r.reason


def test_cold_start_still_ranks_on_the_full_formula():
    """Only the EXPLANATION is restricted; the score itself uses every term."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.9, source_affinity=0.5, novelty=0.5,
                 age_hours=24.0, noise_penalty=0.0, cluster_size=1,
                 source_name="X", top_topic=None)
    g = Features(relevance=0.1, source_affinity=0.5, novelty=0.5,
                 age_hours=24.0, noise_penalty=0.0, cluster_size=1,
                 source_name="X", top_topic=None)
    assert score(f).final > score(g).final


def test_personalised_reason_names_the_topic():
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.95, source_affinity=0.2, novelty=0.2,
                 age_hours=48.0, noise_penalty=0.0, cluster_size=1,
                 source_name="Stratechery", top_topic="llm pricing",
                 personalised=True)
    assert score(f).reason == "Strong match to your interest in llm pricing"


def test_personalised_reason_names_the_source():
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.1, source_affinity=0.98, novelty=0.1,
                 age_hours=72.0, noise_penalty=0.0, cluster_size=1,
                 source_name="Stratechery", top_topic=None,
                 personalised=True)
    assert score(f).reason == "You open Stratechery often"


def test_tie_guard_falls_back_to_an_honest_line():
    """Cold start with several sources states the verifiable fact instead."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.50,
                 age_hours=13.5, noise_penalty=0.0, cluster_size=4,
                 source_name="Ars Technica", top_topic=None)
    assert score(f).reason == "Covered by 4 of your sources"


# --- reason honesty: every line must be literally true ---------------------

def test_moderate_novelty_does_not_claim_nothing_similar_exists():
    """novelty 0.56 means something 0.44-similar DOES exist. Don't overclaim."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.56,
                 age_hours=30.0, noise_penalty=0.0, cluster_size=1,
                 source_name="Polygon", top_topic=None)
    assert score(f).reason == "New from Polygon"


def test_high_novelty_may_claim_it():
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.93,
                 age_hours=30.0, noise_penalty=0.0, cluster_size=1,
                 source_name="Polygon", top_topic=None)
    assert score(f).reason == "No similar story in your feeds"


def test_personalised_reason_does_not_claim_match_at_neutral_relevance():
    """relevance=0.5 is the cold-start placeholder value carrying zero real
    evidence. At age_hours=24 (recency=0.5, matching every other neutral
    feature) it still wins on WEIGHTED value because W_RELEVANCE is the
    largest weight, but a weighted win is not evidence, and "strong match"
    at the neutral value would be a lie."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.5,
                age_hours=24.0, noise_penalty=0.0, cluster_size=1,
                source_name="Ars Technica", top_topic="AI", personalised=True)
    reason = score(f).reason
    assert "match" not in reason.lower()
    assert reason == "New from Ars Technica"


def test_personalised_reason_still_claims_match_at_genuinely_high_relevance():
    """The floor must not mute the feature outright, real relevance still
    produces the strong-match line."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.85, source_affinity=0.5, novelty=0.5,
                age_hours=24.0, noise_penalty=0.0, cluster_size=1,
                source_name="Ars Technica", top_topic="AI", personalised=True)
    reason = score(f).reason
    assert reason == "Strong match to your interest in AI"


def test_personalised_reason_does_not_claim_source_habit_at_neutral_affinity():
    """Same scrutiny for the source branch: source_affinity=0.5 is neutral,
    so 'You open X often' must not fire just because source wins the
    weighted comparison against other low, non-neutral features."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.1, source_affinity=0.5, novelty=0.1,
                age_hours=1000.0, noise_penalty=0.0, cluster_size=1,
                source_name="Ars Technica", top_topic=None, personalised=True)
    reason = score(f).reason
    assert "open" not in reason.lower()


def test_personalised_reason_still_claims_source_habit_at_genuinely_high_affinity():
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.1, source_affinity=0.9, novelty=0.1,
                age_hours=1000.0, noise_penalty=0.0, cluster_size=1,
                source_name="Ars Technica", top_topic=None, personalised=True)
    reason = score(f).reason
    assert reason == "You open Ars Technica often"


def test_cluster_count_wins_the_cold_start_explanation():
    """How many sources carried it is the most useful verifiable fact."""
    from abovefold_worker.score import Features, score
    f = Features(relevance=0.5, source_affinity=0.5, novelty=0.3,
                 age_hours=3.0, noise_penalty=0.0, cluster_size=4,
                 source_name="Polygon", top_topic=None)
    assert score(f).reason == "Covered by 4 of your sources"
