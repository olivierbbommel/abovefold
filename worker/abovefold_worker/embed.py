"""OpenRouter embeddings client.

Batches texts to the OpenRouter embeddings endpoint (OpenAI-compatible
`/api/v1/embeddings`), truncating oversized inputs and re-sorting each
response by its `index` field since the API does not guarantee response
order matches request order.
"""
from __future__ import annotations

import httpx

EMBED_DIM = 1536
MAX_BATCH = 100
MAX_CHARS = 8000

_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"


class EmbedError(Exception):
    """Raised on any non-2xx response from the OpenRouter embeddings API."""


EMBED_RATE_PER_M = 0.02   # openai/text-embedding-3-small list price


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _embed_chunk(chunk: list[str], settings, http: httpx.Client) -> tuple[list[list[float]], float]:
    response = http.post(
        _EMBEDDINGS_URL,
        headers={"Authorization": f"Bearer {settings.openrouter_key}"},
        json={"model": settings.embed_model, "input": chunk, "usage": {"include": True}},
    )
    if not response.is_success:
        raise EmbedError(f"POST /embeddings failed: {response.status_code} {response.text}")

    payload = response.json()
    data = payload.get("data") or []
    # A short response would silently re-align EVERY subsequent embedding onto
    # the wrong article once sorted by index, plausible vectors, wrong stories,
    # undetectable downstream. Refuse rather than corrupt.
    if len(data) != len(chunk):
        raise EmbedError(f"expected {len(chunk)} embeddings, got {len(data)}")

    ordered = sorted(data, key=lambda d: d.get("index", 0))
    vectors = [d["embedding"] for d in ordered]
    for v in vectors:
        if len(v) != EMBED_DIM:
            raise EmbedError(f"embedding has {len(v)} dims, expected {EMBED_DIM}")

    usage = payload.get("usage") or {}
    reported = usage.get("cost")
    if isinstance(reported, (int, float)) and reported >= 0:
        cost = float(reported)
    else:
        cost = (usage.get("prompt_tokens", 0) / 1e6) * EMBED_RATE_PER_M
    return vectors, cost


def embed_batch(texts: list[str], settings, http: httpx.Client | None = None) -> list[list[float]]:
    """Vectors in input order. See embed_batch_with_cost for the spend."""
    return embed_batch_with_cost(texts, settings, http)[0]


def embed_batch_with_cost(
    texts: list[str], settings, http: httpx.Client | None = None
) -> tuple[list[list[float]], float]:
    if not texts:
        return [], 0.0
    client = http if http is not None else httpx.Client(timeout=60)
    truncated = [t[:MAX_CHARS] for t in texts]

    vectors: list[list[float]] = []
    total_cost = 0.0
    for chunk in _chunks(truncated, MAX_BATCH):
        vecs, cost = _embed_chunk(chunk, settings, client)
        vectors.extend(vecs)
        total_cost += cost

    if len(vectors) != len(texts):
        raise EmbedError(f"expected {len(texts)} embeddings, got {len(vectors)}")
    return vectors, total_cost
