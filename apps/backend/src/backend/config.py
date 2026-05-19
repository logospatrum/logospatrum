from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Repo root is 4 levels up from this file: apps/backend/src/backend/config.py
REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        extra="ignore",
    )

    postgres_dsn: str = "postgresql://postgres:postgres@localhost:5432/patristic"

    # OpenAI-compatible model endpoint. Generic names so the repo is provider-
    # agnostic; the actual cloud is configured via env, not code.
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    main_agent_model: str = "anthropic/claude-sonnet-4-6"
    search_agent_model: str = "anthropic/claude-haiku-4-5"

    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cpu"
    embedding_batch_size: int = 16
    embedding_batch_window_ms: int = 50

    # Path to glossary.json (shared with pipeline)
    glossary_path: Path = REPO_ROOT / "packages" / "pipeline" / "glossary.json"
    cs_dict_path: Path = REPO_ROOT / "packages" / "pipeline" / "cs_dict.json"

    # === anti-abuse / budget ===
    pat_session_secret: str = ""  # 32-byte hex; required in prod
    # Comma-separated origins for CORS. Dev default covers both 3001 (the
    # project's chosen frontend port — see apps/frontend/CLAUDE.md) and 3000
    # (legacy). Production must override with the real domain.
    allowed_origin: str = "http://localhost:3001,http://localhost:3000"
    daily_rub_per_cookie: float = 500.0
    daily_rub_per_ip: float = 250.0
    # Per-day cap for the soft fingerprint bucket (UA + Accept-Language + IP/24
    # prefix). Catches "open incognito, same browser, same network" — a single
    # person resetting cookies. Set higher than the cookie cap because the fp
    # bucket can legitimately collide for 2-3 family members on the same router
    # with the same browser version.
    daily_rub_per_fp: float = 1000.0
    soft_warn_ratio: float = 0.8
    global_monthly_kill_rub: float = 30_000.0
    budget_guard_enabled: bool = True


settings = Settings()
