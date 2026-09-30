import json

import httpx
import pytest

from abovefold_worker.config import Settings
from abovefold_worker.embed import EMBED_DIM, MAX_BATCH, MAX_CHARS, EmbedError, embed_batch


def make_settings() -> Settings:
    return Settings(
        database_url="postgresql://x",
        miniflux_url="http://miniflux:8080",
        miniflux_token="tok",
        openrouter_key="or-key",
        embed_model="openai/text-embedding-3-small",
    )


def fake_embedding_response(texts: list[str]) -> dict:
    return {
        "data": [
            {"embedding": [float(i)] * EMBED_DIM, "index": i}
            for i in range(len(texts))
        ]
    }


def test_embed_batch_empty_list_makes_no_requests():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"data": []})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    result = embed_batch([], make_settings(), http=http)

    assert result == []
    assert calls == []


def test_embed_batch_splits_into_chunks_of_max_batch():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body["input"])
        return httpx.Response(200, json=fake_embedding_response(body["input"]))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    texts = [f"text-{i}" for i in range(250)]
    result = embed_batch(texts, make_settings(), http=http)

    assert len(calls) == 3
    assert [len(c) for c in calls] == [MAX_BATCH, MAX_BATCH, 50]
    assert len(result) == 250


def test_embed_batch_returns_vectors_of_correct_dimension():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        return httpx.Response(200, json=fake_embedding_response(body["input"]))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    result = embed_batch(["a", "b", "c"], make_settings(), http=http)

    assert len(result) == 3
    for vec in result:
        assert len(vec) == EMBED_DIM


def test_embed_batch_truncates_long_text_in_request_body():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        captured["input"] = body["input"]
        return httpx.Response(200, json=fake_embedding_response(body["input"]))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    long_text = "x" * (MAX_CHARS + 500)
    embed_batch([long_text], make_settings(), http=http)

    assert len(captured["input"][0]) == MAX_CHARS
    assert captured["input"][0] == "x" * MAX_CHARS


def test_embed_batch_reorders_out_of_order_response_by_index():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        n = len(body["input"])
        # Return responses in reverse index order to prove re-sorting happens.
        data = [
            {"embedding": [float(i)] * EMBED_DIM, "index": i}
            for i in reversed(range(n))
        ]
        return httpx.Response(200, json={"data": data})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    result = embed_batch(["a", "b", "c"], make_settings(), http=http)

    assert result[0][0] == 0.0
    assert result[1][0] == 1.0
    assert result[2][0] == 2.0


def test_embed_batch_sends_auth_header_and_model():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        body = json.loads(request.content)
        captured["body"] = body
        return httpx.Response(200, json=fake_embedding_response(body["input"]))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    settings = make_settings()
    embed_batch(["a"], settings, http=http)

    req = captured["request"]
    assert req.url == "https://openrouter.ai/api/v1/embeddings"
    assert req.headers["Authorization"] == f"Bearer {settings.openrouter_key}"
    assert captured["body"]["model"] == settings.embed_model


def test_embed_batch_raises_embed_error_on_429():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate limited"})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(EmbedError):
        embed_batch(["a"], make_settings(), http=http)


def test_embed_batch_raises_embed_error_includes_status_code():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with pytest.raises(EmbedError, match="500"):
        embed_batch(["a"], make_settings(), http=http)
