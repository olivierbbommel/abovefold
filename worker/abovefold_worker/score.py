"""The scoring function, the heart of the Today view.

Pure function: no I/O, no clock, no network, no database. `age_hours` is
supplied by the caller, never computed here from `now()`. See spec §4,
"Scoring, and why it is deliberately not a black box".

Cold start: when there is no interaction history yet, callers pass
relevance=0.5 and source_affinity=0.5. This module does not special-case
that, the neutral values do the work, and ranking quality simply improves
as real relevance/affinity data accumulates.
"""

from dataclasses import dataclass

W_RELEVANCE = 0.35
W_SOURCE = 0.20
W_NOVELTY = 0.20
W_RECENCY = 0.15
W_NOISE = 0.10
RECENCY_HALF_LIFE_HOURS = 24.0
REASON_MARGIN = 0.02   # below this the field is a tie, not a driver
STRONG_NOVELTY = 0.85  # only above this may we claim nothing similar exists
FRESH_HOURS = 6.0
# Floors on the RAW (unweighted) feature value before the "strong match" /
# "you open X often" reason lines may fire. Picking the dominant driver by
# WEIGHTED value (see _reason below) means relevance, the largest weight , 
# can win a tie it hasn't earned: at the neutral cold-start placeholder
# (0.5) with every other feature also at 0.5, relevance still comes out on
# top by weight alone, and "strong match" at a value that means "no signal
# either way" would be a lie. 0.6 is meaningfully above that 0.5 neutral
# point, enough that real evidence clears it and the placeholder cannot.
RELEVANCE_MATCH_FLOOR = 0.6
SOURCE_MATCH_FLOOR = 0.6


@dataclass(frozen=True)
class Features:
    relevance: float  # 0..1, cosine to interest centroid
    source_affinity: float  # 0..1, smoothed open rate for the feed
    novelty: float  # 0..1, 1 - max similarity to already-read
    age_hours: float
    noise_penalty: float  # 0..1
    cluster_size: int
    source_name: str
    top_topic: str | None
    personalised: bool = False   # True once real interaction history exists


@dataclass(frozen=True)
class Scored:
    final: float
    relevance: float
    source_affinity: float
    novelty: float
    recency: float
    noise_penalty: float
    reason: str


def score(features: Features) -> Scored:
    recency = 0.5 ** (features.age_hours / RECENCY_HALF_LIFE_HOURS)

    final = (
        W_RELEVANCE * features.relevance
        + W_SOURCE * features.source_affinity
        + W_NOVELTY * features.novelty
        + W_RECENCY * recency
        - W_NOISE * features.noise_penalty
    )

    return Scored(
        final=final,
        relevance=features.relevance,
        source_affinity=features.source_affinity,
        novelty=features.novelty,
        recency=recency,
        noise_penalty=features.noise_penalty,
        reason=_reason(features, recency),
    )


def _reason(features: Features, recency: float) -> str:
    """One short line explaining the rank. Every line must be literally true.

    Before personalisation exists there is nothing to say about "your reading",
    so the cold-start branch states only what was actually measured: how many
    sources carried the story, whether anything similar exists in the corpus,
    and how fresh it is.
    """
    suffix = f" \u00b7 {features.cluster_size} sources" if features.cluster_size > 1 else ""

    if not features.personalised:
        if features.cluster_size > 1:
            return f"Covered by {features.cluster_size} of your sources"
        if features.novelty >= STRONG_NOVELTY:
            return "No similar story in your feeds"
        if features.age_hours <= FRESH_HOURS:
            return "Just published"
        return f"New from {features.source_name}" if features.source_name else "New today"

    # Personalised: the dominant driver among the four positive weighted terms.
    # noise_penalty is a subtraction and never gets to claim credit.
    weighted = {
        "relevance": W_RELEVANCE * features.relevance,
        "source": W_SOURCE * features.source_affinity,
        "novelty": W_NOVELTY * features.novelty,
        "recency": W_RECENCY * recency,
    }
    ranked = sorted(weighted.items(), key=lambda kv: kv[1], reverse=True)
    dominant, top = ranked[0]
    runner_up = ranked[1][1]

    if top - runner_up < REASON_MARGIN:
        base = f"New from {features.source_name}" if features.source_name else "New today"
        return base + suffix

    # Winning on weighted value is not enough for relevance/source to claim
    # a match, a value at or near the neutral placeholder (0.5) must never
    # be described as "strong" or "often" just because it happened to carry
    # the largest weight. Below the floor, fall through to the same honest
    # default the tie case above uses.
    if dominant == "relevance" and features.relevance >= RELEVANCE_MATCH_FLOOR:
        base = (f"Strong match to your interest in {features.top_topic}"
                if features.top_topic else "Strong match to your reading")
    elif dominant == "source" and features.source_affinity >= SOURCE_MATCH_FLOOR:
        base = (f"You open {features.source_name} often"
                if features.source_name else "From a source you read often")
    elif dominant == "novelty":
        base = ("No similar story in your feeds" if features.novelty >= STRONG_NOVELTY
                else "A fresh angle for you")
    elif dominant == "recency":
        base = "Just published"
    else:
        base = f"New from {features.source_name}" if features.source_name else "New today"

    return base + suffix
