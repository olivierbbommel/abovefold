"""Environment-derived settings for the abovefold worker."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

REQUIRED = ("DATABASE_URL", "MINIFLUX_URL", "MINIFLUX_API_TOKEN", "OPENROUTER_API_KEY")

DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small"
DEFAULT_SUMMARY_MODEL = "google/gemini-2.5-flash-lite"
DEFAULT_POLL_SECONDS = 300
DEFAULT_COST_CAP_USD = 5.0


@dataclass(frozen=True)
class Settings:
    database_url: str
    miniflux_url: str
    miniflux_token: str
    openrouter_key: str
    embed_model: str = DEFAULT_EMBED_MODEL
    summary_model: str = DEFAULT_SUMMARY_MODEL
    monthly_cost_cap_usd: float = DEFAULT_COST_CAP_USD
    poll_seconds: int = DEFAULT_POLL_SECONDS

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        missing = [k for k in REQUIRED if not env.get(k)]
        if missing:
            raise ValueError(f"missing required environment: {', '.join(missing)}")
        return cls(
            database_url=env["DATABASE_URL"],
            miniflux_url=env["MINIFLUX_URL"].rstrip("/"),
            miniflux_token=env["MINIFLUX_API_TOKEN"],
            openrouter_key=env["OPENROUTER_API_KEY"],
            embed_model=env.get("ABOVEFOLD_EMBED_MODEL") or DEFAULT_EMBED_MODEL,
            summary_model=env.get("ABOVEFOLD_SUMMARY_MODEL") or DEFAULT_SUMMARY_MODEL,
            monthly_cost_cap_usd=float(
                env.get("ABOVEFOLD_MONTHLY_COST_CAP_USD") or DEFAULT_COST_CAP_USD
            ),
            poll_seconds=int(env.get("ABOVEFOLD_POLL_SECONDS") or DEFAULT_POLL_SECONDS),
        )
