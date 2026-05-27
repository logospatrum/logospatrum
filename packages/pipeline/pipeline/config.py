import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    postgres_dsn: str = "postgresql://postgres:postgres@localhost:5432/patristic"

    # OpenAI-compatible model endpoint for enrich + concepts-bootstrap.
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    enrich_model: str = "anthropic/claude-haiku-4-5"

    # Local LLM (LM Studio) for bulk enrich
    lmstudio_base_url: str = "http://localhost:1234/v1"
    lmstudio_model: str = "qwen/qwen3.5-9b"
    enrich_provider: str = "openai"  # "openai" | "local"

    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cuda"
    embedding_batch_size: int = 32

    # Paths (relative to package root by default; OUTPUT_DIR env overrides for subsets)
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    output_dir: Path = Path(os.environ.get("OUTPUT_DIR") or
                            (Path(__file__).resolve().parent.parent / "output"))
    glossary_path: Path = Path(__file__).resolve().parent.parent / "glossary.json"
    seed_concepts_path: Path = Path(__file__).resolve().parent.parent / "seed_concepts.json"
    cs_dict_path: Path = Path(__file__).resolve().parent.parent / "cs_dict.json"

    # Used by the legacy Scraper/Downloader/MarkdownConverter classes when
    # they're driven from a typer subcommand (e.g. ingest-azbyka). Lists the
    # library/index URLs to walk. Optional — most flows derive URLs elsewhere.
    libraries_file: Path = Path(__file__).resolve().parent.parent / "libraries.txt"


settings = Settings()

# Backwards-compat alias: scrape.py / download.py / markdown_convert.py
# (the legacy import path) refer to `Config` rather than `Settings`.
Config = Settings
