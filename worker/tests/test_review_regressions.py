"""Regression tests for defects found in adversarial review.

Each test names the failure it prevents. These are the paths that were silent:
they burned money or lost articles without raising anything.
"""
import httpx
import pytest

from abovefold_worker.config import Settings
from abovefold_worker.embed import EmbedError, embed_batch_with_cost
from abovefold_worker.summarize import Summary, SummarizeError, summarize

SETTINGS = Settings.from_env({
    "DATABASE_URL": "postgres://x", "MINIFLUX_URL": "http://m",
    "MINIFLUX_API_TOKEN": "t", "OPENROUTER_API_KEY": "k",
})


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


# --- finding 4: a short embeddings response re-aligns every later vector ----

def test_short_embedding_response_is_refused_not_misaligned():
    """Returning 2 vectors for 3 inputs would attach vectors to the WRONG
    articles once sorted by index, plausible, silent, undetectable."""
    def handler(request):
        return httpx.Response(200, json={"data": [
            {"index": 0, "embedding": [0.1] * 1536},
            {"index": 1, "embedding": [0.2] * 1536},
        ]})
    with pytest.raises(EmbedError, match="expected 3 embeddings, got 2"):
        embed_batch_with_cost(["a", "b", "c"], SETTINGS, _client(handler))


def test_wrong_dimension_embedding_is_refused():
    def handler(request):
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [0.1] * 768}]})
    with pytest.raises(EmbedError, match="768 dims"):
        embed_batch_with_cost(["a"], SETTINGS, _client(handler))


# --- finding 3: embedding spend must be visible to the cap -----------------

def test_embedding_cost_is_reported():
    def handler(request):
        return httpx.Response(200, json={
            "data": [{"index": 0, "embedding": [0.1] * 1536}],
            "usage": {"cost": 0.000042},
        })
    _, cost = embed_batch_with_cost(["a"], SETTINGS, _client(handler))
    assert cost == pytest.approx(0.000042)


# --- finding 2: the rate table must not silently undercount a real charge ---

def test_reported_cost_beats_the_rate_table():
    """An unknown model was billed at flash-lite rates, a 150x undercount for
    a frontier model, letting a $5 cap run to roughly $750 of real spend."""
    expensive = Settings.from_env({
        "DATABASE_URL": "p", "MINIFLUX_URL": "m", "MINIFLUX_API_TOKEN": "t",
        "OPENROUTER_API_KEY": "k", "ABOVEFOLD_SUMMARY_MODEL": "anthropic/claude-opus-4.1",
    })

    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"tldr":"t","bullets":["a","b","c"],"topics":["x"]}'}}],
            "usage": {"prompt_tokens": 100000, "completion_tokens": 1000, "cost": 1.575},
        })
    s = summarize("t", "body", expensive, _client(handler))
    assert s.cost_usd == pytest.approx(1.575), "must use the charge OpenRouter reports"


def test_falls_back_to_rate_table_when_cost_absent():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"tldr":"t","bullets":["a"],"topics":["x"]}'}}],
            "usage": {"prompt_tokens": 1_000_000, "completion_tokens": 0},
        })
    s = summarize("t", "body", SETTINGS, _client(handler))
    assert s.cost_usd == pytest.approx(0.10)


# --- finding 1: a bad shape must fail BEFORE it reaches psycopg ------------

def test_object_shaped_topics_raise_instead_of_poisoning_the_transaction():
    """A dict in topics used to raise on the text[] bind AFTER the paid call,
    rolling back the batch and re-paying for all of it on the next run."""
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content":
                '{"tldr":"t","bullets":["a","b","c"],"topics":[{"unexpected":1}]}'}}],
            "usage": {},
        })
    with pytest.raises(SummarizeError, match="topics"):
        summarize("t", "body", SETTINGS, _client(handler))


def test_object_shaped_topics_with_a_usable_field_are_coerced():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content":
                '{"tldr":"t","bullets":["a","b","c"],"topics":[{"name":"ai"}]}'}}],
            "usage": {},
        })
    assert summarize("t", "body", SETTINGS, _client(handler)).topics == ["ai"]


def test_non_string_tldr_is_refused():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"tldr":{"a":1},"bullets":[],"topics":[]}'}}],
            "usage": {},
        })
    with pytest.raises(SummarizeError, match="tldr"):
        summarize("t", "body", SETTINGS, _client(handler))


def test_completion_is_bounded():
    """No max_tokens meant a runaway completion billed without limit."""
    captured = {}

    def handler(request):
        import json as _json
        captured.update(_json.loads(request.content))
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"tldr":"t","bullets":["a"],"topics":["x"]}'}}],
            "usage": {},
        })
    summarize("t", "body", SETTINGS, _client(handler))
    assert captured["max_tokens"] > 0
