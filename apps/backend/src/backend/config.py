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

    timeweb_ai_key: str = ""
    timeweb_base_url: str = "https://api.timeweb.ai/v1"
    # Timeweb AI proxy supports up to claude-sonnet-4-6 (no 4-7 yet).
    # Confirmed via GET /v1/models on 2026-05-16.
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
    allowed_origin: str = "http://localhost:3000"
    daily_rub_per_cookie: float = 500.0
    daily_rub_per_ip: float = 250.0
    soft_warn_ratio: float = 0.8
    global_monthly_kill_rub: float = 30_000.0
    budget_guard_enabled: bool = True


settings = Settings()
