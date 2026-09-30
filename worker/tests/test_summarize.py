import json

import httpx
import pytest

from abovefold_worker.config import Settings
from abovefold_worker.summarize import MAX_CHARS, SummarizeError, Summary, summarize


def make_settings(model: str = "google/gemini-2.5-flash-lite") -> Settings:
    return Settings(
        database_url="postgresql://x",
        miniflux_url="http://miniflux:8080",
        miniflux_token="tok",
        openrouter_key="or-key",
        summary_model=model,
    )


def make_http(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def completion_response(content: dict, usage: dict | None = None, status: int = 200) -> httpx.Response:
    body = {"choices": [{"message": {"content": json.dumps(content)}}]}
    if usage is not None:
        body["usage"] = usage
    return httpx.Response(status, json=body)


WELL_FORMED = {
    "tldr": "A thing happened. It matters for X reasons.",
    "bullets": ["First point", "Second point", "Third point"],
    "topics": ["ai", "policy"],
}


def test_well_formed_response_parses_into_summary():
    def handler(request: httpx.Request) -> httpx.Response:
        return completion_response(WELL_FORMED, usage={"prompt_tokens": 1000, "completion_tokens": 200})

    settings = make_settings()
    result = summarize("Title", "Some article body.", settings, http=make_http(handler))

    assert isinstance(result, Summary)
    assert result.tldr == WELL_FORMED["tldr"]
    assert result.bullets == WELL_FORMED["bullets"]
    assert len(result.bullets) == 3
    assert result.topics == WELL_FORMED["topics"]


def test_request_shape():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return completion_response(WELL_FORMED, usage={"prompt_tokens": 10, "completion_tokens": 5})

    settings = make_settings()
    summarize("My Title", "Body text.", settings, http=make_http(handler))

    req = captured["request"]
    assert req.method == "POST"
    assert req.url == "https://openrouter.ai/api/v1/chat/completions"
    assert req.headers["Authorization"] == "Bearer or-key"

    body = json.loads(req.content)
    assert body["model"] == settings.summary_model
    assert body["response_format"] == {"type": "json_object"}
    assert body["temperature"] == 0.2
    assert isinstance(body["messages"], list) and len(body["messages"]) >= 1


def test_cost_usd_computed_from_known_usage_block():
    def handler(request: httpx.Request) -> httpx.Response:
        return completion_response(
            WELL_FORMED, usage={"prompt_tokens": 2_000_000, "completion_tokens": 500_000}
        )

    settings = make_settings("google/gemini-2.5-flash-lite")
    result = summarize("Title", "Body.", settings, http=make_http(handler))

    # rate = (0.10, 0.40) USD per 1M tokens
    expected = (2_000_000 / 1e6) * 0.10 + (500_000 / 1e6) * 0.40
    assert result.cost_usd == pytest.approx(expected)
    assert result.cost_usd == pytest.approx(0.4)


def test_cost_usd_uses_default_rate_for_unknown_model():
    def handler(request: httpx.Request) -> httpx.Response:
        return completion_response(
            WELL_FORMED, usage={"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}
        )

    settings = make_settings("some/unknown-model")
    result = summarize("Title", "Body.", settings, http=make_http(handler))

    expected = (1_000_000 / 1e6) * 0.10 + (1_000_000 / 1e6) * 0.40
    assert result.cost_usd == pytest.approx(expected)


def test_malformed_json_content_raises_summarize_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "not valid json {"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )

    settings = make_settings()
    with pytest.raises(SummarizeError):
        summarize("Title", "Body.", settings, http=make_http(handler))


def test_valid_json_missing_tldr_raises_summarize_error():
    content = {"bullets": ["a", "b", "c"], "topics": ["x"]}

    def handler(request: httpx.Request) -> httpx.Response:
        return completion_response(content, usage={"prompt_tokens": 10, "completion_tokens": 5})

    settings = make_settings()
    with pytest.raises(SummarizeError):
        summarize("Title", "Body.", settings, http=make_http(handler))


def test_missing_usage_block_gives_zero_cost_without_raising():
    def handler(request: httpx.Request) -> httpx.Response:
        return completion_response(WELL_FORMED, usage=None)

    settings = make_settings()
    result = summarize("Title", "Body.", settings, http=make_http(handler))

    assert result.cost_usd == 0.0


def test_text_longer_than_max_chars_is_truncated_in_request_body():
    long_text = "x" * (MAX_CHARS + 5000)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return completion_response(WELL_FORMED, usage={"prompt_tokens": 10, "completion_tokens": 5})

    settings = make_settings()
    summarize("Title", long_text, settings, http=make_http(handler))

    body = json.loads(captured["request"].content)
    full_body_text = json.dumps(body)
    assert "x" * (MAX_CHARS + 1) not in full_body_text
    assert "x" * MAX_CHARS in full_body_text


def test_non_200_raises_summarize_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    settings = make_settings()
    with pytest.raises(SummarizeError):
        summarize("Title", "Body.", settings, http=make_http(handler))
