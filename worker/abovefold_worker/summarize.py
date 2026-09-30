"""Article summarisation via OpenRouter chat completions.

Summarises the canonical article of a cluster only, never every member , 
enforced by the caller in the pipeline.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from .config import Settings

MAX_CHARS = 12000
MAX_COMPLETION_TOKENS = 700   # a TLDR + 3 bullets; a runaway completion is a bug, not content

# USD per 1M tokens, as (prompt_rate, completion_rate).
MODEL_RATES = {
    "google/gemini-2.5-flash-lite": (0.10, 0.40),
    "google/gemini-2.5-flash-lite:batch": (0.05, 0.20),
    "openai/gpt-5-nano": (0.05, 0.40),
}
DEFAULT_RATE = (0.10, 0.40)

_API_URL = "https://openrouter.ai/api/v1/chat/completions"
_REQUIRED_KEYS = ("tldr", "bullets", "topics")

_SYSTEM_PROMPT = (
    "You summarise news articles. Respond with a single JSON object with exactly "
    "these keys: `tldr` (a 2-3 sentence summary), `bullets` (exactly 3 short strings "
    "highlighting key points), and `topics` (2-5 short lowercase topic tags). "
    "Summarise only what the article says. Never speculate, infer beyond the text, "
    "or add outside knowledge."
)


class SummarizeError(Exception):
    """Raised when OpenRouter fails or returns a response we can't use."""


@dataclass(frozen=True)
class Summary:
    tldr: str
    bullets: list[str]
    topics: list[str]
    cost_usd: float
    prompt_tokens: int = 0
    completion_tokens: int = 0


def _build_messages(title: str, text: str) -> list[dict]:
    truncated = text[:MAX_CHARS]
    user_content = f"Title: {title}\n\nArticle:\n{truncated}"
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def _validate_str_list(value, field: str) -> list[str]:
    """Models return shapes we did not ask for. A dict here reaches psycopg as a
    text[] bind and raises AFTER the paid call, which (before this guard) rolled
    the whole batch back and re-paid for it on the next run."""
    if not isinstance(value, list):
        raise SummarizeError(f"{field} is {type(value).__name__}, expected list")
    out = []
    for item in value:
        if isinstance(item, str):
            out.append(item)
        elif isinstance(item, dict):
            picked = item.get("text") or item.get("name") or item.get("value")
            if not isinstance(picked, str):
                raise SummarizeError(f"{field} contains an unusable object")
            out.append(picked)
        else:
            out.append(str(item))
    return out


def _compute_cost(usage: dict | None, model: str) -> float:
    """Prefer the charge OpenRouter reports; fall back to the rate table.

    The table only knows three models, so any other model set via
    ABOVEFOLD_SUMMARY_MODEL was billed at flash-lite rates, a 150x undercount
    for a frontier model, which would let a $5 cap run to ~$750 of real spend.
    `usage.cost` is authoritative and model-agnostic.
    """
    if not usage:
        return 0.0
    reported = usage.get("cost")
    if isinstance(reported, (int, float)) and reported >= 0:
        return float(reported)
    rate_in, rate_out = MODEL_RATES.get(model, DEFAULT_RATE)
    return (usage.get("prompt_tokens", 0) / 1e6) * rate_in + \
           (usage.get("completion_tokens", 0) / 1e6) * rate_out


def summarize(title: str, text: str, settings: Settings, http: httpx.Client | None = None) -> Summary:
    client = http if http is not None else httpx.Client(timeout=120)

    response = client.post(
        _API_URL,
        headers={"Authorization": f"Bearer {settings.openrouter_key}"},
        json={
            "model": settings.summary_model,
            "messages": _build_messages(title, text),
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
            "max_tokens": MAX_COMPLETION_TOKENS,
            "usage": {"include": True},   # ask for the real charge, not our guess
        },
    )
    if not response.is_success:
        raise SummarizeError(
            f"POST /chat/completions failed: {response.status_code} {response.text}"
        )

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise SummarizeError(f"unexpected response shape: {exc}") from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SummarizeError(f"model returned malformed JSON: {exc}") from exc

    missing = [k for k in _REQUIRED_KEYS if k not in parsed]
    if missing:
        raise SummarizeError(f"model response missing keys: {', '.join(missing)}")

    usage = data.get("usage") or {}
    tldr = parsed["tldr"]
    if not isinstance(tldr, str):
        raise SummarizeError(f"tldr is {type(tldr).__name__}, expected str")

    return Summary(
        tldr=tldr,
        bullets=_validate_str_list(parsed["bullets"], "bullets"),
        topics=_validate_str_list(parsed["topics"], "topics"),
        cost_usd=_compute_cost(usage, settings.summary_model),
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
    )
