import math

import pytest

from abovefold_worker.dedupe import DEFAULT_THRESHOLD, cosine, pick_cluster


def _unit_vector_at_cosine(c: float) -> list[float]:
    """Build a unit vector b such that cosine((1.0, 0.0), b) == c exactly.

    Since a = (1, 0) is already a unit vector, dot(a, b) / (|a| * |b|)
    reduces to b_x when b is itself a unit vector, so b = (c, sqrt(1 - c^2))
    gives cosine(a, b) == c (up to floating point rounding).
    """
    return [c, math.sqrt(1 - c * c)]


REFERENCE = [1.0, 0.0]


def test_identical_vectors_give_cosine_one():
    a = [1.0, 2.0, 3.0]
    assert cosine(a, a) == pytest.approx(1.0)


def test_orthogonal_vectors_give_cosine_zero():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert cosine(a, b) == pytest.approx(0.0)


def test_zero_magnitude_vector_gives_zero_without_raising():
    a = [0.0, 0.0, 0.0]
    b = [1.0, 2.0, 3.0]
    assert cosine(a, b) == 0.0
    assert cosine(b, a) == 0.0
    assert cosine(a, a) == 0.0


def test_cosine_at_0_93_is_above_threshold():
    b = _unit_vector_at_cosine(0.93)
    sim = cosine(REFERENCE, b)
    assert sim == pytest.approx(0.93)
    assert sim >= DEFAULT_THRESHOLD


def test_cosine_at_0_91_is_below_threshold():
    b = _unit_vector_at_cosine(0.91)
    sim = cosine(REFERENCE, b)
    assert sim == pytest.approx(0.91)
    assert sim < DEFAULT_THRESHOLD


def test_cosine_at_exact_threshold_is_included():
    b = _unit_vector_at_cosine(DEFAULT_THRESHOLD)
    sim = cosine(REFERENCE, b)
    assert sim == pytest.approx(DEFAULT_THRESHOLD)


def test_pick_cluster_clusters_pair_at_0_93():
    embedding = REFERENCE
    candidates = [(1, 100, _unit_vector_at_cosine(0.93))]
    result = pick_cluster(embedding, candidates)
    assert result is not None
    cluster_id, similarity = result
    assert cluster_id == 1
    assert similarity == pytest.approx(0.93)


def test_pick_cluster_does_not_cluster_pair_at_0_91():
    embedding = REFERENCE
    candidates = [(1, 100, _unit_vector_at_cosine(0.91))]
    result = pick_cluster(embedding, candidates)
    assert result is None


def test_pick_cluster_includes_exact_threshold_boundary():
    embedding = REFERENCE
    candidates = [(1, 100, _unit_vector_at_cosine(DEFAULT_THRESHOLD))]
    result = pick_cluster(embedding, candidates)
    assert result is not None
    cluster_id, similarity = result
    assert cluster_id == 1
    assert similarity == pytest.approx(DEFAULT_THRESHOLD)


def test_pick_cluster_returns_higher_similarity_candidate_when_both_pass():
    embedding = REFERENCE
    candidates = [
        (1, 100, _unit_vector_at_cosine(0.93)),
        (2, 101, _unit_vector_at_cosine(0.97)),
    ]
    result = pick_cluster(embedding, candidates)
    assert result is not None
    cluster_id, similarity = result
    assert cluster_id == 2
    assert similarity == pytest.approx(0.97)


def test_pick_cluster_empty_candidates_returns_none():
    result = pick_cluster(REFERENCE, [])
    assert result is None


def test_pick_cluster_respects_custom_threshold():
    embedding = REFERENCE
    candidates = [(1, 100, _unit_vector_at_cosine(0.80))]
    assert pick_cluster(embedding, candidates, threshold=0.5) == (1, pytest.approx(0.80))
    assert pick_cluster(embedding, candidates, threshold=0.9) is None


# --- max_similarity: graded novelty, added after real-run feedback ---------

def test_max_similarity_returns_zero_with_no_candidates():
    from abovefold_worker.dedupe import max_similarity
    assert max_similarity([1.0, 0.0], []) == 0.0


def test_max_similarity_reports_below_threshold_neighbours():
    """The whole point: pick_cluster discards these, novelty needs them."""
    from abovefold_worker.dedupe import max_similarity, pick_cluster
    v = [1.0, 0.0]
    near = [0.8, 0.6]          # cosine 0.8, well below the 0.92 clustering bar
    candidates = [(1, 1, near)]
    assert pick_cluster(v, candidates) is None
    assert max_similarity(v, candidates) == pytest.approx(0.8)


def test_max_similarity_picks_the_nearest_of_many():
    from abovefold_worker.dedupe import max_similarity
    v = [1.0, 0.0]
    candidates = [(1, 1, [0.0, 1.0]), (2, 2, [0.6, 0.8]), (3, 3, [0.28, 0.96])]
    assert max_similarity(v, candidates) == pytest.approx(0.6)
