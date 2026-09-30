"""Near-duplicate clustering by embedding cosine similarity.

Pure functions, no I/O, see spec §4 step 5. `pick_cluster` is called with the
new article's embedding and every cluster candidate seen in the last 48h
(that window is enforced by the caller, not here).
"""

import math

DEFAULT_THRESHOLD = 0.92


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors.

    Returns 0.0 (never raises, never NaN) when either vector has zero
    magnitude.
    """
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def pick_cluster(
    embedding: list[float],
    candidates: list[tuple[int, int, list[float]]],
    threshold: float = DEFAULT_THRESHOLD,
) -> tuple[int, float] | None:
    """Return the best-matching cluster for `embedding`, or None.

    `candidates` is a list of (cluster_id, article_id, embedding) tuples.
    Returns (cluster_id, similarity) for the candidate with the highest
    similarity that is >= threshold, or None if no candidate qualifies
    (including when `candidates` is empty).
    """
    best: tuple[int, float] | None = None
    for cluster_id, _article_id, candidate_embedding in candidates:
        similarity = cosine(embedding, candidate_embedding)
        if similarity >= threshold and (best is None or similarity > best[1]):
            best = (cluster_id, similarity)
    return best


def max_similarity(
    embedding: list[float],
    candidates: list[tuple[int, int, list[float]]],
) -> float:
    """Highest cosine to ANY candidate, regardless of the clustering threshold.

    `pick_cluster` answers "is this a duplicate?" and throws away the score when
    the answer is no. Novelty needs the score itself: an article that is 0.80
    similar to something you already read is genuinely less novel than one at
    0.10, even though neither clusters. Returns 0.0 when there are no candidates.
    """
    if not candidates:
        return 0.0
    return max(cosine(embedding, vec) for _, _, vec in candidates)
