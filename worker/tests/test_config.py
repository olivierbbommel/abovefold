import pytest
from abovefold_worker.config import Settings

BASE = {
    "DATABASE_URL": "postgres://u:p@db/abovefold",
    "MINIFLUX_URL": "http://miniflux:8080/",
    "MINIFLUX_API_TOKEN": "tok",
    "OPENROUTER_API_KEY": "sk-or-v1-x",
}


def test_from_env_reads_required_values():
    s = Settings.from_env(BASE)
    assert s.database_url == "postgres://u:p@db/abovefold"
    assert s.miniflux_token == "tok"


def test_from_env_strips_trailing_slash_on_url():
    assert Settings.from_env(BASE).miniflux_url == "http://miniflux:8080"


def test_from_env_applies_defaults():
    s = Settings.from_env(BASE)
    assert s.embed_model == "openai/text-embedding-3-small"
    assert s.summary_model == "google/gemini-2.5-flash-lite"
    assert s.poll_seconds == 300
    assert s.monthly_cost_cap_usd == 5.0


def test_from_env_rejects_missing_key():
    broken = {k: v for k, v in BASE.items() if k != "OPENROUTER_API_KEY"}
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        Settings.from_env(broken)
