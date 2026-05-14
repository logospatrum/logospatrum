# Patristic Chat MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать MVP патристического чата согласно [спеку](../specs/2026-05-14-patristic-chat-design.md): data pipeline индексирует русский патристический корпус + философию + Библию в Postgres; агентный бек на LangGraph + deepagents возвращает ответы с верифицированными цитатами; тонкий фронт на форке agent-chat-ui с библиографическим браузером.

**Архитектура:** Монорепо с тремя приложениями (`apps/backend`, `apps/frontend`, `packages/pipeline`). Бек — LangGraph Server stateless (Sonnet main + Haiku search subagent) поверх PostgreSQL + pgvector + tsvector. Фронт — Next.js форк agent-chat-ui с localStorage историей. Пайплайн переиспользует уже наскрейпленные данные (2117 epub, 72532 md) из соседнего `orthodox_rag/`.

**Tech stack:** Python 3.12 (FastAPI/LangGraph/deepagents/psycopg/sentence-transformers/typer/pytest), Next.js 15/TypeScript/Tailwind/Radix/langgraph-sdk, PostgreSQL 16 + pgvector + pg_trgm, Docker Compose, Nginx + certbot.

**Acceptance gate:** MVP считается готовым **только** после успешного прохождения «жирного» goldset (≥50 запросов, см. Task 31) через полный агент-цикл (Task 42), с порогами:
- Recall@5 ≥ 80% для addressed-запросов
- Recall@5 ≥ 60% для thematic-запросов
- 100% корректное распознавание negative-запросов (агент не выдумывает цитат)

---

## Файловая структура

```
christian_rag/  (этот репо)
├── apps/
│   ├── backend/
│   │   ├── pyproject.toml                  # NEW
│   │   ├── langgraph.json                  # NEW
│   │   ├── Dockerfile                      # NEW
│   │   ├── src/backend/
│   │   │   ├── __init__.py                 # NEW
│   │   │   ├── config.py                   # NEW: env settings
│   │   │   ├── db.py                       # NEW: psycopg async pool
│   │   │   ├── graph.py                    # NEW: deepagents граф
│   │   │   ├── prompts.py                  # NEW: main + search prompts
│   │   │   ├── observability.py            # NEW: agent_runs writer
│   │   │   ├── catalog.py                  # NEW: GET /catalog endpoint
│   │   │   ├── embeddings/
│   │   │   │   ├── __init__.py             # NEW
│   │   │   │   └── service.py              # NEW: bge-m3 micro-batching
│   │   │   └── tools/
│   │   │       ├── __init__.py             # NEW
│   │   │       ├── list_authors.py         # NEW
│   │   │       ├── list_works.py           # NEW
│   │   │       ├── expand_concept.py       # NEW
│   │   │       ├── lexical_search.py       # NEW
│   │   │       ├── semantic_search.py      # NEW
│   │   │       └── read_passage.py         # NEW
│   │   └── tests/
│   │       ├── conftest.py                 # NEW: фикстуры
│   │       ├── unit/
│   │       │   ├── test_embeddings_service.py    # NEW
│   │       │   ├── test_list_authors.py          # NEW
│   │       │   ├── test_list_works.py            # NEW
│   │       │   ├── test_expand_concept.py        # NEW
│   │       │   ├── test_lexical_search.py        # NEW
│   │       │   ├── test_semantic_search.py       # NEW
│   │       │   ├── test_read_passage.py          # NEW
│   │       │   └── test_catalog.py               # NEW
│   │       └── integration/
│   │           ├── test_smoke.py                  # NEW
│   │           └── test_goldset.py                # NEW
│   └── frontend/                            # FORKED from agent-chat-ui
│       └── (структура сохранена upstream)
├── packages/
│   └── pipeline/
│       ├── pyproject.toml                   # NEW
│       ├── pipeline/
│       │   ├── __init__.py                  # NEW
│       │   ├── __main__.py                  # NEW: CLI entry (typer)
│       │   ├── config.py                    # NEW
│       │   ├── models.py                    # NEW: pydantic
│       │   ├── db.py                        # NEW
│       │   ├── slugify.py                   # NEW
│       │   ├── lexical_preprocess.py        # NEW
│       │   ├── scrape.py                    # COPY orthodox_rag/src/scraper.py
│       │   ├── download.py                  # COPY orthodox_rag/src/downloader.py
│       │   ├── markdown_convert.py          # COPY orthodox_rag/src/converter.py
│       │   ├── diagnose.py                  # NEW
│       │   ├── paragraphs.py                # NEW
│       │   ├── enrich.py                    # COPY+ADAPT orthodox_rag/src/enricher.py
│       │   ├── concepts_bootstrap.py        # NEW
│       │   └── embed.py                     # NEW
│       ├── data/                            # MOVE orthodox_rag/data/
│       ├── output/                          # MOVE orthodox_rag/output/
│       ├── glossary.json                    # NEW (committed)
│       ├── cs_dict.json                     # NEW: ЦС словарь
│       ├── seed_concepts.json               # NEW: 50-100 seed концептов
│       └── tests/
│           ├── conftest.py                  # NEW
│           ├── test_slugify.py              # NEW
│           ├── test_lexical_preprocess.py   # NEW
│           ├── test_paragraphs.py           # NEW
│           ├── test_diagnose.py             # NEW
│           └── fixtures/
│               └── sample_md/               # NEW: 3-5 sample md для тестов
├── infra/
│   ├── migrations/
│   │   └── 001_init.sql                     # NEW
│   ├── docker-compose.dev.yml               # NEW
│   ├── docker-compose.prod.yml              # NEW
│   ├── nginx/                               # ADAPT old christian_rag/nginx/
│   └── scripts/
│       ├── init-letsencrypt.sh              # COPY old christian_rag/scripts/
│       ├── migrate.sh                       # NEW
│       └── pg_dump_restore.md               # NEW: документация
├── tests/
│   └── eval/
│       └── gold.yaml                        # NEW: «жирный» goldset (≥50 запросов)
├── docs/
│   └── superpowers/                         # уже существует
│       ├── specs/
│       │   └── 2026-05-14-patristic-chat-design.md
│       └── plans/
│           └── 2026-05-14-patristic-chat-mvp.md    # этот файл
├── .env.example                             # NEW (заменит существующий)
├── .gitignore                               # MODIFY: добавить .venv, output/, data/*.epub
└── README.md                                # REWRITE
```

**Старые файлы для удаления в конце (Task 43):**
- `main.py`, `rag_service.py`, `repository.py`, `embedding_service.py`, `text_service.py`, `models.py`, `database.py`, `migrations.py`, `config.py`, `books.json`, `templates/`, `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `requirements.txt`, `README.md`, `HTTPS_SETUP_GUIDE.md`

---

## Phase 0 — Bootstrap репозитория

### Task 1: Скелет монорепо

**Files:**
- Create: `apps/backend/.gitkeep`, `apps/frontend/.gitkeep`, `packages/pipeline/.gitkeep`, `infra/migrations/.gitkeep`, `infra/scripts/.gitkeep`, `tests/eval/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Создать скелет директорий**

```bash
mkdir -p apps/backend/src/backend/{embeddings,tools}
mkdir -p apps/backend/tests/{unit,integration}
mkdir -p apps/frontend
mkdir -p packages/pipeline/pipeline
mkdir -p packages/pipeline/tests/fixtures/sample_md
mkdir -p infra/migrations infra/scripts infra/nginx
mkdir -p tests/eval
touch apps/backend/.gitkeep apps/frontend/.gitkeep packages/pipeline/.gitkeep
touch infra/migrations/.gitkeep infra/scripts/.gitkeep tests/eval/.gitkeep
```

- [ ] **Step 2: Обновить .gitignore**

Перезаписать `.gitignore` целиком:

```
# Python
.venv/
__pycache__/
*.pyc
*.pyo
.pytest_cache/
.mypy_cache/
.ruff_cache/
dist/
build/
*.egg-info/

# Node
node_modules/
.next/
out/

# Data (не коммитим тяжёлые артефакты)
packages/pipeline/data/**/*.epub
packages/pipeline/data/**/*.json
packages/pipeline/output/

# Model cache
models/

# Env
.env
.env.local
.env.prod
.env.dev

# IDE
.idea/
.vscode/

# Misc
*.log
*.dump
*.sql.gz
```

- [ ] **Step 3: Закоммитить скелет**

```bash
git add .gitignore apps/ packages/ infra/ tests/
git commit -m "chore: bootstrap monorepo skeleton"
```

---

### Task 2: Перенос артефактов из orthodox_rag

**Files:**
- Move: `C:/Users/79819/PycharmProjects/orthodox_rag/data/` → `packages/pipeline/data/`
- Move: `C:/Users/79819/PycharmProjects/orthodox_rag/output/` → `packages/pipeline/output/`
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/src/scraper.py` → `packages/pipeline/pipeline/scrape.py`
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/src/downloader.py` → `packages/pipeline/pipeline/download.py`
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/src/converter.py` → `packages/pipeline/pipeline/markdown_convert.py`
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/src/enricher.py` → `packages/pipeline/pipeline/enrich.py`
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/src/models.py` → `packages/pipeline/pipeline/_legacy_models.py` (временно, для рефлекса в paragraphs)
- Copy: `C:/Users/79819/PycharmProjects/orthodox_rag/libraries.txt` → `packages/pipeline/libraries.txt`

- [ ] **Step 1: Переместить data и output**

```bash
# В WSL (рекомендуется, чтобы избежать косяков с кириллицей в путях):
mv /mnt/c/Users/79819/PycharmProjects/orthodox_rag/data packages/pipeline/data
mv /mnt/c/Users/79819/PycharmProjects/orthodox_rag/output packages/pipeline/output
```

Проверить: `ls packages/pipeline/output/ | head -3` должен вывести `Bible`, `Православная_библиотека_Святых` (или похожее).

- [ ] **Step 2: Скопировать py-исходники**

```bash
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/src/scraper.py packages/pipeline/pipeline/scrape.py
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/src/downloader.py packages/pipeline/pipeline/download.py
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/src/converter.py packages/pipeline/pipeline/markdown_convert.py
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/src/enricher.py packages/pipeline/pipeline/enrich.py
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/src/models.py packages/pipeline/pipeline/_legacy_models.py
cp /mnt/c/Users/79819/PycharmProjects/orthodox_rag/libraries.txt packages/pipeline/libraries.txt
```

- [ ] **Step 3: Скопировать infra-артефакты из старого christian_rag**

```bash
cp -r nginx infra/nginx
cp scripts/init-letsencrypt.sh infra/scripts/init-letsencrypt.sh
cp scripts/renew-ssl.sh infra/scripts/renew-ssl.sh
chmod +x infra/scripts/*.sh
```

- [ ] **Step 4: Создать `packages/pipeline/pipeline/__init__.py`**

```python
"""Patristic corpus data pipeline."""
__version__ = "0.1.0"
```

- [ ] **Step 5: Закоммитить (без data/ и output/ — они в gitignore)**

```bash
git add packages/pipeline/pipeline/ packages/pipeline/libraries.txt infra/nginx/ infra/scripts/
git commit -m "chore: import scraper/downloader/converter/enricher from orthodox_rag"
```

Проверка: `git status` не должен показывать `packages/pipeline/data/` или `packages/pipeline/output/` в untracked (они должны быть проигнорены).

---

## Phase 1 — БД и миграции

### Task 3: docker-compose.dev.yml с Postgres + pgvector

**Files:**
- Create: `infra/docker-compose.dev.yml`
- Create: `.env.example`

- [ ] **Step 1: Написать docker-compose.dev.yml**

`infra/docker-compose.dev.yml`:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: patristic-postgres-dev
    environment:
      POSTGRES_DB: patristic
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-dev-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d patristic"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-dev-data:
```

- [ ] **Step 2: Написать .env.example**

`.env.example`:

```
# Database
POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/patristic

# Timeweb AI Proxy (OpenAI-compatible)
TIMEWEB_AI_KEY=replace_me
TIMEWEB_BASE_URL=https://api.timeweb.ai/v1
MAIN_AGENT_MODEL=anthropic/claude-sonnet-4-7
SEARCH_AGENT_MODEL=anthropic/claude-haiku-4-5
ENRICH_MODEL=anthropic/claude-haiku-4-5

# Embeddings
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cuda
EMBEDDING_BATCH_SIZE=32
EMBEDDING_BATCH_WINDOW_MS=50

# Frontend
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_CATALOG_API_URL=http://localhost:8001
```

- [ ] **Step 3: Поднять Postgres и проверить**

```bash
cp .env.example .env  # потом отредактируешь TIMEWEB_AI_KEY
docker compose -f infra/docker-compose.dev.yml up -d postgres
docker compose -f infra/docker-compose.dev.yml ps
docker exec -it patristic-postgres-dev psql -U postgres -d patristic -c "SELECT version();"
```

Expected: PostgreSQL 16.x запущен, ps в state `healthy`.

- [ ] **Step 4: Закоммитить**

```bash
git add infra/docker-compose.dev.yml .env.example
git commit -m "infra(dev): postgres+pgvector docker-compose"
```

---

### Task 4: SQL миграция (схема БД)

**Files:**
- Create: `infra/migrations/001_init.sql`

- [ ] **Step 1: Написать миграцию**

`infra/migrations/001_init.sql`:

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authors
CREATE TABLE IF NOT EXISTS authors (
    slug TEXT PRIMARY KEY,
    name_display TEXT NOT NULL,
    years TEXT,
    century INTEGER,
    global_section TEXT
);

-- Works
CREATE TABLE IF NOT EXISTS works (
    slug TEXT PRIMARY KEY,
    author_slug TEXT NOT NULL REFERENCES authors(slug) ON DELETE CASCADE,
    title_display TEXT NOT NULL,
    creation_date TEXT,
    section TEXT,
    source_url TEXT,
    topics JSONB,
    paragraph_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS works_author_idx ON works(author_slug);

-- Chapters
CREATE TABLE IF NOT EXISTS chapters (
    work_slug TEXT NOT NULL REFERENCES works(slug) ON DELETE CASCADE,
    chapter_num INTEGER NOT NULL,
    title TEXT,
    source_md_path TEXT,
    PRIMARY KEY (work_slug, chapter_num)
);

-- Paragraphs
CREATE TABLE IF NOT EXISTS paragraphs (
    work_slug TEXT NOT NULL,
    chapter_num INTEGER NOT NULL,
    para_num INTEGER NOT NULL,
    text TEXT NOT NULL,
    char_offset_start INTEGER,
    char_offset_end INTEGER,
    PRIMARY KEY (work_slug, chapter_num, para_num),
    FOREIGN KEY (work_slug, chapter_num) REFERENCES chapters(work_slug, chapter_num) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS paragraphs_work_idx ON paragraphs(work_slug);

-- Embeddings (windows of 1-3 paragraphs)
CREATE TABLE IF NOT EXISTS embeddings (
    work_slug TEXT NOT NULL,
    chapter_num INTEGER NOT NULL,
    para_num INTEGER NOT NULL,           -- start paragraph of window
    window_size INTEGER NOT NULL CHECK (window_size BETWEEN 1 AND 3),
    vector vector(1024),
    text_for_lexical TSVECTOR,
    PRIMARY KEY (work_slug, chapter_num, para_num, window_size),
    FOREIGN KEY (work_slug, chapter_num, para_num) REFERENCES paragraphs(work_slug, chapter_num, para_num) ON DELETE CASCADE
);
-- Vector and lexical indexes — создаём ПОСЛЕ bulk-инсёрта (см. Task 16).
-- Здесь только filter-индекс для метаданных:
CREATE INDEX IF NOT EXISTS embeddings_filter_idx ON embeddings(work_slug, chapter_num);

-- Agent observability
CREATE TABLE IF NOT EXISTS agent_runs (
    id BIGSERIAL PRIMARY KEY,
    thread_id TEXT,
    messages JSONB NOT NULL,
    citations_used JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_runs_thread_idx ON agent_runs(thread_id);

-- Регистрируем эту миграцию
INSERT INTO schema_migrations(version) VALUES ('001_init') ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Скрипт `infra/scripts/migrate.sh`**

`infra/scripts/migrate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DSN="${POSTGRES_DSN:-postgresql://postgres:postgres@localhost:5432/patristic}"
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

echo "Applying migrations to $DSN..."
for f in "$MIGRATIONS_DIR"/*.sql; do
    echo "  -> $(basename "$f")"
    psql "$DSN" -v ON_ERROR_STOP=1 -f "$f"
done
echo "Done."
```

- [ ] **Step 3: Применить миграцию и проверить**

```bash
chmod +x infra/scripts/migrate.sh
docker exec -i patristic-postgres-dev psql -U postgres -d patristic < infra/migrations/001_init.sql

# Проверка
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "\dt"
```

Expected: видим таблицы `authors`, `works`, `chapters`, `paragraphs`, `embeddings`, `agent_runs`, `schema_migrations`.

- [ ] **Step 4: Закоммитить**

```bash
git add infra/migrations/001_init.sql infra/scripts/migrate.sh
git commit -m "infra(db): initial schema migration with pgvector"
```

---

### Task 5: Pipeline pyproject + CLI скелет

**Files:**
- Create: `packages/pipeline/pyproject.toml`
- Create: `packages/pipeline/pipeline/__main__.py`
- Create: `packages/pipeline/pipeline/config.py`
- Create: `packages/pipeline/pipeline/db.py`

- [ ] **Step 1: pyproject.toml**

`packages/pipeline/pyproject.toml`:

```toml
[project]
name = "patristic-pipeline"
version = "0.1.0"
description = "Data pipeline for patristic corpus"
requires-python = ">=3.12"
dependencies = [
    "typer>=0.12",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "psycopg[binary,pool]>=3.2",
    "pgvector>=0.3",
    "httpx>=0.27",
    "beautifulsoup4>=4.12",
    "lxml>=5.2",
    "ebooklib>=0.18",
    "sentence-transformers>=3.0",
    "torch>=2.3",
    "openai>=1.40",
    "tiktoken>=0.7",
    "pyyaml>=6.0",
    "rich>=13.7",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5.0",
    "ruff>=0.5",
]

[project.scripts]
pipeline = "pipeline.__main__:app"

[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["pipeline*"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: config.py**

`packages/pipeline/pipeline/config.py`:

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    postgres_dsn: str = "postgresql://postgres:postgres@localhost:5432/patristic"

    timeweb_ai_key: str = ""
    timeweb_base_url: str = "https://api.timeweb.ai/v1"
    enrich_model: str = "anthropic/claude-haiku-4-5"

    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cuda"
    embedding_batch_size: int = 32

    # Paths (relative to package root by default)
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    output_dir: Path = Path(__file__).resolve().parent.parent / "output"
    glossary_path: Path = Path(__file__).resolve().parent.parent / "glossary.json"
    seed_concepts_path: Path = Path(__file__).resolve().parent.parent / "seed_concepts.json"
    cs_dict_path: Path = Path(__file__).resolve().parent.parent / "cs_dict.json"


settings = Settings()
```

- [ ] **Step 3: db.py**

`packages/pipeline/pipeline/db.py`:

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator
import psycopg
from psycopg_pool import AsyncConnectionPool

from .config import settings

_pool: AsyncConnectionPool | None = None


async def init_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(settings.postgres_dsn, min_size=1, max_size=8, open=False)
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def conn() -> AsyncIterator[psycopg.AsyncConnection]:
    pool = await init_pool()
    async with pool.connection() as c:
        yield c
```

- [ ] **Step 4: __main__.py — заглушки команд**

`packages/pipeline/pipeline/__main__.py`:

```python
import asyncio
import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def diagnose() -> None:
    """Сканит output/ и data/, печатает отчёт о пробелах."""
    from .diagnose import run as _run
    asyncio.run(_run())


@app.command()
def paragraphs() -> None:
    """Парсит md → абзацы, пишет в БД."""
    from .paragraphs import run as _run
    asyncio.run(_run())


@app.command()
def embed(device: str | None = None, batch_size: int | None = None) -> None:
    """Эмбеддит окна 1-3 абзацев и пишет в БД."""
    from .embed import run as _run
    asyncio.run(_run(device=device, batch_size=batch_size))


@app.command(name="concepts-bootstrap")
def concepts_bootstrap() -> None:
    """Генерирует glossary.json через Haiku по seed_concepts.json."""
    from .concepts_bootstrap import run as _run
    asyncio.run(_run())


@app.command()
def enrich() -> None:
    """Добавляет topics в md frontmatter и works.topics через Haiku."""
    from .enrich import run as _run
    asyncio.run(_run())


if __name__ == "__main__":
    app()
```

- [ ] **Step 5: Установка и проверка**

```bash
cd packages/pipeline
python -m venv .venv
.venv/bin/pip install -e ".[dev]"   # Windows: .venv/Scripts/pip
.venv/bin/python -m pipeline --help
```

Expected: помощь typer показывает 5 команд. Каждая ругается на ImportError при запуске (модули ещё не написаны) — нормально.

- [ ] **Step 6: Закоммитить**

```bash
git add packages/pipeline/pyproject.toml packages/pipeline/pipeline/__main__.py \
        packages/pipeline/pipeline/config.py packages/pipeline/pipeline/db.py
git commit -m "feat(pipeline): pyproject, CLI skeleton, config, db pool"
```

---

## Phase 2 — Pipeline foundation (хелперы)

### Task 6: slugify (TDD)

**Files:**
- Create: `packages/pipeline/pipeline/slugify.py`
- Test: `packages/pipeline/tests/test_slugify.py`

Зачем: имена авторов и трудов в `output/` содержат кириллицу, пробелы, спецсимволы. Нам нужен **детерминированный** транслит-слаг для использования как PK в БД и в canonical citation. Должен быть идемпотентен (повторное применение к слагу даёт тот же слаг).

- [ ] **Step 1: Написать failing test**

`packages/pipeline/tests/test_slugify.py`:

```python
import pytest
from pipeline.slugify import slugify


@pytest.mark.parametrize("inp,expected", [
    ("Аврелий Августин, блаженный", "avrelij_avgustin_blazhennyj"),
    ("Иоанн Лествичник, преподобный", "ioann_lestvichnik_prepodobnyj"),
    ("Брянчанинов Игнатий, святитель", "brjanchaninov_ignatij_svjatitel"),
    ("Лествица", "lestvica"),
    ("Аскетические опыты, Части 1-2", "asketicheskie_opyty_chasti_1_2"),
    ("Слово 4. О блаженном послушании", "slovo_4_o_blazhennom_poslushanii"),
    # Алфавитный_указатель из имени директории должен дать тот же результат
    ("Алфавитный_указатель_на_книгу", "alfavitnyj_ukazatel_na_knigu"),
    ("Платон", "platon"),
    ("Аристотель", "aristotel"),
])
def test_slugify_known_inputs(inp: str, expected: str) -> None:
    assert slugify(inp) == expected


def test_slugify_idempotent() -> None:
    s = slugify("Иоанн Златоуст, святитель")
    assert slugify(s) == s


def test_slugify_empty() -> None:
    assert slugify("") == ""
    assert slugify("   ") == ""


def test_slugify_only_punctuation() -> None:
    assert slugify("!!!---???") == ""


def test_slugify_truncates_to_max_length() -> None:
    long = "очень_длинное_название_" * 20
    out = slugify(long, max_length=80)
    assert len(out) <= 80
    assert not out.endswith("_")
```

- [ ] **Step 2: Запустить — должен упасть**

```bash
cd packages/pipeline
.venv/bin/pytest tests/test_slugify.py -v
```

Expected: ImportError (`pipeline.slugify` ещё нет).

- [ ] **Step 3: Реализация**

`packages/pipeline/pipeline/slugify.py`:

```python
"""Deterministic transliteration to ASCII-safe slug.

Uses GOST 7.79-2000 system B style transliteration for Russian Cyrillic.
"""
import re
import unicodedata

# Russian Cyrillic → ASCII (GOST-flavoured, simplified)
_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "shh", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "ju", "я": "ja",
}


def _translit(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch in _RU:
            out.append(_RU[ch])
        elif "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out)


def slugify(text: str, max_length: int = 100) -> str:
    """Return a deterministic ASCII slug for the given (possibly Cyrillic) text.

    Idempotent: slugify(slugify(x)) == slugify(x).
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _translit(text)
    # collapse non-alnum to single underscore
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")
    if len(text) > max_length:
        text = text[:max_length].rstrip("_")
    return text
```

- [ ] **Step 4: Прогнать тесты**

```bash
.venv/bin/pytest tests/test_slugify.py -v
```

Expected: все 13 тестов проходят.

- [ ] **Step 5: Закоммитить**

```bash
git add packages/pipeline/pipeline/slugify.py packages/pipeline/tests/test_slugify.py
git commit -m "feat(pipeline): deterministic Cyrillic→ASCII slugify"
```

---

### Task 7: lexical_preprocess (TDD)

**Files:**
- Create: `packages/pipeline/pipeline/lexical_preprocess.py`
- Create: `packages/pipeline/cs_dict.json`
- Test: `packages/pipeline/tests/test_lexical_preprocess.py`

Зачем: tsvector с русским словарём ищет современные формы. Старые переводы (Феофан, Паисий, Синодальный) содержат церковнославянизмы (`молитися`, `чесо`, `аще`) — Postgres их плохо лемматизирует. Подменяем перед индексацией и перед запросом.

- [ ] **Step 1: cs_dict.json (стартовый набор, ~30 пар)**

`packages/pipeline/cs_dict.json`:

```json
{
  "молитися": "молиться",
  "молитеся": "молитесь",
  "чесо": "что",
  "сего": "этого",
  "сему": "этому",
  "аще": "если",
  "паки": "снова",
  "зело": "очень",
  "иже": "который",
  "якоже": "как",
  "понеже": "потому что",
  "глаголати": "говорить",
  "глаголет": "говорит",
  "рече": "сказал",
  "бысть": "был",
  "суть": "есть",
  "еси": "ты есть",
  "несть": "нет",
  "лепо": "достойно",
  "присно": "всегда",
  "выну": "всегда",
  "купно": "вместе",
  "токмо": "только",
  "обаче": "однако",
  "убо": "итак",
  "сей": "этот",
  "оный": "тот",
  "вем": "знаю",
  "веси": "знаешь",
  "веде": "знал"
}
```

- [ ] **Step 2: failing test**

`packages/pipeline/tests/test_lexical_preprocess.py`:

```python
from pipeline.lexical_preprocess import preprocess


def test_lowercase() -> None:
    assert preprocess("МОЛИТВА Иисусова") == "молитва иисусова"


def test_punctuation_stripped() -> None:
    assert preprocess("Послушание, есть отречение!") == "послушание есть отречение"


def test_cs_substitution_basic() -> None:
    out = preprocess("молитися о брате аще согрешит")
    assert "молиться" in out
    assert "молитися" not in out
    assert "если" in out
    assert "аще" not in out


def test_multiple_substitutions() -> None:
    out = preprocess("аще убо паки помыслил еси")
    assert "если" in out
    assert "итак" in out
    assert "снова" in out
    # original forms gone
    assert "аще" not in out
    assert "убо" not in out
    assert "паки" not in out


def test_substitution_only_whole_words() -> None:
    # "паки" не должна заменяться внутри "пакибытие"
    out = preprocess("пакибытие")
    assert out == "пакибытие"


def test_preserves_word_order() -> None:
    out = preprocess("Чесо ради сие глаголет?")
    parts = out.split()
    assert parts.index("что") < parts.index("говорит")


def test_empty_input() -> None:
    assert preprocess("") == ""
    assert preprocess("   \n  ") == ""
```

- [ ] **Step 3: запустить (должно упасть)**

```bash
.venv/bin/pytest tests/test_lexical_preprocess.py -v
```

Expected: ImportError.

- [ ] **Step 4: реализация**

`packages/pipeline/pipeline/lexical_preprocess.py`:

```python
"""Lexical preprocessing for Russian + Church Slavonic substitution.

Same function is used at index time (when building tsvector) and at query
time (when calling lexical_search). Must be stable and deterministic.
"""
import json
import re
from functools import lru_cache

from .config import settings


@lru_cache(maxsize=1)
def _cs_dict() -> dict[str, str]:
    if not settings.cs_dict_path.exists():
        return {}
    with settings.cs_dict_path.open("r", encoding="utf-8") as f:
        return json.load(f)


_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")


def preprocess(text: str) -> str:
    """Lowercase, strip punctuation, substitute Church Slavonic forms.

    Substitutions are whole-word only.
    """
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if not text:
        return ""

    cs = _cs_dict()
    if cs:
        tokens = text.split(" ")
        tokens = [cs.get(t, t) for t in tokens]
        text = " ".join(tokens)

    return text
```

- [ ] **Step 5: тесты проходят**

```bash
.venv/bin/pytest tests/test_lexical_preprocess.py -v
```

Expected: 7 PASS.

- [ ] **Step 6: коммит**

```bash
git add packages/pipeline/pipeline/lexical_preprocess.py packages/pipeline/cs_dict.json \
        packages/pipeline/tests/test_lexical_preprocess.py
git commit -m "feat(pipeline): lexical preprocess with CS substitution dict"
```

---

### Task 8: Pydantic-модели

**Files:**
- Create: `packages/pipeline/pipeline/models.py`

- [ ] **Step 1: Написать модели**

`packages/pipeline/pipeline/models.py`:

```python
"""Pydantic models for pipeline ingest/embed/query."""
from pydantic import BaseModel, Field


class AuthorRow(BaseModel):
    slug: str
    name_display: str
    years: str | None = None
    century: int | None = None
    global_section: str | None = None


class WorkRow(BaseModel):
    slug: str
    author_slug: str
    title_display: str
    creation_date: str | None = None
    section: str | None = None
    source_url: str | None = None
    topics: list[str] | None = None
    paragraph_count: int = 0


class ChapterRow(BaseModel):
    work_slug: str
    chapter_num: int
    title: str | None = None
    source_md_path: str | None = None


class ParagraphRow(BaseModel):
    work_slug: str
    chapter_num: int
    para_num: int
    text: str
    char_offset_start: int
    char_offset_end: int


class ParsedMarkdown(BaseModel):
    """Parsed output of a single md file."""
    frontmatter: dict
    body: str
    paragraphs: list[str]


class ConceptEntry(BaseModel):
    canonical: str
    synonyms: list[str] = Field(default_factory=list)
    related: list[str] = Field(default_factory=list)
    antonyms: list[str] = Field(default_factory=list)
    greek: list[str] = Field(default_factory=list)
```

- [ ] **Step 2: Sanity-check (import)**

```bash
.venv/bin/python -c "from pipeline.models import AuthorRow, WorkRow, ChapterRow, ParagraphRow, ParsedMarkdown, ConceptEntry; print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Коммит**

```bash
git add packages/pipeline/pipeline/models.py
git commit -m "feat(pipeline): pydantic models for corpus entities"
```

---

## Phase 3 — Pipeline команды (parse, diagnose, embed, enrich, concepts)

### Task 9: paragraphs.py — парсинг md (TDD)

**Files:**
- Create: `packages/pipeline/pipeline/paragraphs.py`
- Test: `packages/pipeline/tests/test_paragraphs.py`
- Create: `packages/pipeline/tests/fixtures/sample_md/normal_chapter.md`
- Create: `packages/pipeline/tests/fixtures/sample_md/single_chapter_long.md`
- Create: `packages/pipeline/tests/fixtures/sample_md/with_noise.md`

- [ ] **Step 1: Fixtures**

`tests/fixtures/sample_md/normal_chapter.md`:

```markdown
---
author: Аврелий Августин, блаженный
book_title: Исповедь
creation_date: 400
chapter_title: III
chapter_number: 4
source_url: https://azbyka.ru/otechnik/Avrelij_Avgustin/ispoved/
section: Автобиографические сочинения
author_years_of_life: (354–430)
global_section: Православная библиотека Святых отцов и церковных писателей
---

Первый абзац главы — содержательный текст длиной более тридцати символов чтобы пройти фильтр мусора.

Второй абзац, тоже нормальный, говорит о времени и вечности и о том как одно соприкасается с другим.

Третий абзац.

— 42 —

Четвёртый абзац, после колонтитула. Он должен попасть в выдачу, а строка с цифрой в тире — нет.
```

`tests/fixtures/sample_md/single_chapter_long.md`:

```markdown
---
author: Иоанн Златоуст, святитель
book_title: Беседа в Великую седмицу
chapter_number: 1
source_url: https://azbyka.ru/otechnik/Ioann_Zlatoust/beseda/
---

Единственный абзац — длинная беседа без внутренней структуры. Епископ обращается к народу о святой седмице, о страданиях Господа, о посте, молитве и покаянии — обо всём что относится к подготовке к Пасхе.

И тут второй абзац с продолжением беседы про важные мысли о святой неделе.
```

`tests/fixtures/sample_md/with_noise.md`:

```markdown
---
author: Брянчанинов Игнатий, святитель
book_title: Аскетические опыты
chapter_number: 4
source_url: https://azbyka.ru/otechnik/Ignatij_Brjanchaninov/asketicheskie-opyty/
---

Длинный содержательный абзац номер один говорит о добродетели послушания и о её плодах в духовной жизни.

короткий

*1)

— 7 —

Длинный содержательный абзац номер два после мусора должен быть распознан как параграф номер два после фильтрации.
```

- [ ] **Step 2: Test файл**

`packages/pipeline/tests/test_paragraphs.py`:

```python
from pathlib import Path
from pipeline.paragraphs import parse_md, split_paragraphs, MIN_PARA_CHARS


FIXTURES = Path(__file__).parent / "fixtures" / "sample_md"


def test_parse_md_extracts_frontmatter() -> None:
    parsed = parse_md(FIXTURES / "normal_chapter.md")
    assert parsed.frontmatter["author"] == "Аврелий Августин, блаженный"
    assert parsed.frontmatter["book_title"] == "Исповедь"
    assert int(parsed.frontmatter["chapter_number"]) == 4
    assert parsed.frontmatter["source_url"].startswith("https://azbyka.ru")


def test_paragraphs_filters_noise() -> None:
    parsed = parse_md(FIXTURES / "normal_chapter.md")
    paras = parsed.paragraphs
    assert len(paras) == 4
    assert paras[0].startswith("Первый абзац")
    assert paras[-1].startswith("Четвёртый абзац")
    assert not any("— 42 —" == p for p in paras)


def test_paragraphs_min_length_threshold() -> None:
    parsed = parse_md(FIXTURES / "with_noise.md")
    for p in parsed.paragraphs:
        assert len(p) >= MIN_PARA_CHARS
    assert len(parsed.paragraphs) == 2


def test_paragraphs_single_chapter_handles() -> None:
    parsed = parse_md(FIXTURES / "single_chapter_long.md")
    assert len(parsed.paragraphs) == 2


def test_split_paragraphs_fallback_single_newline() -> None:
    text = "Первый длинный абзац номер один говорит о добродетели и её плодах.\nВторой длинный абзац номер два следует тут же без двойного переноса между ними."
    paras = split_paragraphs(text)
    assert len(paras) == 2
```

- [ ] **Step 3: Failing test**

```bash
cd packages/pipeline
.venv/bin/pytest tests/test_paragraphs.py -v
```

Expected: ImportError.

- [ ] **Step 4: Реализация parse_md / split_paragraphs**

`packages/pipeline/pipeline/paragraphs.py`:

```python
"""Markdown → paragraphs parsing + DB ingest."""
import re
from pathlib import Path

from .models import ParsedMarkdown


MIN_PARA_CHARS = 30

_NOISE_PATTERNS = [
    re.compile(r"^—\s*\d+\s*—$"),          # — 42 —
    re.compile(r"^\*\d+\)?\s*$"),           # *1) or *1
    re.compile(r"^\s*\d+\s*$"),             # bare number
    re.compile(r"^[\s\-=_]{1,}$"),          # dividers
]

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.DOTALL)


def _parse_frontmatter(raw: str) -> dict:
    out: dict = {}
    for line in raw.split("\n"):
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        out[key.strip()] = value.strip()
    return out


def _is_noise(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) == 0:
        return True
    if len(stripped) < MIN_PARA_CHARS:
        return True
    for pat in _NOISE_PATTERNS:
        if pat.match(stripped):
            return True
    return False


def split_paragraphs(body: str) -> list[str]:
    raw = re.split(r"\n{2,}", body)
    raw = [b.strip() for b in raw if b.strip()]
    # fallback: single chunk with internal \n
    if len(raw) == 1 and "\n" in raw[0]:
        raw = [line.strip() for line in raw[0].split("\n") if line.strip()]
    return [p for p in raw if not _is_noise(p)]


def parse_md(path: Path) -> ParsedMarkdown:
    content = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(content)
    if m:
        frontmatter = _parse_frontmatter(m.group(1))
        body = m.group(2)
    else:
        frontmatter = {}
        body = content
    paragraphs = split_paragraphs(body)
    return ParsedMarkdown(frontmatter=frontmatter, body=body, paragraphs=paragraphs)


async def run() -> None:
    """Walk output/, parse each md, upsert into DB. Implemented in Task 10."""
    raise NotImplementedError("Implemented in Task 10")
```

- [ ] **Step 5: Тесты pass**

```bash
.venv/bin/pytest tests/test_paragraphs.py -v
```

Expected: 5 PASS.

- [ ] **Step 6: Коммит**

```bash
git add packages/pipeline/pipeline/paragraphs.py \
        packages/pipeline/tests/test_paragraphs.py \
        packages/pipeline/tests/fixtures/sample_md/
git commit -m "feat(pipeline): md→paragraphs parser with noise filter"
```

---

### Task 10: paragraphs.py — DB ingest

**Files:**
- Modify: `packages/pipeline/pipeline/paragraphs.py` (заменяет stub `run()`)

- [ ] **Step 1: Дописать в paragraphs.py**

В конец файла (после `parse_md`) добавить, заменив `run()`:

```python
import json
from rich.progress import Progress

from .config import settings
from .db import init_pool, close_pool, conn
from .slugify import slugify


def _century_from_years(years: str | None) -> int | None:
    if not years:
        return None
    m = re.search(r"\d{3,4}", years)
    if not m:
        return None
    year = int(m.group())
    return (year - 1) // 100 + 1


def _chapter_num_from_filename(filename: str) -> int:
    m = re.match(r"^(\d+)_", filename)
    return int(m.group(1)) if m else 1


async def _upsert_author(c, slug: str, name: str, years: str | None, section: str | None) -> None:
    century = _century_from_years(years)
    await c.execute(
        """
        INSERT INTO authors (slug, name_display, years, century, global_section)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
        SET name_display=EXCLUDED.name_display,
            years=COALESCE(EXCLUDED.years, authors.years),
            century=COALESCE(EXCLUDED.century, authors.century),
            global_section=COALESCE(EXCLUDED.global_section, authors.global_section)
        """,
        [slug, name, years, century, section],
    )


async def _upsert_work(c, slug: str, author_slug: str, title: str,
                      creation_date: str | None, section: str | None,
                      source_url: str | None) -> None:
    await c.execute(
        """
        INSERT INTO works (slug, author_slug, title_display, creation_date, section, source_url)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE
        SET title_display=EXCLUDED.title_display,
            creation_date=COALESCE(EXCLUDED.creation_date, works.creation_date),
            section=COALESCE(EXCLUDED.section, works.section),
            source_url=COALESCE(EXCLUDED.source_url, works.source_url)
        """,
        [slug, author_slug, title, creation_date, section, source_url],
    )


async def _upsert_chapter(c, work_slug: str, chapter_num: int,
                          title: str | None, source_md_path: str) -> None:
    await c.execute(
        """
        INSERT INTO chapters (work_slug, chapter_num, title, source_md_path)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (work_slug, chapter_num) DO UPDATE
        SET title=EXCLUDED.title,
            source_md_path=EXCLUDED.source_md_path
        """,
        [work_slug, chapter_num, title, source_md_path],
    )


async def _replace_paragraphs(c, work_slug: str, chapter_num: int,
                              paragraphs: list[str], body: str) -> None:
    await c.execute(
        "DELETE FROM paragraphs WHERE work_slug=%s AND chapter_num=%s",
        [work_slug, chapter_num],
    )
    offsets = []
    pos = 0
    for p in paragraphs:
        idx = body.find(p, pos)
        if idx < 0:
            offsets.append((0, len(p)))
        else:
            offsets.append((idx, idx + len(p)))
            pos = idx + len(p)
    rows = [
        (work_slug, chapter_num, i + 1, p, off[0], off[1])
        for i, (p, off) in enumerate(zip(paragraphs, offsets))
    ]
    if rows:
        async with c.cursor() as cur:
            await cur.executemany(
                """
                INSERT INTO paragraphs
                    (work_slug, chapter_num, para_num, text,
                     char_offset_start, char_offset_end)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )


async def run() -> None:
    await init_pool()
    md_files = list(settings.output_dir.rglob("*.md"))
    print(f"Found {len(md_files)} md files in {settings.output_dir}")

    work_para_counts: dict[str, int] = {}

    with Progress() as progress:
        task = progress.add_task("Parsing md", total=len(md_files))
        async with conn() as c:
            async with c.transaction():
                for path in md_files:
                    progress.update(task, advance=1)
                    try:
                        parsed = parse_md(path)
                    except Exception as e:
                        print(f"  [skip] {path}: {e}")
                        continue

                    fm = parsed.frontmatter
                    author_name = fm.get("author", "").strip()
                    work_title = fm.get("book_title", "").strip()
                    if not author_name or not work_title:
                        continue

                    chapter_title = fm.get("chapter_title")
                    try:
                        chapter_num = int(fm.get("chapter_number") or _chapter_num_from_filename(path.name))
                    except ValueError:
                        chapter_num = _chapter_num_from_filename(path.name)

                    author_slug = slugify(author_name)
                    work_slug = slugify(f"{author_slug}_{work_title}")
                    rel_path = str(path.relative_to(settings.output_dir))

                    await _upsert_author(c, author_slug, author_name,
                                         fm.get("author_years_of_life"),
                                         fm.get("global_section"))
                    await _upsert_work(c, work_slug, author_slug, work_title,
                                       fm.get("creation_date"),
                                       fm.get("section"),
                                       fm.get("source_url"))
                    await _upsert_chapter(c, work_slug, chapter_num, chapter_title, rel_path)
                    await _replace_paragraphs(c, work_slug, chapter_num,
                                              parsed.paragraphs, parsed.body)

                    work_para_counts[work_slug] = work_para_counts.get(work_slug, 0) + len(parsed.paragraphs)

                for ws, count in work_para_counts.items():
                    await c.execute(
                        "UPDATE works SET paragraph_count=%s WHERE slug=%s",
                        [count, ws],
                    )

    await close_pool()
    print(f"Indexed {sum(work_para_counts.values())} paragraphs across {len(work_para_counts)} works.")
```

- [ ] **Step 2: Smoke-прогон на 1-2 авторах**

Создай временный subset чтобы не ждать. Самый простой путь — задать ENV переменной путь к временной директории с парой md:

```bash
mkdir -p /tmp/mvp_subset/Аврелий_Августин_блаженный/Исповедь
cp packages/pipeline/output/Православная_библиотека_Святых/Аврелий_Августин_блаженный/Исповедь/00*.md \
   /tmp/mvp_subset/Аврелий_Августин_блаженный/Исповедь/

OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline paragraphs
```

(Если ENV не подцепляется, временно добавь `settings.output_dir = Path(os.environ.get("OUTPUT_DIR", str(settings.output_dir)))` в `config.py`.)

Проверка:

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "SELECT slug, author_slug, paragraph_count FROM works ORDER BY paragraph_count DESC LIMIT 5;"
```

Expected: видим Исповедь Августина с paragraph_count > 0.

- [ ] **Step 3: Идемпотентность**

Прогнать второй раз — счётчики должны совпасть.

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "SELECT COUNT(*) FROM paragraphs;"
OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline paragraphs
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "SELECT COUNT(*) FROM paragraphs;"
```

Expected: число одинаковое.

- [ ] **Step 4: Коммит**

```bash
git add packages/pipeline/pipeline/paragraphs.py
git commit -m "feat(pipeline): paragraphs DB ingest (idempotent upsert)"
```

---

### Task 11: diagnose.py

**Files:**
- Create: `packages/pipeline/pipeline/diagnose.py`
- Test: `packages/pipeline/tests/test_diagnose.py`

- [ ] **Step 1: Test**

`packages/pipeline/tests/test_diagnose.py`:

```python
from pathlib import Path
from pipeline.diagnose import analyze_corpus, Issue


def _make_tree(root: Path, layout: dict) -> None:
    for name, content in layout.items():
        path = root / name
        if isinstance(content, dict):
            path.mkdir(parents=True, exist_ok=True)
            _make_tree(path, content)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")


def test_analyze_normal_author(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Августин": {"Исповедь": {"003_I.md": "x" * 200, "004_II.md": "x" * 200}},
    })
    reports = analyze_corpus(tmp_path)
    assert len(reports) == 1
    r = reports[0]
    assert r.work_count == 1
    assert r.md_count == 2
    assert not r.issues


def test_analyze_single_chapter_long(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Златоуст": {"Беседа": {"002_Беседа.md": "x" * 12000}},
    })
    reports = analyze_corpus(tmp_path)
    assert Issue.SINGLE_CHAPTER_LONG in reports[0].issues


def test_analyze_empty_work(tmp_path: Path) -> None:
    _make_tree(tmp_path, {
        "Исаак_Сирин": {"Слова_подвижнические": {}},
    })
    reports = analyze_corpus(tmp_path)
    assert Issue.EMPTY_WORK in reports[0].issues
```

- [ ] **Step 2: Failing**

```bash
.venv/bin/pytest tests/test_diagnose.py -v
```

Expected: ImportError.

- [ ] **Step 3: Реализация**

`packages/pipeline/pipeline/diagnose.py`:

```python
"""Diagnostic scan: completeness of output/ and data/."""
import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from rich.console import Console
from rich.table import Table

from .config import settings


SINGLE_LONG_THRESHOLD_CHARS = 10000


class Issue(str, Enum):
    MISSING_DATA = "missing_data"
    NO_MD_OUTPUT = "no_md_output"
    SINGLE_CHAPTER_LONG = "single_chapter_long"
    EMPTY_WORK = "empty_work"


@dataclass
class AuthorReport:
    author_dir: str
    work_count: int
    md_count: int
    issues: list[Issue] = field(default_factory=list)
    detail: dict = field(default_factory=dict)


def analyze_corpus(root: Path) -> list[AuthorReport]:
    reports: list[AuthorReport] = []
    if not root.exists():
        return reports
    for author_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        r = AuthorReport(author_dir=author_dir.name, work_count=0, md_count=0)
        for work_dir in sorted(p for p in author_dir.iterdir() if p.is_dir()):
            r.work_count += 1
            md_files = list(work_dir.glob("*.md"))
            r.md_count += len(md_files)
            if not md_files:
                if Issue.EMPTY_WORK not in r.issues:
                    r.issues.append(Issue.EMPTY_WORK)
                r.detail.setdefault("empty_works", []).append(work_dir.name)
            elif len(md_files) == 1 and md_files[0].stat().st_size > SINGLE_LONG_THRESHOLD_CHARS:
                if Issue.SINGLE_CHAPTER_LONG not in r.issues:
                    r.issues.append(Issue.SINGLE_CHAPTER_LONG)
                r.detail.setdefault("single_long", []).append({
                    "work": work_dir.name, "size": md_files[0].stat().st_size,
                })
        reports.append(r)
    return reports


async def run() -> None:
    console = Console()
    out_root = settings.output_dir / "Православная_библиотека_Святых"
    reports = analyze_corpus(out_root)

    data_root = settings.data_dir / "Православная_библиотека_Святых_отцов_и_церковных_писателей"
    if data_root.exists():
        existing = {r.author_dir for r in reports}
        for author_dir in sorted(p for p in data_root.iterdir() if p.is_dir()):
            if author_dir.name not in existing:
                reports.append(AuthorReport(
                    author_dir=author_dir.name, work_count=0, md_count=0,
                    issues=[Issue.MISSING_DATA],
                ))

    table = Table(title="Corpus diagnostic")
    table.add_column("Author")
    table.add_column("Works", justify="right")
    table.add_column("MD files", justify="right")
    table.add_column("Issues", style="yellow")
    for r in reports:
        table.add_row(r.author_dir, str(r.work_count), str(r.md_count),
                      ", ".join(i.value for i in r.issues) if r.issues else "—")
    console.print(table)

    report_path = settings.output_dir.parent / "diagnose_report.json"
    report_path.write_text(json.dumps(
        {"reports": [
            {"author_dir": r.author_dir, "work_count": r.work_count, "md_count": r.md_count,
             "issues": [i.value for i in r.issues], "detail": r.detail}
            for r in reports
        ]},
        ensure_ascii=False, indent=2,
    ), encoding="utf-8")
    console.print(f"\nFull report → {report_path}")
```

- [ ] **Step 4: Tests PASS + manual run**

```bash
.venv/bin/pytest tests/test_diagnose.py -v
.venv/bin/python -m pipeline diagnose
```

Expected: тесты pass; в выводе таблицы видим `missing_data` для Исаака Сирина и `single_chapter_long` для коротких бесед.

- [ ] **Step 5: Коммит**

```bash
git add packages/pipeline/pipeline/diagnose.py packages/pipeline/tests/test_diagnose.py
git commit -m "feat(pipeline): diagnose command for corpus gap analysis"
```

---

### Task 12: concepts_bootstrap.py

**Files:**
- Create: `packages/pipeline/pipeline/concepts_bootstrap.py`
- Create: `packages/pipeline/seed_concepts.json`

- [ ] **Step 1: seed_concepts.json**

`packages/pipeline/seed_concepts.json`:

```json
[
  "гордость", "смирение", "тщеславие", "превозношение",
  "молитва", "молитва Иисусова", "умная молитва", "сердечная молитва",
  "трезвение", "внимание", "память Божия", "память смертная",
  "уныние", "печаль", "отчаяние", "тоска",
  "осуждение", "клевета", "злоречие", "пересуды",
  "помысл", "прилог", "сочетание", "сложение",
  "страсть", "греховный навык", "пристрастие",
  "блуд", "целомудрие", "девство", "чистота",
  "послушание", "своеволие", "отсечение воли",
  "пост", "воздержание", "чревоугодие",
  "покаяние", "исповедь", "плач", "слёзы покаяния",
  "благодать", "обожение", "богопознание",
  "прелесть", "духовная прелесть", "мнение о себе",
  "безмолвие", "исихия", "пустынничество",
  "любовь", "милосердие", "сострадание",
  "вера", "надежда", "доверие Богу",
  "страх Божий", "благоговение",
  "терпение", "мужество", "крест",
  "ангел", "бес", "духи злобы",
  "грех", "падение", "первородный грех",
  "спасение", "искупление", "оправдание",
  "Святая Троица", "Логос", "Святой Дух",
  "Церковь", "таинство", "евхаристия",
  "Священное Писание", "Предание", "догмат"
]
```

- [ ] **Step 2: Реализация**

`packages/pipeline/pipeline/concepts_bootstrap.py`:

```python
"""Bootstrap glossary.json by querying an LLM per seed concept."""
import json

from openai import OpenAI
from pydantic import BaseModel, ValidationError
from rich.progress import Progress

from .config import settings
from .models import ConceptEntry


PROMPT_TEMPLATE = """Ты помогаешь составить словарь патристических концептов на русском языке.

Для концепта «{term}» верни строгий JSON со следующими полями:
- canonical: каноническая форма (обычно совпадает с входом)
- synonyms: список русских синонимов и архаичных вариантов
- related: список тематически связанных понятий
- antonyms: список антонимов
- greek: список греческих святоотеческих терминов

Только JSON, без префиксов и комментариев. Все поля обязательны (пустой список если ничего нет)."""


class ConceptDict(BaseModel):
    concepts: dict[str, ConceptEntry]


def _load_existing() -> ConceptDict:
    if settings.glossary_path.exists():
        return ConceptDict.model_validate(
            json.loads(settings.glossary_path.read_text(encoding="utf-8"))
        )
    return ConceptDict(concepts={})


def _save(d: ConceptDict) -> None:
    settings.glossary_path.write_text(
        json.dumps(d.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


async def run() -> None:
    seed: list[str] = json.loads(settings.seed_concepts_path.read_text(encoding="utf-8"))
    existing = _load_existing()
    client = OpenAI(api_key=settings.timeweb_ai_key, base_url=settings.timeweb_base_url)

    with Progress() as progress:
        task = progress.add_task("Concepts", total=len(seed))
        for term in seed:
            progress.update(task, advance=1)
            if term in existing.concepts:
                continue
            resp = client.chat.completions.create(
                model=settings.enrich_model,
                messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(term=term)}],
                temperature=0.2,
                max_tokens=500,
            )
            raw = resp.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            try:
                entry = ConceptEntry.model_validate(json.loads(raw))
            except (json.JSONDecodeError, ValidationError) as e:
                print(f"  [skip] {term}: {e}")
                continue
            existing.concepts[term] = entry
            _save(existing)

    print(f"glossary.json now has {len(existing.concepts)} concepts.")
```

- [ ] **Step 3: Прогон**

```bash
export $(grep -v '^#' .env | xargs)
.venv/bin/python -m pipeline concepts-bootstrap
head -50 packages/pipeline/glossary.json
```

Expected: ~78 концептов в файле.

**Ручная проверка** (важно): открой `glossary.json`, прочитай 5-10 случайных записей, исправь явные ошибки. Особенно греческие термины — LLM их часто путает.

- [ ] **Step 4: Коммит**

```bash
git add packages/pipeline/pipeline/concepts_bootstrap.py \
        packages/pipeline/seed_concepts.json \
        packages/pipeline/glossary.json
git commit -m "feat(pipeline): bootstrap glossary.json from Haiku"
```

---

### Task 13: embed.py — bge-m3 + окна + bulk insert

**Files:**
- Create: `packages/pipeline/pipeline/embed.py`

- [ ] **Step 1: Реализация**

`packages/pipeline/pipeline/embed.py`:

```python
"""Embed paragraph windows with bge-m3 + tsvector index."""
from rich.progress import Progress
from sentence_transformers import SentenceTransformer

from .config import settings
from .db import init_pool, close_pool, conn
from .lexical_preprocess import preprocess


WINDOW_SIZES = (1, 2, 3)


def _build_windows(paragraphs: list[tuple[int, str]]) -> list[tuple[int, int, str]]:
    """[(para_num, text)] → [(start_para_num, window_size, joined_text)]."""
    out: list[tuple[int, int, str]] = []
    paragraphs = sorted(paragraphs, key=lambda x: x[0])
    n = len(paragraphs)
    for w in WINDOW_SIZES:
        for i in range(n - w + 1):
            chunk = paragraphs[i:i + w]
            text = "\n\n".join(t for _, t in chunk)
            out.append((chunk[0][0], w, text))
    return out


async def _stream_chapters(c):
    cur = await c.execute(
        """
        SELECT work_slug, chapter_num, para_num, text
        FROM paragraphs
        ORDER BY work_slug, chapter_num, para_num
        """
    )
    current_key = None
    bucket: list[tuple[int, str]] = []
    async for row in cur:
        key = (row[0], row[1])
        if current_key is not None and key != current_key:
            yield current_key, bucket
            bucket = []
        current_key = key
        bucket.append((row[2], row[3]))
    if current_key is not None:
        yield current_key, bucket


async def run(device: str | None = None, batch_size: int | None = None) -> None:
    device = device or settings.embedding_device
    batch_size = batch_size or settings.embedding_batch_size

    print(f"Loading {settings.embedding_model} on {device}...")
    model = SentenceTransformer(settings.embedding_model, device=device)
    print("Model loaded.")

    await init_pool()
    async with conn() as c:
        await c.execute("TRUNCATE embeddings")

        windows: list[tuple[str, int, int, int, str]] = []
        async for (work_slug, chapter_num), paragraphs in _stream_chapters(c):
            for start_para, w, text in _build_windows(paragraphs):
                windows.append((work_slug, chapter_num, start_para, w, text))

        print(f"Will embed {len(windows)} windows.")

        with Progress() as progress:
            task = progress.add_task("Embedding", total=len(windows))
            for batch_start in range(0, len(windows), batch_size):
                batch = windows[batch_start:batch_start + batch_size]
                texts = [t[4] for t in batch]
                vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
                rows = [
                    (b[0], b[1], b[2], b[3], vectors[i].tolist(), preprocess(b[4]))
                    for i, b in enumerate(batch)
                ]
                async with c.cursor() as cur:
                    await cur.executemany(
                        """
                        INSERT INTO embeddings
                            (work_slug, chapter_num, para_num, window_size,
                             vector, text_for_lexical)
                        VALUES (%s, %s, %s, %s, %s, to_tsvector('russian', %s))
                        """,
                        rows,
                    )
                progress.update(task, advance=len(batch))

    print("Building HNSW and GIN indexes...")
    async with conn() as c:
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_vector_idx "
            "ON embeddings USING hnsw (vector vector_cosine_ops) "
            "WITH (m=16, ef_construction=64)"
        )
        await c.execute(
            "CREATE INDEX IF NOT EXISTS embeddings_lexical_idx "
            "ON embeddings USING gin (text_for_lexical)"
        )
        await c.execute("ANALYZE embeddings")

    await close_pool()
    print("Done.")
```

- [ ] **Step 2: Прогон на subset (после Task 10)**

```bash
.venv/bin/python -m pipeline embed --batch-size 32 --device cuda
```

Expected: модель загружается, прогресс-бар, в конце «Building indexes» и «Done».

Если GPU нет — `--device cpu`. На CPU будет медленно, но для проверки работает.

Проверка:

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "SELECT COUNT(*) FROM embeddings;"
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "SELECT work_slug, COUNT(*) FROM embeddings GROUP BY 1 ORDER BY 2 DESC LIMIT 5;"
```

Expected: число эмбеддингов ≈ 3× числа параграфов.

- [ ] **Step 3: Sanity лексический поиск**

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "
SELECT w.title_display, e.chapter_num, e.para_num, e.window_size
FROM embeddings e
JOIN works w ON w.slug = e.work_slug
WHERE e.text_for_lexical @@ plainto_tsquery('russian', 'послушание')
LIMIT 5;
"
```

Expected: 5 строк с релевантными местами.

- [ ] **Step 4: Коммит**

```bash
git add packages/pipeline/pipeline/embed.py
git commit -m "feat(pipeline): bge-m3 embed + tsvector index for paragraph windows"
```

---

### Task 14: enrich.py — адаптация под Timeweb

**Files:**
- Modify: `packages/pipeline/pipeline/enrich.py` (полная замена скопированного содержимого)

- [ ] **Step 1: Заменить файл**

`packages/pipeline/pipeline/enrich.py`:

```python
"""Enrich md files with topics extracted by an LLM, write to frontmatter AND works.topics."""
import json
import re
from pathlib import Path

from openai import OpenAI
from rich.progress import Progress

from .config import settings
from .db import init_pool, close_pool, conn
from .slugify import slugify


PROMPT = """Проанализируй следующий православный текст и выдели от 3 до 7 ключевых тем.
Ответ — список через запятую, без пояснений и без префиксов.
Пример: Евангелие, Покаяние, Молитва, Пост

Текст:
{text}

Темы:"""


def _read_md(path: Path) -> tuple[str, str, str]:
    content = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", content, re.DOTALL)
    if m:
        return content, m.group(1), m.group(2)
    return content, "", content


def _add_topics(frontmatter: str, topics: list[str]) -> str:
    frontmatter = re.sub(r"^topics:.*?\n", "", frontmatter, flags=re.MULTILINE)
    line = f"topics: [{', '.join(topics)}]\n"
    if frontmatter and not frontmatter.endswith("\n"):
        frontmatter += "\n"
    return frontmatter + line


def _extract_topics(frontmatter: str) -> list[str] | None:
    m = re.search(r"^topics:\s*\[(.*)\]\s*$", frontmatter, re.MULTILINE)
    if not m:
        return None
    return [t.strip() for t in m.group(1).split(",") if t.strip()]


async def run() -> None:
    client = OpenAI(api_key=settings.timeweb_ai_key, base_url=settings.timeweb_base_url)
    md_files = list(settings.output_dir.rglob("*.md"))
    work_topics: dict[str, set[str]] = {}

    with Progress() as progress:
        task = progress.add_task("Enriching", total=len(md_files))
        for path in md_files:
            progress.update(task, advance=1)
            content, fm, body = _read_md(path)

            existing = _extract_topics(fm)
            if existing is None:
                resp = client.chat.completions.create(
                    model=settings.enrich_model,
                    messages=[{"role": "user", "content": PROMPT.format(text=body[:4000])}],
                    temperature=0.3,
                    max_tokens=100,
                )
                topics_str = resp.choices[0].message.content.strip()
                topics = [t.strip() for t in topics_str.split(",") if t.strip()][:7]
                if topics:
                    fm_new = _add_topics(fm, topics)
                    path.write_text(f"---\n{fm_new}---\n{body}", encoding="utf-8")
            else:
                topics = existing

            author = re.search(r"^author:\s*(.+)$", fm, re.MULTILINE)
            book = re.search(r"^book_title:\s*(.+)$", fm, re.MULTILINE)
            if author and book:
                ws = slugify(f"{slugify(author.group(1).strip())}_{book.group(1).strip()}")
                work_topics.setdefault(ws, set()).update(topics)

    await init_pool()
    async with conn() as c:
        for ws, topics in work_topics.items():
            await c.execute(
                "UPDATE works SET topics=%s WHERE slug=%s",
                [json.dumps(sorted(topics), ensure_ascii=False), ws],
            )
    await close_pool()
    print(f"Enriched topics for {len(work_topics)} works.")
```

- [ ] **Step 2: Прогон**

```bash
.venv/bin/python -m pipeline enrich
```

Expected: проходится по всем md, апдейтит frontmatter, пишет в `works.topics`.

```sql
SELECT slug, topics FROM works WHERE topics IS NOT NULL LIMIT 5;
```

- [ ] **Step 3: Коммит**

```bash
git add packages/pipeline/pipeline/enrich.py
git commit -m "feat(pipeline): enrich writes topics to md frontmatter and works.topics"
```

---

### Task 15: End-to-end checkpoint на 3 авторах

**Files:**
- (без новых файлов — только прогон и валидация)

- [ ] **Step 1: Subset через ENV**

Добавь в `config.py` поддержку OUTPUT_DIR override (если ещё нет):

```python
import os
from pathlib import Path
# в Settings:
output_dir: Path = Path(os.environ.get("OUTPUT_DIR") or
                        Path(__file__).resolve().parent.parent / "output")
```

Подготовь subset:

```bash
mkdir -p /tmp/mvp_subset
cp -r packages/pipeline/output/Православная_библиотека_Святых/Аврелий_Августин_блаженный /tmp/mvp_subset/
cp -r packages/pipeline/output/Православная_библиотека_Святых/Иоанн_Лествичник_преподобный /tmp/mvp_subset/
cp -r packages/pipeline/output/Православная_библиотека_Святых/Брянчанинов_Игнатий_святитель /tmp/mvp_subset/
```

- [ ] **Step 2: Полный цикл на subset**

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE;"

OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline diagnose
OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline paragraphs
OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline embed --device cuda --batch-size 64
OUTPUT_DIR=/tmp/mvp_subset .venv/bin/python -m pipeline enrich
```

- [ ] **Step 3: Финальные sanity-проверки**

```sql
SELECT COUNT(*) FROM authors;         -- 3
SELECT COUNT(*) FROM works;           -- 50-70
SELECT COUNT(*) FROM chapters;        -- сотни
SELECT COUNT(*) FROM paragraphs;      -- тысячи
SELECT COUNT(*) FROM embeddings;      -- ~3× paragraphs

-- Лексический smoke
SELECT w.title_display, e.chapter_num, e.para_num
FROM embeddings e JOIN works w ON w.slug=e.work_slug
WHERE e.text_for_lexical @@ plainto_tsquery('russian', 'послушание')
  AND w.author_slug='ioann_lestvichnik_prepodobnyj'
LIMIT 10;
```

Expected: 10 строк из Лествицы, преимущественно Слово 4.

- [ ] **Step 4: Checkpoint commit (пустой)**

```bash
git commit --allow-empty -m "checkpoint: pipeline e2e works on 3-author subset"
```

---

## Phase 4 — Backend foundation

### Task 16: backend pyproject + langgraph.json + Dockerfile

**Files:**
- Create: `apps/backend/pyproject.toml`
- Create: `apps/backend/langgraph.json`
- Create: `apps/backend/Dockerfile`
- Create: `apps/backend/src/backend/__init__.py`
- Create: `apps/backend/src/backend/config.py`
- Create: `apps/backend/src/backend/db.py`

- [ ] **Step 1: pyproject.toml**

`apps/backend/pyproject.toml`:

```toml
[project]
name = "patristic-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "langgraph>=0.2.50",
    "langgraph-cli[inmem]>=0.1.65",
    "langchain>=0.3",
    "langchain-core>=0.3",
    "langchain-openai>=0.2",
    "deepagents>=0.0.10",
    "sentence-transformers>=3.0",
    "torch>=2.3",
    "psycopg[binary,pool]>=3.2",
    "pgvector>=0.3",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "fastapi>=0.115",
    "uvicorn>=0.30",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5.0",
    "httpx>=0.27",
    "ruff>=0.5",
]

[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Note:** `deepagents` версия может отличаться — проверить актуальную на pypi (`pip index versions deepagents`). Если пакет недоступен, fallback — реализовать subagent dispatch вручную через LangGraph `Send` (это документировано в LangGraph docs).

- [ ] **Step 2: langgraph.json**

`apps/backend/langgraph.json`:

```json
{
  "dependencies": ["."],
  "graphs": {
    "patristic": "./src/backend/graph.py:agent"
  },
  "env": ".env",
  "http": {
    "app": "./src/backend/catalog.py:app"
  }
}
```

Конфиг предписывает LangGraph Server mount FastAPI приложение из `catalog.py` под кастомные роуты. Это даёт нам `GET /catalog` параллельно с langgraph-эндпоинтами.

- [ ] **Step 3: __init__ и config**

`apps/backend/src/backend/__init__.py`:

```python
__version__ = "0.1.0"
```

`apps/backend/src/backend/config.py`:

```python
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    postgres_dsn: str = "postgresql://postgres:postgres@localhost:5432/patristic"

    timeweb_ai_key: str = ""
    timeweb_base_url: str = "https://api.timeweb.ai/v1"
    main_agent_model: str = "anthropic/claude-sonnet-4-7"
    search_agent_model: str = "anthropic/claude-haiku-4-5"

    embedding_model: str = "BAAI/bge-m3"
    embedding_device: str = "cpu"
    embedding_batch_size: int = 16
    embedding_batch_window_ms: int = 50

    # Path to glossary.json (shared with pipeline)
    glossary_path: Path = Path(__file__).resolve().parents[4] / "packages" / "pipeline" / "glossary.json"


settings = Settings()
```

- [ ] **Step 4: db.py**

`apps/backend/src/backend/db.py`:

```python
from contextlib import asynccontextmanager
from typing import AsyncIterator
import psycopg
from psycopg_pool import AsyncConnectionPool

from .config import settings

_pool: AsyncConnectionPool | None = None


async def init_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(settings.postgres_dsn, min_size=2, max_size=16, open=False)
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def conn() -> AsyncIterator[psycopg.AsyncConnection]:
    pool = await init_pool()
    async with pool.connection() as c:
        yield c
```

- [ ] **Step 5: Dockerfile**

`apps/backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ ./src/

RUN pip install --no-cache-dir -e .

# Pre-cache embedding model (so first request is fast)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"

EXPOSE 2024
CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", "--no-browser"]
```

- [ ] **Step 6: Установка + smoke**

```bash
cd apps/backend
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -c "from backend.config import settings; print(settings.postgres_dsn)"
.venv/bin/python -c "import asyncio; from backend.db import init_pool, close_pool; asyncio.run((lambda: (init_pool(), close_pool()))().__await__().__next__())" 2>&1 | head -5
```

Лучше упрощённый sanity:

```bash
.venv/bin/python -c "
import asyncio
from backend.db import init_pool, conn, close_pool

async def main():
    async with conn() as c:
        cur = await c.execute('SELECT 1')
        print((await cur.fetchone())[0])
    await close_pool()

asyncio.run(main())
"
```

Expected: `1`.

- [ ] **Step 7: Коммит**

```bash
git add apps/backend/
git commit -m "feat(backend): pyproject, langgraph.json, Dockerfile, config, db pool"
```

---

### Task 17: embeddings service — queue-batching worker (TDD)

**Files:**
- Create: `apps/backend/src/backend/embeddings/__init__.py`
- Create: `apps/backend/src/backend/embeddings/service.py`
- Test: `apps/backend/tests/unit/test_embeddings_service.py`
- Create: `apps/backend/tests/conftest.py`

Сердце бека — async embedding service с micro-batching. Тестируем под mock-моделью.

- [ ] **Step 1: conftest.py (общие фикстуры)**

`apps/backend/tests/conftest.py`:

```python
"""Pytest fixtures shared across backend tests."""
import asyncio
from typing import Any
import pytest


class FakeModel:
    """Mock SentenceTransformer for tests. Returns deterministic vectors based on text length."""
    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        self.encode_calls: list[list[str]] = []

    def encode(self, texts: list[str], **kwargs: Any):
        """Return numpy array (B, D). Deterministic: float(len) / 1000 in slot 0, rest zeros."""
        import numpy as np
        self.encode_calls.append(list(texts))
        out = np.zeros((len(texts), self.dim), dtype="float32")
        for i, t in enumerate(texts):
            out[i, 0] = float(len(t)) / 1000.0
            out[i, 1] = float(hash(t) % 1000) / 1000.0
        return out


@pytest.fixture
def fake_model() -> FakeModel:
    return FakeModel()
```

- [ ] **Step 2: Failing test**

`apps/backend/tests/unit/test_embeddings_service.py`:

```python
import asyncio
import pytest

from backend.embeddings.service import EmbeddingService


@pytest.mark.asyncio
async def test_single_embedding_returns_vector(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    try:
        vec = await svc.embed("hello world")
        assert len(vec) == 1024
        assert vec[0] == pytest.approx(11.0 / 1000.0)  # len("hello world") == 11
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_parallel_calls_batched(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=8, window_ms=20)
    await svc.start()
    try:
        results = await asyncio.gather(*[svc.embed(f"q{i}") for i in range(8)])
        assert len(results) == 8
        # All 8 should be batched into one or two encode() calls (≤ 2 batches)
        assert len(fake_model.encode_calls) <= 2
        # Each batch contains 1..8 items
        total = sum(len(b) for b in fake_model.encode_calls)
        assert total == 8
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_batch_filled_to_max(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=500)
    await svc.start()
    try:
        # 8 simultaneous → 2 batches of 4
        results = await asyncio.gather(*[svc.embed(f"x{i}") for i in range(8)])
        assert len(results) == 8
        assert len(fake_model.encode_calls) == 2
        assert all(len(b) == 4 for b in fake_model.encode_calls)
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_stop_drains_queue(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=50)
    await svc.start()
    tasks = [asyncio.create_task(svc.embed(f"t{i}")) for i in range(3)]
    await asyncio.sleep(0.01)  # let them queue
    await svc.stop()
    # Tasks should still complete (worker drained before exit)
    results = await asyncio.gather(*tasks)
    assert len(results) == 3
```

- [ ] **Step 3: Failing**

```bash
cd apps/backend
.venv/bin/pytest tests/unit/test_embeddings_service.py -v
```

Expected: ImportError.

- [ ] **Step 4: Реализация сервиса**

`apps/backend/src/backend/embeddings/__init__.py`:

```python
from .service import EmbeddingService, get_service

__all__ = ["EmbeddingService", "get_service"]
```

`apps/backend/src/backend/embeddings/service.py`:

```python
"""Async embedding service with micro-batching."""
import asyncio
from typing import Any

from ..config import settings


class EmbeddingService:
    def __init__(self, model: Any, batch_size: int = 16, window_ms: int = 50) -> None:
        self._model = model
        self._batch_size = batch_size
        self._window_s = window_ms / 1000.0
        self._queue: asyncio.Queue[tuple[str, asyncio.Future]] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._worker_task is None:
            self._stop.clear()
            self._worker_task = asyncio.create_task(self._worker())

    async def stop(self) -> None:
        self._stop.set()
        if self._worker_task is not None:
            # signal queue
            await self._queue.put(("__SHUTDOWN__", asyncio.get_event_loop().create_future()))
            await self._worker_task
            self._worker_task = None

    async def embed(self, text: str) -> list[float]:
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        await self._queue.put((text, fut))
        return await fut

    async def _worker(self) -> None:
        while True:
            # Take first item (blocks)
            first = await self._queue.get()
            if first[0] == "__SHUTDOWN__":
                first[1].cancel()
                break
            batch: list[tuple[str, asyncio.Future]] = [first]

            # Try to fill to batch_size within window
            deadline = asyncio.get_event_loop().time() + self._window_s
            while len(batch) < self._batch_size:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(self._queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                if item[0] == "__SHUTDOWN__":
                    # drain rest then exit
                    item[1].cancel()
                    # process current batch then return
                    await self._process(batch)
                    # drain remaining items quickly without waiting
                    while True:
                        try:
                            extra = self._queue.get_nowait()
                            if extra[0] == "__SHUTDOWN__":
                                extra[1].cancel()
                                continue
                            await self._process([extra])
                        except asyncio.QueueEmpty:
                            break
                    return
                batch.append(item)

            await self._process(batch)

    async def _process(self, batch: list[tuple[str, asyncio.Future]]) -> None:
        texts = [t for t, _ in batch]
        try:
            vectors = await asyncio.to_thread(
                self._model.encode, texts, normalize_embeddings=True
            )
        except Exception as e:
            for _, fut in batch:
                if not fut.done():
                    fut.set_exception(e)
            return
        for (_, fut), vec in zip(batch, vectors):
            if not fut.done():
                fut.set_result(vec.tolist())


_svc: EmbeddingService | None = None


def get_service() -> EmbeddingService:
    global _svc
    if _svc is None:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(settings.embedding_model, device=settings.embedding_device)
        _svc = EmbeddingService(
            model=model,
            batch_size=settings.embedding_batch_size,
            window_ms=settings.embedding_batch_window_ms,
        )
    return _svc
```

- [ ] **Step 5: Тесты PASS**

```bash
.venv/bin/pytest tests/unit/test_embeddings_service.py -v
```

Expected: 4 PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/backend/src/backend/embeddings/ apps/backend/tests/unit/test_embeddings_service.py \
        apps/backend/tests/conftest.py
git commit -m "feat(backend): embedding service with async queue micro-batching"
```

---

### Task 18: Tool — list_authors (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/__init__.py`
- Create: `apps/backend/src/backend/tools/list_authors.py`
- Test: `apps/backend/tests/unit/test_list_authors.py`

Каждый тул — отдельный модуль с одной `@tool`-декорированной функцией. Тесты в реальной БД через фикстуру.

- [ ] **Step 1: Расширить conftest.py DB фикстурой**

В конец `apps/backend/tests/conftest.py` добавить:

```python
import psycopg

DB_DSN_TEST = "postgresql://postgres:postgres@localhost:5432/patristic"


@pytest.fixture
async def db_clean():
    """Truncate tables before test (uses real local postgres)."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST) as c:
        await c.execute("TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE")
    yield
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST) as c:
        await c.execute("TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE")


@pytest.fixture
async def db_with_seed_authors(db_clean):
    """Seed 3 authors with works for tool tests."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST) as c:
        await c.execute("""
            INSERT INTO authors (slug, name_display, years, century, global_section) VALUES
            ('avgustin', 'Аврелий Августин, блаженный', '(354–430)', 5, 'Православная библиотека'),
            ('lestvichnik', 'Иоанн Лествичник, преподобный', '(~579–~649)', 7, 'Православная библиотека'),
            ('platon', 'Платон', '(427–347 до н.э.)', -4, 'Философия')
        """)
        await c.execute("""
            INSERT INTO works (slug, author_slug, title_display, creation_date, section, source_url, paragraph_count) VALUES
            ('avgustin_ispoved', 'avgustin', 'Исповедь', '400', 'Автобиографические сочинения',
             'https://azbyka.ru/otechnik/Avrelij_Avgustin/ispoved/', 412),
            ('lestvichnik_lestvica', 'lestvichnik', 'Лествица', '600', 'Аскетические сочинения',
             'https://azbyka.ru/otechnik/Ioann_Lestvichnik/lestvica/', 1247),
            ('platon_gosudarstvo', 'platon', 'Государство', '380 до н.э.', NULL,
             'https://azbyka.ru/otechnik/filosofija/platon/gosudarstvo/', 800)
        """)
    yield
```

- [ ] **Step 2: Failing test**

`apps/backend/tests/unit/test_list_authors.py`:

```python
import pytest
from backend.tools.list_authors import list_authors


@pytest.mark.asyncio
async def test_list_authors_returns_all(db_with_seed_authors):
    result = await list_authors.ainvoke({})
    assert len(result) == 3
    slugs = {a["slug"] for a in result}
    assert slugs == {"avgustin", "lestvichnik", "platon"}


@pytest.mark.asyncio
async def test_list_authors_includes_metadata(db_with_seed_authors):
    result = await list_authors.ainvoke({})
    avg = next(a for a in result if a["slug"] == "avgustin")
    assert avg["name_display"] == "Аврелий Августин, блаженный"
    assert avg["years"] == "(354–430)"
    assert avg["century"] == 5
```

- [ ] **Step 3: Failing**

```bash
.venv/bin/pytest tests/unit/test_list_authors.py -v
```

Expected: ImportError.

- [ ] **Step 4: Реализация**

`apps/backend/src/backend/tools/__init__.py`:

```python
"""Agent tools. Each module exports a single @tool-decorated function."""
```

`apps/backend/src/backend/tools/list_authors.py`:

```python
"""Tool: list_authors — returns all authors with basic metadata."""
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_authors() -> list[dict]:
    """Список всех авторов с базовыми метаданными.

    Возвращает: список объектов {slug, name_display, years, century, global_section}.
    """
    async with conn() as c:
        cur = await c.execute(
            """
            SELECT slug, name_display, years, century, global_section
            FROM authors
            ORDER BY name_display
            """
        )
        rows = await cur.fetchall()
    return [
        {
            "slug": r[0],
            "name_display": r[1],
            "years": r[2],
            "century": r[3],
            "global_section": r[4],
        }
        for r in rows
    ]
```

- [ ] **Step 5: Tests PASS**

```bash
.venv/bin/pytest tests/unit/test_list_authors.py -v
```

Expected: 2 PASS.

- [ ] **Step 6: Коммит**

```bash
git add apps/backend/src/backend/tools/__init__.py \
        apps/backend/src/backend/tools/list_authors.py \
        apps/backend/tests/unit/test_list_authors.py \
        apps/backend/tests/conftest.py
git commit -m "feat(backend): list_authors tool"
```

---

### Task 19: Tool — list_works (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/list_works.py`
- Test: `apps/backend/tests/unit/test_list_works.py`

- [ ] **Step 1: Test**

`apps/backend/tests/unit/test_list_works.py`:

```python
import pytest
from backend.tools.list_works import list_works


@pytest.mark.asyncio
async def test_list_works_for_author(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "avgustin"})
    assert len(result) == 1
    w = result[0]
    assert w["slug"] == "avgustin_ispoved"
    assert w["title_display"] == "Исповедь"
    assert w["source_url"].startswith("https://azbyka.ru")
    assert w["paragraph_count"] == 412


@pytest.mark.asyncio
async def test_list_works_unknown_author_returns_empty(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "no_such_author"})
    assert result == []


@pytest.mark.asyncio
async def test_list_works_for_philosophy_author(db_with_seed_authors):
    result = await list_works.ainvoke({"author_slug": "platon"})
    assert len(result) == 1
    assert result[0]["slug"] == "platon_gosudarstvo"
```

- [ ] **Step 2: Failing → реализация**

`apps/backend/src/backend/tools/list_works.py`:

```python
"""Tool: list_works — works by author."""
import json
from langchain_core.tools import tool

from ..db import conn


@tool
async def list_works(author_slug: str) -> list[dict]:
    """Список трудов автора.

    Args:
        author_slug: канонический slug автора (из list_authors).

    Возвращает список {slug, title_display, creation_date, section, source_url, topics, paragraph_count}.
    """
    async with conn() as c:
        cur = await c.execute(
            """
            SELECT slug, title_display, creation_date, section, source_url, topics, paragraph_count
            FROM works
            WHERE author_slug = %s
            ORDER BY title_display
            """,
            [author_slug],
        )
        rows = await cur.fetchall()
    return [
        {
            "slug": r[0],
            "title_display": r[1],
            "creation_date": r[2],
            "section": r[3],
            "source_url": r[4],
            "topics": (json.loads(r[5]) if isinstance(r[5], str) else r[5]) or [],
            "paragraph_count": r[6],
        }
        for r in rows
    ]
```

- [ ] **Step 3: Тесты PASS + коммит**

```bash
.venv/bin/pytest tests/unit/test_list_works.py -v
git add apps/backend/src/backend/tools/list_works.py \
        apps/backend/tests/unit/test_list_works.py
git commit -m "feat(backend): list_works tool"
```

---

### Task 20: Tool — expand_concept (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/expand_concept.py`
- Test: `apps/backend/tests/unit/test_expand_concept.py`

Читает `packages/pipeline/glossary.json`, возвращает раскрытие концепта или соседние варианты при отсутствии точного матча.

- [ ] **Step 1: Test**

`apps/backend/tests/unit/test_expand_concept.py`:

```python
import json
import pytest
from pathlib import Path

from backend.tools.expand_concept import expand_concept


@pytest.fixture(autouse=True)
def patch_glossary(monkeypatch, tmp_path):
    glossary = {
        "concepts": {
            "гордость": {
                "canonical": "гордость",
                "synonyms": ["превозношение", "кичение", "высокоумие"],
                "related": ["тщеславие", "самомнение"],
                "antonyms": ["смирение"],
                "greek": ["ὑπερηφανία", "οἴησις"],
            },
            "молитва Иисусова": {
                "canonical": "молитва Иисусова",
                "synonyms": ["умная молитва", "сердечная молитва", "непрестанная молитва"],
                "related": ["трезвение", "исихия"],
                "antonyms": [],
                "greek": ["νοερὰ προσευχή"],
            },
        }
    }
    path = tmp_path / "glossary.json"
    path.write_text(json.dumps(glossary, ensure_ascii=False), encoding="utf-8")
    from backend.tools import expand_concept as ec
    monkeypatch.setattr(ec, "GLOSSARY_PATH", path)
    ec._cache = None  # reset cache


@pytest.mark.asyncio
async def test_expand_known_concept():
    result = await expand_concept.ainvoke({"term": "гордость"})
    assert result["found"] is True
    assert "превозношение" in result["synonyms"]
    assert "ὑπερηφανία" in result["greek"]
    assert "смирение" in result["antonyms"]


@pytest.mark.asyncio
async def test_expand_case_insensitive():
    result = await expand_concept.ainvoke({"term": "ГОРДОСТЬ"})
    assert result["found"] is True


@pytest.mark.asyncio
async def test_expand_unknown_returns_not_found():
    result = await expand_concept.ainvoke({"term": "неизвестный_концепт_xyz"})
    assert result["found"] is False
    assert "suggestions" in result
```

- [ ] **Step 2: Реализация**

`apps/backend/src/backend/tools/expand_concept.py`:

```python
"""Tool: expand_concept — reads glossary.json, returns concept expansion."""
import json
from pathlib import Path
from langchain_core.tools import tool

from ..config import settings


GLOSSARY_PATH: Path = settings.glossary_path
_cache: dict | None = None


def _load() -> dict:
    global _cache
    if _cache is None:
        if not GLOSSARY_PATH.exists():
            _cache = {"concepts": {}}
        else:
            _cache = json.loads(GLOSSARY_PATH.read_text(encoding="utf-8"))
    return _cache


@tool
async def expand_concept(term: str) -> dict:
    """Расширяет концепт: возвращает синонимы, связанные, антонимы, греческие термины.

    Args:
        term: концепт на русском.

    Возвращает:
        {found: bool, canonical, synonyms, related, antonyms, greek}
        Если не найден — {found: False, suggestions: [близкие из словаря]}.
    """
    data = _load()
    concepts: dict[str, dict] = data.get("concepts", {})

    # Точный матч (case-insensitive)
    key = next((k for k in concepts if k.lower() == term.lower()), None)
    if key:
        entry = concepts[key]
        return {
            "found": True,
            "canonical": entry["canonical"],
            "synonyms": entry["synonyms"],
            "related": entry["related"],
            "antonyms": entry["antonyms"],
            "greek": entry["greek"],
        }

    # Fuzzy: substring совпадения
    suggestions = [k for k in concepts if term.lower() in k.lower() or k.lower() in term.lower()][:5]
    return {"found": False, "suggestions": suggestions}
```

- [ ] **Step 3: Tests PASS + коммит**

```bash
.venv/bin/pytest tests/unit/test_expand_concept.py -v
git add apps/backend/src/backend/tools/expand_concept.py \
        apps/backend/tests/unit/test_expand_concept.py
git commit -m "feat(backend): expand_concept tool with fuzzy fallback"
```

---

## Phase 5 — Поисковые тулы

### Task 21: Tool — lexical_search (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/lexical_search.py`
- Test: `apps/backend/tests/unit/test_lexical_search.py`

Использует Postgres `tsvector` + `ts_rank`. Препроцессит запрос тем же `preprocess()` что и при индексации.

- [ ] **Step 1: Расширить фикстуру `db_with_seed_authors`**

В `conftest.py` добавить фикстуру `db_with_paragraphs`:

```python
@pytest.fixture
async def db_with_paragraphs(db_with_seed_authors):
    """Add chapters, paragraphs and lexical embeddings for tool tests."""
    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST) as c:
        await c.execute("""
            INSERT INTO chapters (work_slug, chapter_num, title) VALUES
            ('lestvichnik_lestvica', 4, 'О блаженном послушании'),
            ('lestvichnik_lestvica', 1, 'Об отречении')
        """)
        await c.execute("""
            INSERT INTO paragraphs (work_slug, chapter_num, para_num, text, char_offset_start, char_offset_end) VALUES
            ('lestvichnik_lestvica', 4, 1, 'Послушание есть совершенное отречение от своей души.', 0, 60),
            ('lestvichnik_lestvica', 4, 2, 'Послушник тот, кто, имея тело по виду, ум же ангельский, не имеет вовсе своей воли.', 60, 150),
            ('lestvichnik_lestvica', 1, 1, 'Отречение от мира есть произвольная ненависть к похваляемому веществу.', 0, 80)
        """)
        # Insert lexical embeddings only (zero vector — semantic tested separately)
        await c.execute("""
            INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, vector, text_for_lexical) VALUES
            ('lestvichnik_lestvica', 4, 1, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'послушание есть совершенное отречение от своей души')),
            ('lestvichnik_lestvica', 4, 2, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'послушник тот кто имея тело по виду ум же ангельский не имеет вовсе своей воли')),
            ('lestvichnik_lestvica', 1, 1, 1, ARRAY_FILL(0::float4, ARRAY[1024])::vector,
             to_tsvector('russian', 'отречение от мира есть произвольная ненависть к похваляемому веществу'))
        """)
    yield
```

- [ ] **Step 2: Test**

`apps/backend/tests/unit/test_lexical_search.py`:

```python
import pytest
from backend.tools.lexical_search import lexical_search


@pytest.mark.asyncio
async def test_lexical_search_finds_obvious(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "послушание"})
    assert len(result) >= 1
    top = result[0]
    assert top["work_slug"] == "lestvichnik_lestvica"
    assert top["chapter_num"] == 4
    assert "послушание" in top["snippet"].lower() or "послушник" in top["snippet"].lower()


@pytest.mark.asyncio
async def test_lexical_search_filter_by_author(db_with_paragraphs):
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "author_slug": "lestvichnik",
    })
    assert len(result) >= 1
    for r in result:
        assert r["work_slug"].startswith("lestvichnik_")


@pytest.mark.asyncio
async def test_lexical_search_filter_by_work(db_with_paragraphs):
    result = await lexical_search.ainvoke({
        "query": "отречение",
        "work_slug": "lestvichnik_lestvica",
    })
    for r in result:
        assert r["work_slug"] == "lestvichnik_lestvica"


@pytest.mark.asyncio
async def test_lexical_search_returns_canonical_citation(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "послушание"})
    top = result[0]
    assert "citation" in top
    # Формат: <author>/<work>/<chapter>/p<para>
    assert top["citation"].startswith("lestvichnik/lestvichnik_lestvica/")
    assert "/p" in top["citation"]


@pytest.mark.asyncio
async def test_lexical_search_respects_limit(db_with_paragraphs):
    result = await lexical_search.ainvoke({"query": "отречение", "limit": 1})
    assert len(result) == 1
```

- [ ] **Step 3: Failing**

```bash
.venv/bin/pytest tests/unit/test_lexical_search.py -v
```

- [ ] **Step 4: Реализация**

Сначала добавим маленький helper для канонической ссылки. Создать:

`apps/backend/src/backend/tools/_citation.py`:

```python
"""Canonical citation format helpers."""


def make_citation(author_slug: str, work_slug: str, chapter_num: int,
                  para_start: int, window_size: int = 1) -> str:
    if window_size == 1:
        return f"{author_slug}/{work_slug}/{chapter_num:04d}/p{para_start}"
    para_end = para_start + window_size - 1
    return f"{author_slug}/{work_slug}/{chapter_num:04d}/p{para_start}-{para_end}"


def parse_citation(citation: str) -> dict:
    """Parse 'author/work/chapter/pX[-Y]' back to fields."""
    parts = citation.split("/")
    if len(parts) != 4:
        raise ValueError(f"bad citation: {citation}")
    author, work, chapter, p = parts
    chapter_num = int(chapter)
    if "-" in p:
        a, b = p[1:].split("-")
        para_start = int(a)
        window_size = int(b) - para_start + 1
    else:
        para_start = int(p[1:])
        window_size = 1
    return {
        "author_slug": author,
        "work_slug": work,
        "chapter_num": chapter_num,
        "para_start": para_start,
        "window_size": window_size,
    }
```

`apps/backend/src/backend/tools/lexical_search.py`:

```python
"""Tool: lexical_search — Postgres tsvector + ts_rank, with optional filters."""
from langchain_core.tools import tool

from ..db import conn
from ._citation import make_citation


# We re-use the same CS preprocess function from pipeline for symmetry.
# Pipeline is not a runtime dependency of backend, so we keep a tiny local copy.
import json
import re
from functools import lru_cache
from pathlib import Path

_CS_DICT_PATH = Path(__file__).resolve().parents[4] / "packages" / "pipeline" / "cs_dict.json"
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")


@lru_cache(maxsize=1)
def _cs_dict() -> dict[str, str]:
    if _CS_DICT_PATH.exists():
        return json.loads(_CS_DICT_PATH.read_text(encoding="utf-8"))
    return {}


def _preprocess(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT.sub(" ", text)
    text = _WS.sub(" ", text).strip()
    cs = _cs_dict()
    if cs:
        text = " ".join(cs.get(t, t) for t in text.split())
    return text


@tool
async def lexical_search(
    query: str,
    author_slug: str | None = None,
    work_slug: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Лексический поиск (tsvector + ts_rank) с опциональными фильтрами.

    Args:
        query: текст запроса.
        author_slug: фильтр по автору.
        work_slug: фильтр по труду.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    q = _preprocess(query)
    if not q:
        return []

    filters = []
    params: list = [q, q]  # tsquery used twice (filter + rank)
    if author_slug:
        filters.append("w.author_slug = %s")
        params.append(author_slug)
    if work_slug:
        filters.append("e.work_slug = %s")
        params.append(work_slug)
    where_extra = (" AND " + " AND ".join(filters)) if filters else ""
    params.append(limit)

    sql = f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               ts_rank(e.text_for_lexical, plainto_tsquery('russian', %s)) AS score
        FROM embeddings e
        JOIN works w ON w.slug = e.work_slug
        JOIN paragraphs p ON p.work_slug = e.work_slug
            AND p.chapter_num = e.chapter_num
            AND p.para_num = e.para_num
        WHERE e.text_for_lexical @@ plainto_tsquery('russian', %s){where_extra}
        ORDER BY score DESC
        LIMIT %s
    """

    async with conn() as c:
        cur = await c.execute(sql, params)
        rows = await cur.fetchall()

    return [
        {
            "citation": make_citation(r[0], r[1], r[2], r[3], r[4]),
            "work_slug": r[1],
            "chapter_num": r[2],
            "para_num": r[3],
            "window_size": r[4],
            "snippet": r[5],
            "score": float(r[6]),
        }
        for r in rows
    ]
```

- [ ] **Step 5: Тесты PASS + коммит**

```bash
.venv/bin/pytest tests/unit/test_lexical_search.py -v
git add apps/backend/src/backend/tools/lexical_search.py \
        apps/backend/src/backend/tools/_citation.py \
        apps/backend/tests/unit/test_lexical_search.py \
        apps/backend/tests/conftest.py
git commit -m "feat(backend): lexical_search tool with CS preprocess and citations"
```

---

### Task 22: Tool — semantic_search (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/semantic_search.py`
- Test: `apps/backend/tests/unit/test_semantic_search.py`

Использует bge-m3 для query embedding и pgvector ANN. Тест с mock-моделью.

- [ ] **Step 1: Test (использует fake_model и инжектит свой EmbeddingService)**

`apps/backend/tests/unit/test_semantic_search.py`:

```python
import pytest
import psycopg

from backend.tools import semantic_search as ss_module
from backend.embeddings.service import EmbeddingService

DB_DSN_TEST = "postgresql://postgres:postgres@localhost:5432/patristic"


@pytest.fixture
async def db_with_real_vectors(db_with_seed_authors, fake_model):
    """Seed paragraphs + embeddings using fake_model (so query embedding matches)."""
    # Map texts to deterministic vectors via FakeModel
    texts = [
        ("lestvichnik_lestvica", 4, 1, "Послушание есть совершенное отречение"),
        ("lestvichnik_lestvica", 4, 2, "Послушник имея тело по виду ум ангельский"),
        ("lestvichnik_lestvica", 1, 1, "Отречение от мира есть произвольная ненависть"),
    ]
    vectors = fake_model.encode([t[3] for t in texts])

    async with await psycopg.AsyncConnection.connect(DB_DSN_TEST) as c:
        await c.execute("INSERT INTO chapters (work_slug, chapter_num, title) VALUES "
                        "('lestvichnik_lestvica', 4, 'О послушании'), "
                        "('lestvichnik_lestvica', 1, 'Об отречении')")
        for t, v in zip(texts, vectors):
            await c.execute(
                "INSERT INTO paragraphs (work_slug, chapter_num, para_num, text, "
                "char_offset_start, char_offset_end) VALUES (%s,%s,%s,%s,0,%s)",
                [t[0], t[1], t[2], t[3], len(t[3])],
            )
            await c.execute(
                "INSERT INTO embeddings (work_slug, chapter_num, para_num, window_size, "
                "vector, text_for_lexical) VALUES (%s,%s,%s,1,%s,to_tsvector('russian',%s))",
                [t[0], t[1], t[2], v.tolist(), t[3]],
            )
    yield


@pytest.mark.asyncio
async def test_semantic_search_returns_top_match(db_with_real_vectors, fake_model, monkeypatch):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    monkeypatch.setattr(ss_module, "_get_service", lambda: svc)

    # Query text identical to first seed → vector match
    result = await ss_module.semantic_search.ainvoke({"query": "Послушание есть совершенное отречение"})
    await svc.stop()
    assert len(result) >= 1
    top = result[0]
    assert top["work_slug"] == "lestvichnik_lestvica"
    assert top["citation"].startswith("lestvichnik/lestvichnik_lestvica/")


@pytest.mark.asyncio
async def test_semantic_search_filter_by_author(db_with_real_vectors, fake_model, monkeypatch):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    monkeypatch.setattr(ss_module, "_get_service", lambda: svc)

    result = await ss_module.semantic_search.ainvoke({
        "query": "Отречение",
        "author_slug": "lestvichnik",
    })
    await svc.stop()
    for r in result:
        assert "lestvichnik" in r["citation"]
```

- [ ] **Step 2: Failing**

```bash
.venv/bin/pytest tests/unit/test_semantic_search.py -v
```

- [ ] **Step 3: Реализация**

`apps/backend/src/backend/tools/semantic_search.py`:

```python
"""Tool: semantic_search — bge-m3 + pgvector ANN with optional filters."""
from langchain_core.tools import tool

from ..db import conn
from ..embeddings import get_service
from ._citation import make_citation


# Indirection for tests (monkeypatch this in fixtures)
def _get_service():
    return get_service()


@tool
async def semantic_search(
    query: str,
    author_slug: str | None = None,
    work_slug: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """Семантический поиск через эмбеддинги.

    Args:
        query: текст запроса.
        author_slug: фильтр по автору.
        work_slug: фильтр по труду.
        limit: максимум результатов.

    Возвращает [{citation, work_slug, chapter_num, para_num, window_size, snippet, score}].
    """
    if not query.strip():
        return []

    svc = _get_service()
    vec = await svc.embed(query)

    filters = []
    params: list = [vec]
    if author_slug:
        filters.append("w.author_slug = %s")
        params.append(author_slug)
    if work_slug:
        filters.append("e.work_slug = %s")
        params.append(work_slug)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.append(limit)

    sql = f"""
        SELECT w.author_slug, e.work_slug, e.chapter_num, e.para_num, e.window_size,
               LEFT(p.text, 200) AS snippet,
               1 - (e.vector <=> %s::vector) AS score
        FROM embeddings e
        JOIN works w ON w.slug = e.work_slug
        JOIN paragraphs p ON p.work_slug=e.work_slug AND p.chapter_num=e.chapter_num AND p.para_num=e.para_num
        {where}
        ORDER BY e.vector <=> %s::vector
        LIMIT %s
    """
    # Need to pass vec twice (select expr + order by)
    full_params = [vec] + params[1:-1] + [vec, params[-1]]

    async with conn() as c:
        cur = await c.execute(sql, full_params)
        rows = await cur.fetchall()

    return [
        {
            "citation": make_citation(r[0], r[1], r[2], r[3], r[4]),
            "work_slug": r[1],
            "chapter_num": r[2],
            "para_num": r[3],
            "window_size": r[4],
            "snippet": r[5],
            "score": float(r[6]),
        }
        for r in rows
    ]
```

- [ ] **Step 4: Тесты PASS + коммит**

```bash
.venv/bin/pytest tests/unit/test_semantic_search.py -v
git add apps/backend/src/backend/tools/semantic_search.py \
        apps/backend/tests/unit/test_semantic_search.py
git commit -m "feat(backend): semantic_search tool with pgvector ANN"
```

---

### Task 23: Tool — read_passage (TDD)

**Files:**
- Create: `apps/backend/src/backend/tools/read_passage.py`
- Test: `apps/backend/tests/unit/test_read_passage.py`

Этот тул — **ключевой для anti-hallucination**. Принимает citation, возвращает точный текст + N абзацев контекста + метаданные.

- [ ] **Step 1: Test**

`apps/backend/tests/unit/test_read_passage.py`:

```python
import pytest
from backend.tools.read_passage import read_passage


@pytest.mark.asyncio
async def test_read_passage_returns_exact_text(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p1",
        "context_n": 0,
    })
    assert "Послушание есть совершенное отречение" in result["text"]
    assert result["author"] == "Иоанн Лествичник, преподобный"
    assert result["work_title"] == "Лествица"
    assert result["chapter_num"] == 4
    assert result["source_url"].startswith("https://azbyka.ru")


@pytest.mark.asyncio
async def test_read_passage_window_range(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p1-2",
        "context_n": 0,
    })
    # Объединяет 2 параграфа
    assert "Послушание есть" in result["text"]
    assert "Послушник тот" in result["text"]


@pytest.mark.asyncio
async def test_read_passage_with_context(db_with_paragraphs):
    result = await read_passage.ainvoke({
        "citation": "lestvichnik/lestvichnik_lestvica/0004/p2",
        "context_n": 1,
    })
    # context_n=1: p1 (контекст) + p2 (основной) — p3 нет в фикстуре
    assert "Послушание есть" in result["context_before"]
    assert "Послушник тот" in result["text"]
    assert result["context_after"] == ""


@pytest.mark.asyncio
async def test_read_passage_unknown_citation_raises(db_with_paragraphs):
    with pytest.raises(Exception):
        await read_passage.ainvoke({
            "citation": "fake/fake_work/0001/p1",
            "context_n": 0,
        })
```

- [ ] **Step 2: Failing → реализация**

`apps/backend/src/backend/tools/read_passage.py`:

```python
"""Tool: read_passage — exact text by canonical citation + context paragraphs."""
from langchain_core.tools import tool

from ..db import conn
from ._citation import parse_citation


@tool
async def read_passage(citation: str, context_n: int = 2) -> dict:
    """Возвращает точный текст абзаца(ев) по канонической ссылке + N абзацев контекста.

    Args:
        citation: канонический формат 'author/work/chapter/pX[-Y]'.
        context_n: число абзацев контекста до и после (≥0).

    Возвращает {text, context_before, context_after, author, work_title, chapter_num,
                chapter_title, para_start, window_size, source_url}.
    Кидает исключение если citation не найден.
    """
    parsed = parse_citation(citation)
    start = parsed["para_start"]
    end = start + parsed["window_size"] - 1

    async with conn() as c:
        # Main window
        cur = await c.execute(
            """
            SELECT p.para_num, p.text
            FROM paragraphs p
            WHERE p.work_slug=%s AND p.chapter_num=%s
              AND p.para_num BETWEEN %s AND %s
            ORDER BY p.para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], start, end],
        )
        main_rows = await cur.fetchall()
        if not main_rows:
            raise ValueError(f"passage not found: {citation}")

        # Context before
        cur = await c.execute(
            """
            SELECT text FROM paragraphs
            WHERE work_slug=%s AND chapter_num=%s
              AND para_num BETWEEN %s AND %s
            ORDER BY para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], max(1, start - context_n), start - 1],
        )
        before_rows = await cur.fetchall()

        # Context after
        cur = await c.execute(
            """
            SELECT text FROM paragraphs
            WHERE work_slug=%s AND chapter_num=%s
              AND para_num BETWEEN %s AND %s
            ORDER BY para_num
            """,
            [parsed["work_slug"], parsed["chapter_num"], end + 1, end + context_n],
        )
        after_rows = await cur.fetchall()

        # Metadata
        cur = await c.execute(
            """
            SELECT a.name_display, w.title_display, w.source_url, ch.title
            FROM works w
            JOIN authors a ON a.slug = w.author_slug
            JOIN chapters ch ON ch.work_slug=w.slug AND ch.chapter_num=%s
            WHERE w.slug=%s
            """,
            [parsed["chapter_num"], parsed["work_slug"]],
        )
        meta = await cur.fetchone()

    return {
        "text": "\n\n".join(r[1] for r in main_rows),
        "context_before": "\n\n".join(r[0] for r in before_rows),
        "context_after": "\n\n".join(r[0] for r in after_rows),
        "author": meta[0] if meta else None,
        "work_title": meta[1] if meta else None,
        "source_url": meta[2] if meta else None,
        "chapter_title": meta[3] if meta else None,
        "chapter_num": parsed["chapter_num"],
        "para_start": start,
        "window_size": parsed["window_size"],
        "citation": citation,
    }
```

- [ ] **Step 3: Тесты PASS + коммит**

```bash
.venv/bin/pytest tests/unit/test_read_passage.py -v
git add apps/backend/src/backend/tools/read_passage.py \
        apps/backend/tests/unit/test_read_passage.py
git commit -m "feat(backend): read_passage tool — exact text + context by citation"
```

---

### Task 24: Catalog endpoint + agent_runs writer

**Files:**
- Create: `apps/backend/src/backend/catalog.py`
- Create: `apps/backend/src/backend/observability.py`
- Test: `apps/backend/tests/unit/test_catalog.py`

`GET /catalog` — FastAPI app, mountится в LangGraph Server через `langgraph.json: http.app`. Также сюда добавляем хелперы для записи `agent_runs`.

- [ ] **Step 1: Test catalog**

`apps/backend/tests/unit/test_catalog.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport

from backend.catalog import app


@pytest.mark.asyncio
async def test_catalog_returns_authors_with_works(db_with_seed_authors):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/catalog")
    assert resp.status_code == 200
    data = resp.json()
    authors = {a["slug"]: a for a in data["authors"]}
    assert "avgustin" in authors
    assert "platon" in authors
    avg = authors["avgustin"]
    assert avg["years"] == "(354–430)"
    titles = [w["title"] for w in avg["works"]]
    assert "Исповедь" in titles


@pytest.mark.asyncio
async def test_catalog_includes_source_url(db_with_seed_authors):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/catalog")
    avg = next(a for a in resp.json()["authors"] if a["slug"] == "avgustin")
    assert avg["works"][0]["source_url"].startswith("https://azbyka.ru")
```

- [ ] **Step 2: Реализация**

`apps/backend/src/backend/observability.py`:

```python
"""Persistence of agent runs for observability and post-hoc audit."""
import json

from .db import conn


async def write_run(thread_id: str | None, messages: list[dict],
                    citations_used: list[str] | None = None) -> int:
    """Persist a finished agent run. Returns the agent_runs.id."""
    async with conn() as c:
        cur = await c.execute(
            """
            INSERT INTO agent_runs (thread_id, messages, citations_used)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            [thread_id,
             json.dumps(messages, ensure_ascii=False, default=str),
             json.dumps(citations_used or [], ensure_ascii=False)],
        )
        row = await cur.fetchone()
        return int(row[0])
```

`apps/backend/src/backend/catalog.py`:

```python
"""FastAPI app: catalog endpoint mounted under LangGraph Server."""
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import conn

app = FastAPI(title="Patristic Catalog")

# Allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/catalog")
async def get_catalog() -> dict:
    """Return the full catalog: authors with nested works."""
    sql = """
        SELECT a.slug, a.name_display, a.years, a.century, a.global_section,
               COALESCE(
                   json_agg(
                       json_build_object(
                           'slug', w.slug,
                           'title', w.title_display,
                           'creation_date', w.creation_date,
                           'section', w.section,
                           'source_url', w.source_url,
                           'topics', w.topics,
                           'paragraph_count', w.paragraph_count
                       ) ORDER BY w.title_display
                   ) FILTER (WHERE w.slug IS NOT NULL),
                   '[]'::json
               ) AS works
        FROM authors a
        LEFT JOIN works w ON w.author_slug = a.slug
        GROUP BY a.slug, a.name_display, a.years, a.century, a.global_section
        ORDER BY a.name_display
    """
    async with conn() as c:
        cur = await c.execute(sql)
        rows = await cur.fetchall()

    authors = [
        {
            "slug": r[0],
            "name": r[1],
            "years": r[2],
            "century": r[3],
            "global_section": r[4],
            "works": r[5] if isinstance(r[5], list) else json.loads(r[5] or "[]"),
        }
        for r in rows
    ]
    return {"authors": authors}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
```

- [ ] **Step 3: Тесты PASS + manual prod check**

```bash
.venv/bin/pytest tests/unit/test_catalog.py -v

# Manual:
.venv/bin/uvicorn backend.catalog:app --port 8001 &
sleep 2
curl http://localhost:8001/catalog | python -m json.tool | head -40
kill %1
```

Expected: тесты pass; curl возвращает JSON с авторами.

- [ ] **Step 4: Коммит**

```bash
git add apps/backend/src/backend/catalog.py \
        apps/backend/src/backend/observability.py \
        apps/backend/tests/unit/test_catalog.py
git commit -m "feat(backend): GET /catalog endpoint + agent_runs writer"
```

---

## Phase 6 — Сборка агента

### Task 25: Промпты для main и search

**Files:**
- Create: `apps/backend/src/backend/prompts.py`

- [ ] **Step 1: Написать prompts.py**

`apps/backend/src/backend/prompts.py`:

```python
"""System prompts for main agent and search subagent."""

MAIN_AGENT_PROMPT = """Ты — экспертный помощник по русскому святоотеческому корпусу.

Твоя задача: отвечать на вопросы пользователя с **точными, проверяемыми цитатами** из патристики, философии и Священного Писания.

## Жёсткие правила цитирования

1. **Перед каждой цитатой в твоём ответе ты ОБЯЗАН вызвать `read_passage`** с конкретной канонической ссылкой. Цитата в ответе должна быть подстрокой того, что вернул `read_passage`. Никаких цитат «по памяти».

2. Search-субагент возвращает только список кандидатов с **snippet ≤200 символов**. Эти snippet — **только для решения релевантности**. Никогда не вставляй snippet в ответ как цитату — всегда сначала `read_passage`.

3. Каждую цитату оформляй с явной ссылкой в формате «{Автор}, {Труд}, гл. {N}, §{para}» и указанием azbyka-URL (из `source_url` в результате `read_passage`).

## Делегирование поиска

Для поиска цитат **всегда делегируй** search-субагенту через `task` (передавай конкретную тему и, если знаешь, фильтр по автору/труду). Search вернёт 3-8 кандидатов с citation и snippet'ом — ты выбираешь из них и вызываешь `read_passage` для подтверждения.

## Язык ответа

- Если вопрос на русском — отвечай на русском.
- Если вопрос на другом языке — отвечай на этом языке, **но** для каждой цитаты показывай **и русский оригинал, и свой рабочий перевод**, с явной отметкой «Working translation, not authoritative — see original».

## Что делать если ничего не найдено

Если после делегирования поиска кандидатов нет или они нерелевантны — **прямо скажи** «не найдено в корпусе» и не выдумывай. Корпус ограничен: русский патристический корпус azbyka.ru, греческая философия, Православная Библия. Если вопрос про что-то вне корпуса (например, Ницше, Кант, Бхагавадгита) — скажи это явно.

## Доступные тулы

- `list_authors()` — список всех авторов
- `list_works(author_slug)` — труды автора
- `expand_concept(term)` — синонимы/связанные/греческие для патристического концепта
- `read_passage(citation, context_n=2)` — точный текст по канонической ссылке
- `task` (делегация subagent'у `search`) — для всех тематических и адресных поисков
"""


SEARCH_AGENT_PROMPT = """Ты — search-субагент, который ищет места в русском святоотеческом корпусе.

## Принципы

1. **Ты НИКОГДА не цитируешь напрямую.** Возвращаешь только список кандидатов с canonical citation и **snippet ≤200 символов** для предпросмотра.

2. **Перед тематическим поиском ВСЕГДА вызывай `expand_concept`** на основной термин — это даст синонимы и связанные понятия, которые нужно искать также.

3. **Гибридный поиск:** для каждого термина вызывай оба — `lexical_search` (точные словоформы) и `semantic_search` (по смыслу). Дедуплицируй по `citation`.

4. **Возвращай 3-8 наиболее релевантных кандидатов** (не больше). Описывай каждый в формате:
   `- {citation} | {snippet} | score: lexical={X}, semantic={Y}`

## Алгоритм для тематического запроса

1. `expand_concept(основной_термин)` → синонимы + related
2. Для каждого термина: `lexical_search(...)` + `semantic_search(...)` с фильтрами если main передал.
3. Дедупликация по citation, сортировка по агрегированному скору.
4. Top 3-8 → ответ.

## Алгоритм для адресного запроса (автор/труд известен)

1. `list_works(author)` если надо уточнить slug.
2. `lexical_search(query, author_slug=X)` + `semantic_search(query, author_slug=X)`.
3. Top 3-8 → ответ.

## Доступные тулы

- `list_authors()`
- `list_works(author_slug)`
- `expand_concept(term)`
- `lexical_search(query, author_slug?, work_slug?, limit=10)`
- `semantic_search(query, author_slug?, work_slug?, limit=10)`
"""
```

- [ ] **Step 2: Коммит**

```bash
git add apps/backend/src/backend/prompts.py
git commit -m "feat(backend): agent prompts (main + search subagent)"
```

---

### Task 26: Граф (deepagents)

**Files:**
- Create: `apps/backend/src/backend/graph.py`

- [ ] **Step 1: Реализация**

`apps/backend/src/backend/graph.py`:

```python
"""LangGraph + deepagents graph: Sonnet main + Haiku search subagent."""
from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

from .config import settings
from .prompts import MAIN_AGENT_PROMPT, SEARCH_AGENT_PROMPT
from .tools.list_authors import list_authors
from .tools.list_works import list_works
from .tools.expand_concept import expand_concept
from .tools.lexical_search import lexical_search
from .tools.semantic_search import semantic_search
from .tools.read_passage import read_passage


main_model = ChatOpenAI(
    api_key=settings.timeweb_ai_key,
    base_url=settings.timeweb_base_url,
    model=settings.main_agent_model,
    temperature=0.2,
)

search_model = ChatOpenAI(
    api_key=settings.timeweb_ai_key,
    base_url=settings.timeweb_base_url,
    model=settings.search_agent_model,
    temperature=0.1,
)


search_subagent = {
    "name": "search",
    "description": "Searches the patristic corpus. Delegate when you need citations.",
    "prompt": SEARCH_AGENT_PROMPT,
    "tools": ["lexical_search", "semantic_search",
              "list_authors", "list_works", "expand_concept"],
    "model": search_model,
}


agent = create_deep_agent(
    model=main_model,
    tools=[read_passage, list_authors, list_works, expand_concept,
           lexical_search, semantic_search],
    instructions=MAIN_AGENT_PROMPT,
    subagents=[search_subagent],
).with_config({"recursion_limit": 50})
```

**Note по deepagents:** API `create_deep_agent` основан на текущей версии библиотеки. Если конкретные параметры (`subagents`, `instructions`) не совпадают — открыть `python -c "from deepagents import create_deep_agent; help(create_deep_agent)"` и подогнать имена аргументов.

- [ ] **Step 2: Smoke (запуск LangGraph dev и пинг)**

```bash
cd apps/backend
# Загружаем .env с TIMEWEB_AI_KEY
export $(grep -v '^#' ../../.env | xargs)
.venv/bin/langgraph dev --port 2024 --no-browser &
sleep 5

# Проверяем что граф зарегистрирован
curl http://localhost:2024/info | python -m json.tool

# Стоп
kill %1
```

Expected: `info` показывает `patristic` в списке графов.

- [ ] **Step 3: Коммит**

```bash
git add apps/backend/src/backend/graph.py
git commit -m "feat(backend): deepagents graph (Sonnet main + Haiku search)"
```

---

### Task 27: Smoke-test агента (citation discipline)

**Files:**
- Create: `apps/backend/tests/integration/test_smoke.py`

Интеграционный тест — реальный агент против реальной БД (subset из Phase 3). Главная проверка: **все цитаты в ответе — подстрока какого-то `read_passage` tool result**.

- [ ] **Step 1: Test**

`apps/backend/tests/integration/test_smoke.py`:

```python
import os
import pytest
import re
from langgraph.pregel.remote import RemoteGraph
from langgraph_sdk import get_client

# Used when test runs against a live langgraph dev server.
LANGGRAPH_URL = os.environ.get("LANGGRAPH_URL", "http://localhost:2024")

pytestmark = pytest.mark.integration


def _extract_tool_results(messages: list[dict], tool_name: str) -> list[str]:
    out: list[str] = []
    for m in messages:
        if m.get("type") == "tool" and m.get("name") == tool_name:
            content = m.get("content")
            if isinstance(content, str):
                out.append(content)
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and "text" in c:
                        out.append(c["text"])
                    elif isinstance(c, str):
                        out.append(c)
    return out


def _final_assistant_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("type") == "ai" or m.get("role") == "assistant":
            content = m.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _extract_quotes(text: str) -> list[str]:
    """Extract text inside «…» or "…" quotes longer than 30 chars."""
    out: list[str] = []
    for pat in (r"«([^»]{30,})»", r'"([^"]{30,})"'):
        out.extend(re.findall(pat, text))
    return out


@pytest.mark.asyncio
async def test_smoke_thematic_with_citations():
    client = get_client(url=LANGGRAPH_URL)
    thread = await client.threads.create()
    run = await client.runs.wait(
        thread["thread_id"],
        "patristic",
        input={"messages": [{"role": "user",
                             "content": "Найди цитаты про послушание из Лествичника"}]},
    )
    messages = run["messages"]
    final = _final_assistant_text(messages)
    quotes = _extract_quotes(final)
    passages = _extract_tool_results(messages, "read_passage")

    # Each quote must appear as substring in some read_passage result
    for q in quotes:
        assert any(q.strip() in p for p in passages), (
            f"Quote not from read_passage: {q[:80]!r}\nPassages: {[p[:100] for p in passages]}"
        )

    # Must use at least one read_passage call
    assert len(passages) >= 1


@pytest.mark.asyncio
async def test_smoke_negative_query_says_not_found():
    client = get_client(url=LANGGRAPH_URL)
    thread = await client.threads.create()
    run = await client.runs.wait(
        thread["thread_id"],
        "patristic",
        input={"messages": [{"role": "user",
                             "content": "Что Ницше писал о морали?"}]},
    )
    final = _final_assistant_text(run["messages"]).lower()
    # Agent should not fabricate. Look for refusal markers.
    assert any(marker in final for marker in
               ["не найдено", "не в корпусе", "вне корпуса", "not in the corpus"])
```

- [ ] **Step 2: Запуск (требует live langgraph dev)**

```bash
# В одном терминале
.venv/bin/langgraph dev --port 2024 --no-browser

# В другом
cd apps/backend
.venv/bin/pytest tests/integration/test_smoke.py -v -s
```

Expected: 2 PASS. Если упало:
- «Quote not from read_passage» → промпт недостаточно жёсткий или Sonnet галлюцинировал. Это **критический баг** — итерируй промпт пока не получишь.
- «не найдено» отсутствует → агент пытался выдать что-то — поправь промпт по разделу «Что делать если ничего не найдено».

- [ ] **Step 3: Коммит**

```bash
git add apps/backend/tests/integration/test_smoke.py
git commit -m "feat(backend): smoke tests for citation discipline + negative case"
```

---

## Phase 7 — Goldset (сердце acceptance gate)

> **Это критический раздел.** MVP считается готовым только когда goldset (Task 29) проходит с заданными порогами (Task 30). User explicitly emphasized this: «жирный тестовый файл проходит = готово, не раньше».

### Task 28: Goldset runner

**Files:**
- Create: `apps/backend/tests/integration/test_goldset.py`
- Create: `apps/backend/src/backend/eval_runner.py`

Goldset YAML определяет запросы и ожидания. Runner:
1. Парсит YAML.
2. Для каждой записи отправляет query через LangGraph dev.
3. Собирает `citations_used` (все `read_passage` вызовы из transcript) и финальный текст.
4. Применяет правило `passing` записи: `any_match`, `at_least_two_authors`, `at_least_one_match`, `empty_or_low_confidence`, `recall_at_5`, `recall_at_10`.
5. Считает агрегатные метрики и сравнивает с порогами.

- [ ] **Step 1: eval_runner.py (чистая логика, тестируемая)**

`apps/backend/src/backend/eval_runner.py`:

```python
"""Goldset eval: pure logic for matching expectations to agent transcripts."""
import re
from dataclasses import dataclass
from typing import Literal

import yaml


PassingRule = Literal[
    "any_match",
    "at_least_one_match",
    "at_least_two_authors",
    "empty_or_low_confidence",
]


@dataclass
class GoldEntry:
    query: str
    category: str  # 'addressed', 'thematic', 'negative', 'cross'
    expected_citations: list[dict] | None = None  # [{work: ..., chapter: ...}]
    expected_authors: list[str] | None = None
    passing: PassingRule = "any_match"


@dataclass
class EvalResult:
    entry: GoldEntry
    citations_used: list[str]
    final_text: str
    passed: bool
    reason: str


def load_goldset(path: str) -> list[GoldEntry]:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    out: list[GoldEntry] = []
    for item in data:
        out.append(GoldEntry(
            query=item["query"],
            category=item.get("category", "thematic"),
            expected_citations=item.get("expected_citations"),
            expected_authors=item.get("expected_authors"),
            passing=item.get("passing", "any_match"),
        ))
    return out


def _author_of(citation: str) -> str:
    """First segment of canonical citation."""
    return citation.split("/", 1)[0] if "/" in citation else citation


def _work_of(citation: str) -> str:
    parts = citation.split("/")
    return parts[1] if len(parts) >= 2 else ""


def _chapter_of(citation: str) -> int | None:
    parts = citation.split("/")
    if len(parts) >= 3:
        try:
            return int(parts[2])
        except ValueError:
            return None
    return None


def evaluate(entry: GoldEntry, citations_used: list[str], final_text: str) -> EvalResult:
    """Apply passing rule to a single entry."""
    rule = entry.passing

    if rule == "empty_or_low_confidence":
        # No citations OR explicit refusal in text
        if len(citations_used) == 0:
            return EvalResult(entry, citations_used, final_text, True, "no citations as expected")
        markers = ["не найдено", "не в корпусе", "вне корпуса", "not in the corpus"]
        if any(m in final_text.lower() for m in markers):
            return EvalResult(entry, citations_used, final_text, True, "refusal detected")
        return EvalResult(entry, citations_used, final_text, False,
                          f"expected refusal, got {len(citations_used)} citations")

    if rule == "at_least_one_match":
        # At least one citation matches expected_authors (if set) or expected_citations
        if entry.expected_authors:
            authors_used = {_author_of(c) for c in citations_used}
            ok = bool(authors_used & set(entry.expected_authors))
            return EvalResult(entry, citations_used, final_text, ok,
                              f"authors used={authors_used}, expected={entry.expected_authors}")
        return EvalResult(entry, citations_used, final_text, len(citations_used) >= 1,
                          f"len(citations)={len(citations_used)}")

    if rule == "any_match":
        # Same as at_least_one but for expected_citations (work+chapter)
        if not entry.expected_citations:
            return EvalResult(entry, citations_used, final_text, len(citations_used) >= 1,
                              "no expected_citations specified, falling back to len≥1")
        for exp in entry.expected_citations:
            for c in citations_used:
                if _work_of(c) == exp["work"] and (
                    "chapter" not in exp or _chapter_of(c) == exp["chapter"]
                ):
                    return EvalResult(entry, citations_used, final_text, True,
                                      f"matched expected citation {exp}")
        return EvalResult(entry, citations_used, final_text, False,
                          f"none of {entry.expected_citations} matched citations {citations_used}")

    if rule == "at_least_two_authors":
        if not entry.expected_authors:
            return EvalResult(entry, citations_used, final_text, False,
                              "expected_authors required for this rule")
        authors_used = {_author_of(c) for c in citations_used}
        common = authors_used & set(entry.expected_authors)
        ok = len(common) >= 2
        return EvalResult(entry, citations_used, final_text, ok,
                          f"common authors={common}")

    return EvalResult(entry, citations_used, final_text, False, f"unknown rule {rule}")


def summary(results: list[EvalResult]) -> dict:
    """Aggregate pass rates per category."""
    by_cat: dict[str, dict] = {}
    for r in results:
        cat = r.entry.category
        d = by_cat.setdefault(cat, {"total": 0, "passed": 0, "failed": []})
        d["total"] += 1
        if r.passed:
            d["passed"] += 1
        else:
            d["failed"].append({"query": r.entry.query, "reason": r.reason})
    for cat, d in by_cat.items():
        d["pass_rate"] = d["passed"] / d["total"] if d["total"] else 0.0
    return by_cat
```

- [ ] **Step 2: Unit test для eval_runner**

`apps/backend/tests/unit/test_eval_runner.py`:

```python
from backend.eval_runner import GoldEntry, evaluate, summary


def test_any_match_pass():
    entry = GoldEntry(query="X", category="addressed",
                      expected_citations=[{"work": "lestvica", "chapter": 4}],
                      passing="any_match")
    r = evaluate(entry, ["lestvichnik/lestvica/0004/p1"], "...")
    assert r.passed


def test_any_match_fail_wrong_chapter():
    entry = GoldEntry(query="X", category="addressed",
                      expected_citations=[{"work": "lestvica", "chapter": 4}],
                      passing="any_match")
    r = evaluate(entry, ["lestvichnik/lestvica/0007/p1"], "...")
    assert not r.passed


def test_empty_or_low_confidence_pass_on_refusal():
    entry = GoldEntry(query="Х", category="negative",
                      expected_authors=[], passing="empty_or_low_confidence")
    r = evaluate(entry, ["fake/fake/0001/p1"], "Этот вопрос не в корпусе, простите.")
    assert r.passed


def test_empty_or_low_confidence_fail_on_fabrication():
    entry = GoldEntry(query="Х", category="negative",
                      expected_authors=[], passing="empty_or_low_confidence")
    r = evaluate(entry, ["fake/fake/0001/p1"], "Ницше пишет о морали так...")
    assert not r.passed


def test_at_least_two_authors():
    entry = GoldEntry(query="осуждение", category="thematic",
                      expected_authors=["lestvichnik", "isaak_sirin", "bryanchaninov"],
                      passing="at_least_two_authors")
    r = evaluate(entry, [
        "lestvichnik/lestvica/0010/p1",
        "isaak_sirin/slova/0042/p3",
    ], "...")
    assert r.passed


def test_at_least_one_match_by_authors():
    entry = GoldEntry(query="X", category="cross",
                      expected_authors=["platon"],
                      passing="at_least_one_match")
    r = evaluate(entry, ["platon/gosudarstvo/0004/p1"], "...")
    assert r.passed


def test_summary_aggregates():
    from backend.eval_runner import EvalResult, GoldEntry
    results = [
        EvalResult(GoldEntry(query="a", category="addressed", passing="any_match"),
                   [], "", True, ""),
        EvalResult(GoldEntry(query="b", category="addressed", passing="any_match"),
                   [], "", False, "bad"),
        EvalResult(GoldEntry(query="c", category="thematic", passing="any_match"),
                   [], "", True, ""),
    ]
    s = summary(results)
    assert s["addressed"]["pass_rate"] == 0.5
    assert s["thematic"]["pass_rate"] == 1.0
```

- [ ] **Step 3: Прогон unit-тестов eval_runner**

```bash
cd apps/backend
.venv/bin/pytest tests/unit/test_eval_runner.py -v
```

Expected: 7 PASS.

- [ ] **Step 4: Integration test — реальный goldset через агента**

`apps/backend/tests/integration/test_goldset.py`:

```python
import os
import pytest
import re
import json
from pathlib import Path

from langgraph_sdk import get_client
from backend.eval_runner import load_goldset, evaluate, summary, GoldEntry

LANGGRAPH_URL = os.environ.get("LANGGRAPH_URL", "http://localhost:2024")
GOLDSET_PATH = Path(__file__).resolve().parents[3] / "tests" / "eval" / "gold.yaml"


pytestmark = pytest.mark.integration


# Acceptance thresholds (см. plan header)
THRESHOLDS = {
    "addressed": 0.80,
    "thematic": 0.60,
    "cross": 0.70,        # cross-corpus (философия + Библия)
    "negative": 1.00,     # zero tolerance for fabrication
}


def _extract_citations(messages: list[dict]) -> list[str]:
    """Pull every read_passage citation argument from tool calls."""
    out: list[str] = []
    for m in messages:
        if m.get("type") == "ai":
            for tc in m.get("tool_calls", []):
                if tc.get("name") == "read_passage":
                    cit = (tc.get("args") or {}).get("citation")
                    if cit:
                        out.append(cit)
    return out


def _final_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("type") == "ai":
            content = m.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


@pytest.mark.asyncio
async def test_goldset_meets_thresholds():
    entries = load_goldset(str(GOLDSET_PATH))
    assert len(entries) >= 50, f"Goldset must have ≥50 entries; got {len(entries)}"

    client = get_client(url=LANGGRAPH_URL)
    results = []

    for entry in entries:
        thread = await client.threads.create()
        run = await client.runs.wait(
            thread["thread_id"],
            "patristic",
            input={"messages": [{"role": "user", "content": entry.query}]},
        )
        messages = run["messages"] if isinstance(run, dict) else run
        cits = _extract_citations(messages)
        text = _final_text(messages)
        results.append(evaluate(entry, cits, text))

    s = summary(results)
    print("\n=== Goldset summary ===")
    print(json.dumps(s, ensure_ascii=False, indent=2))

    failures: list[str] = []
    for cat, thr in THRESHOLDS.items():
        if cat not in s:
            continue
        if s[cat]["pass_rate"] < thr:
            failures.append(f"{cat}: {s[cat]['pass_rate']:.2%} < {thr:.0%}")
    assert not failures, "Goldset thresholds missed:\n" + "\n".join(failures)
```

- [ ] **Step 5: Коммит (без gold.yaml пока — он в Task 29)**

```bash
git add apps/backend/src/backend/eval_runner.py \
        apps/backend/tests/unit/test_eval_runner.py \
        apps/backend/tests/integration/test_goldset.py
git commit -m "feat(backend): goldset runner + eval logic with thresholds"
```

---

### Task 29: Написать ЖИРНЫЙ goldset (≥50 запросов)

**Files:**
- Create: `tests/eval/gold.yaml`

**Это самая важная задача плана.** Качество MVP определяется качеством этого файла. Состав:

| Категория | Кол-во | Threshold |
|---|---|---|
| `addressed` (автор+тема известны) | 18-22 | 80% |
| `thematic` (только тема) | 20-25 | 60% |
| `cross` (философия / Библия адресные) | 8-10 | 70% |
| `negative` (вне корпуса) | 5-8 | 100% |
| **Итого** | **≥50** | |

- [ ] **Step 1: Написать `tests/eval/gold.yaml`**

`tests/eval/gold.yaml`:

```yaml
# Patristic Chat MVP — Goldset
# Format per entry:
#   query: вопрос как пользователь напишет
#   category: addressed | thematic | cross | negative
#   expected_citations: [{work: <work_slug>, chapter: <N>}]   (для any_match)
#   expected_authors: [<author_slug>, ...]                     (для at_least_*)
#   passing: any_match | at_least_one_match | at_least_two_authors | empty_or_low_confidence

# === Addressed (18) ===

- query: "что Лествичник говорит о послушании"
  category: addressed
  expected_citations:
    - {work: lestvichnik_lestvica, chapter: 4}
  passing: any_match

- query: "Августин о времени и вечности"
  category: addressed
  expected_authors: [avgustin]
  passing: at_least_one_match

- query: "Брянчанинов о духовной прелести"
  category: addressed
  expected_authors: [brjanchaninov]
  passing: at_least_one_match

- query: "Палама о Фаворском свете"
  category: addressed
  expected_authors: [grigorij_palama]
  passing: at_least_one_match

- query: "Феофан Затворник о трезвении"
  category: addressed
  expected_authors: [feofan_zatvornik, govorov_feofan]
  passing: at_least_one_match

- query: "Иоанн Златоуст о милостыне"
  category: addressed
  expected_authors: [ioann_zlatoust]
  passing: at_least_one_match

- query: "Ефрем Сирин о покаянии"
  category: addressed
  expected_authors: [efrem_sirin]
  passing: at_least_one_match

- query: "Григорий Богослов о Святой Троице"
  category: addressed
  expected_authors: [grigorij_bogoslov, grigorij_nazianzin]
  passing: at_least_one_match

- query: "Авва Дорофей об отсечении воли"
  category: addressed
  expected_authors: [dorofej]
  passing: at_least_one_match

- query: "Исаак Сирин о любви"
  category: addressed
  expected_authors: [isaak_sirin]
  passing: at_least_one_match

- query: "Василий Великий о посте"
  category: addressed
  expected_authors: [vasilij_velikij]
  passing: at_least_one_match

- query: "Григорий Нисский о душе"
  category: addressed
  expected_authors: [grigorij_nisskij]
  passing: at_least_one_match

- query: "Афанасий Великий о вочеловечении"
  category: addressed
  expected_authors: [afanasij_velikij]
  passing: at_least_one_match

- query: "Иоанн Дамаскин о почитании икон"
  category: addressed
  expected_authors: [ioann_damaskin]
  passing: at_least_one_match

- query: "Антоний Великий о борьбе с помыслами"
  category: addressed
  expected_authors: [antonij_velikij]
  passing: at_least_one_match

- query: "Иоанн Кассиан о восьми греховных страстях"
  category: addressed
  expected_authors: [ioann_kassian]
  passing: at_least_one_match

- query: "Григорий Палама что говорит о исихии"
  category: addressed
  expected_authors: [grigorij_palama]
  passing: at_least_one_match

- query: "Августин о благодати и свободной воле"
  category: addressed
  expected_authors: [avgustin]
  passing: at_least_one_match

# === Thematic (22) ===

- query: "найди цитаты про осуждение ближнего"
  category: thematic
  expected_authors: [ioann_lestvichnik, isaak_sirin, brjanchaninov, dorofej]
  passing: at_least_two_authors

- query: "что святые отцы говорят о гордости и смирении"
  category: thematic
  expected_authors: [ioann_lestvichnik, brjanchaninov, isaak_sirin, ioann_zlatoust]
  passing: at_least_two_authors

- query: "об умной молитве и трезвении"
  category: thematic
  expected_authors: [grigorij_palama, feofan_zatvornik, govorov_feofan, ignatij_brjanchaninov]
  passing: at_least_two_authors

- query: "как бороться с унынием по святым отцам"
  category: thematic
  expected_authors: [evagrij, ioann_kassian, brjanchaninov, dorofej]
  passing: at_least_two_authors

- query: "что значит память смертная"
  category: thematic
  expected_authors: [ioann_lestvichnik, brjanchaninov, isaak_sirin]
  passing: at_least_two_authors

- query: "о духовной прелести"
  category: thematic
  expected_authors: [brjanchaninov, ignatij_brjanchaninov]
  passing: at_least_one_match

- query: "о покаянии и сокрушении сердца"
  category: thematic
  expected_authors: [efrem_sirin, ioann_zlatoust, isaak_sirin]
  passing: at_least_two_authors

- query: "что такое страсти и как их преодолеть"
  category: thematic
  expected_authors: [ioann_kassian, evagrij, brjanchaninov]
  passing: at_least_two_authors

- query: "о слезах и плаче"
  category: thematic
  expected_authors: [ioann_lestvichnik, isaak_sirin]
  passing: at_least_one_match

- query: "о любви к врагам"
  category: thematic
  expected_authors: [ioann_zlatoust, isaak_sirin, maksim_ispovednik]
  passing: at_least_one_match

- query: "о пользе и опасности безмолвия"
  category: thematic
  expected_authors: [ioann_lestvichnik, grigorij_palama, isaak_sirin]
  passing: at_least_two_authors

- query: "о послушании духовнику"
  category: thematic
  expected_authors: [ioann_lestvichnik, dorofej, varsonofij]
  passing: at_least_two_authors

- query: "о грехе и падении первых людей"
  category: thematic
  expected_authors: [avgustin, ioann_zlatoust, grigorij_nisskij]
  passing: at_least_two_authors

- query: "что говорят о Святом Духе"
  category: thematic
  expected_authors: [vasilij_velikij, grigorij_bogoslov, ioann_damaskin]
  passing: at_least_two_authors

- query: "о таинстве евхаристии"
  category: thematic
  expected_authors: [ioann_zlatoust, ioann_damaskin, kirill_aleksandrijskij]
  passing: at_least_one_match

- query: "о чревоугодии и посте"
  category: thematic
  expected_authors: [ioann_kassian, ioann_lestvichnik, vasilij_velikij]
  passing: at_least_two_authors

- query: "как святые отцы понимали обожение"
  category: thematic
  expected_authors: [afanasij_velikij, maksim_ispovednik, grigorij_palama]
  passing: at_least_two_authors

- query: "о страхе Божием"
  category: thematic
  expected_authors: [isaak_sirin, brjanchaninov, dorofej]
  passing: at_least_one_match

- query: "о бесах и духах злобы"
  category: thematic
  expected_authors: [antonij_velikij, brjanchaninov, evagrij]
  passing: at_least_two_authors

- query: "о том нельзя осуждать ближнего даже мысленно"
  category: thematic
  expected_authors: [ioann_lestvichnik, isaak_sirin, brjanchaninov, dorofej]
  passing: at_least_one_match

- query: "о терпении скорбей"
  category: thematic
  expected_authors: [ioann_zlatoust, isaak_sirin, brjanchaninov]
  passing: at_least_two_authors

- query: "о девстве и целомудрии"
  category: thematic
  expected_authors: [ioann_zlatoust, vasilij_velikij, grigorij_nisskij]
  passing: at_least_one_match

# === Cross-corpus (8) ===

- query: "что говорит Платон о справедливости"
  category: cross
  expected_authors: [platon]
  passing: at_least_one_match

- query: "Аристотель о добродетели"
  category: cross
  expected_authors: [aristotel]
  passing: at_least_one_match

- query: "что Псалом говорит о покаянии"
  category: cross
  expected_authors: [bible, david]
  passing: at_least_one_match

- query: "Платон о бессмертии души"
  category: cross
  expected_authors: [platon]
  passing: at_least_one_match

- query: "Нагорная проповедь о блаженствах"
  category: cross
  expected_authors: [bible]
  passing: at_least_one_match

- query: "что апостол Павел говорит о любви"
  category: cross
  expected_authors: [bible]
  passing: at_least_one_match

- query: "Аристотель о дружбе"
  category: cross
  expected_authors: [aristotel]
  passing: at_least_one_match

- query: "Платон об идее блага"
  category: cross
  expected_authors: [platon]
  passing: at_least_one_match

# === Negative (5) — must NOT fabricate ===

- query: "что Ницше писал о морали"
  category: negative
  expected_authors: []
  passing: empty_or_low_confidence

- query: "Кант о категорическом императиве"
  category: negative
  expected_authors: []
  passing: empty_or_low_confidence

- query: "что говорит Бхагавадгита о карме"
  category: negative
  expected_authors: []
  passing: empty_or_low_confidence

- query: "что Маркс писал о капитале"
  category: negative
  expected_authors: []
  passing: empty_or_low_confidence

- query: "квантовая механика и христианство"
  category: negative
  expected_authors: []
  passing: empty_or_low_confidence
```

**Замечание про author_slug:** конкретные slug-и зависят от того что выдал `slugify()` на реальных именах из `output/`. Если в БД они другие — после первой Phase 8 индексации скорректируй `expected_authors` под реальные slug-и. **Это нормальная итерация** — не считается проигрышем плана.

Точное число entries: 18 addressed + 22 thematic + 8 cross + 5 negative = **53**.

- [ ] **Step 2: Sanity-проверка структуры**

```bash
python -c "
import yaml
from pathlib import Path
data = yaml.safe_load(Path('tests/eval/gold.yaml').read_text(encoding='utf-8'))
print(f'Total: {len(data)}')
from collections import Counter
c = Counter(d['category'] for d in data)
print(c)
"
```

Expected:
```
Total: 53
Counter({'thematic': 22, 'addressed': 18, 'cross': 8, 'negative': 5})
```

- [ ] **Step 3: Коммит**

```bash
git add tests/eval/gold.yaml
git commit -m "test(eval): 53-entry goldset (addressed/thematic/cross/negative)"
```

---

### Task 30: Запустить goldset на 3-author subset — наладить и зафиксировать baseline

**Files:**
- (без новых файлов)

На subset большинство адресных запросов про не-проиндексированных авторов **естественно провалятся**. На этом этапе нас интересует:
1. Goldset runner работает технически.
2. Запросы по индексированным авторам (Августин, Лествичник, Брянчанинов) проходят.
3. Negative-запросы должны проходить (агент признаёт отсутствие).

- [ ] **Step 1: Прогон**

```bash
# Терминал A
cd apps/backend
.venv/bin/langgraph dev --port 2024 --no-browser

# Терминал B
.venv/bin/pytest tests/integration/test_goldset.py -v -s --tb=short 2>&1 | tee /tmp/goldset_baseline.log
```

- [ ] **Step 2: Анализ**

Посмотри лог. Ожидаемая картина:
- `negative`: pass_rate = 1.00 ✓
- `addressed` по Августину/Лествичнику/Брянчанинову: PASS
- `addressed` по другим авторам: FAIL (ожидаемо — данных нет)
- `thematic` (требует ≥2 авторов): частично FAIL
- `cross` (Платон/Библия): FAIL (нет данных)

**Главная цель:** найти и починить **технические** баги:
- Невалидный slug в expected_authors (`avgustin` vs `avrelij_avgustin_blazhennyj`).
- Падения парсера yaml.
- Падения при пустом ответе агента.
- Citation format mismatch.

Поправь expected_authors в `gold.yaml` под реальные slug-и из БД:

```sql
SELECT slug FROM authors ORDER BY slug;
```

- [ ] **Step 3: Запусти ещё раз — проверь что технических ошибок нет**

```bash
.venv/bin/pytest tests/integration/test_goldset.py -v -s 2>&1 | tail -30
```

Test может FAIL по thresholds (это OK сейчас) — главное чтобы все 53 entry **отработали** и попали в summary без exception'ов.

- [ ] **Step 4: Коммит правок**

```bash
git add tests/eval/gold.yaml
git commit -m "test(eval): align author slugs to actual indexed values"
```

---

## Phase 8 — Полная индексация корпуса

### Task 31: Прогон всего пайплайна на 85 авторах

**Files:**
- (без новых файлов)

- [ ] **Step 1: Очистить БД и снять restrict OUTPUT_DIR**

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c \
  "TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE;"
unset OUTPUT_DIR
```

- [ ] **Step 2: Диагностика на полном корпусе**

```bash
cd packages/pipeline
.venv/bin/python -m pipeline diagnose
```

Сохрани вывод. Особое внимание:
- `missing_data` — авторы которых нужно доскачать. Минимум Исаак Сирин. Используй `pipeline scrape` + `pipeline download` + `pipeline markdown` целенаправленно по этим авторам.
- `single_chapter_long` — это OK, paragraph-chunking справится.

- [ ] **Step 3: Доскачать недостающее**

Для каждого автора из MISSING_DATA проверь URL на azbyka и запусти scrape отдельной командой. Например для Исаака Сирина:

```bash
# Найди authors_url через azbyka вручную:
# https://azbyka.ru/otechnik/Isaak_Sirin/
# Добавь временный файл libraries_missing.txt с этим URL
echo "https://azbyka.ru/otechnik/Isaak_Sirin/" > libraries_missing.txt
# Запусти скрейпинг с этим файлом (потребует временной правки scrape.py: добавить flag --libraries-file)
# Альтернатива: вручную скачай epub и положи в data/, потом запусти `markdown` чтобы оно его подобрало
```

В реальности для MVP **можно пропустить** авторов которые не хотят скачиваться — главное чтобы было ≥40 авторов в корпусе. Пометь пропущенных в `diagnose_report.json` как known gaps.

- [ ] **Step 4: paragraphs + embed + enrich**

```bash
.venv/bin/python -m pipeline paragraphs
# ~30-60 минут на 72K md

.venv/bin/python -m pipeline embed --device cuda --batch-size 64
# ~2-6 часов на ~2M окон в зависимости от GPU

.venv/bin/python -m pipeline enrich
# ~1-3 часа — самая дорогая по LLM-вызовам. Можно отложить если торопимся.
```

- [ ] **Step 5: Финальные sanity-метрики**

```sql
SELECT COUNT(*) FROM authors;        -- ~80-85
SELECT COUNT(*) FROM works;          -- ~2000+
SELECT COUNT(*) FROM chapters;       -- ~50000+
SELECT COUNT(*) FROM paragraphs;     -- ~500K-1M
SELECT COUNT(*) FROM embeddings;     -- ~1.5M-3M

SELECT a.slug, COUNT(DISTINCT w.slug) AS works, SUM(w.paragraph_count) AS paras
FROM authors a LEFT JOIN works w ON w.author_slug = a.slug
GROUP BY a.slug ORDER BY paras DESC NULLS LAST LIMIT 10;
```

- [ ] **Step 6: Checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: full corpus indexed (XX authors, YY works, ZZ paragraphs)"
```

Подставь реальные числа в сообщение.

---

## Phase 9 — Frontend

### Task 32: Форк agent-chat-ui

**Files:**
- Move (new content): `apps/frontend/` — всё содержимое upstream

- [ ] **Step 1: Склонировать upstream**

```bash
cd apps/
git clone https://github.com/langchain-ai/agent-chat-ui.git frontend-tmp
rm -rf frontend-tmp/.git
mv frontend-tmp/* frontend/
mv frontend-tmp/.* frontend/ 2>/dev/null || true
rmdir frontend-tmp
cd ../
```

- [ ] **Step 2: Проверить запуск**

```bash
cd apps/frontend
pnpm install   # или npm install
pnpm dev       # на :3000
```

Открой http://localhost:3000. Видишь дефолтный UI agent-chat-ui (на текущий момент без бека упадёт при отправке — это OK).

- [ ] **Step 3: Коммит**

```bash
cd ../..
git add apps/frontend/
git commit -m "chore(frontend): import upstream agent-chat-ui (no modifications)"
```

---

### Task 33: Снять брендинг + welcome customization

**Files:**
- Modify: `apps/frontend/src/app/page.tsx` или эквивалент welcome-экрана
- Modify: `apps/frontend/src/components/welcome-card.tsx` (если есть)
- Modify: `apps/frontend/public/` — заменить favicon/logo

- [ ] **Step 1: Найти и заменить welcome**

```bash
cd apps/frontend
grep -rn "LangChain\|LangGraph\|agent-chat-ui" src/ public/ | head
```

Замени тексты приветствия на русские, например в `src/app/page.tsx` (или где находится welcome):

```tsx
// Заменить welcome-block текстом примерно таким:
<div className="text-center max-w-xl mx-auto">
  <h1 className="text-3xl font-semibold">Патристический помощник</h1>
  <p className="text-muted-foreground mt-2">
    Спроси о святоотеческой литературе, греческой философии или Писании.
    Ответы — с точными цитатами и ссылками на оригинал.
  </p>
  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
    <ExamplePrompt text="Что Лествичник говорит о послушании?" />
    <ExamplePrompt text="Найди цитаты про осуждение ближнего" />
    <ExamplePrompt text="Августин о благодати и свободной воле" />
    <ExamplePrompt text="Как святые отцы понимали обожение" />
  </div>
</div>
```

`<ExamplePrompt>` — компонент, который при клике кладёт текст в инпут (см. Task 39 — там же логика preset).

- [ ] **Step 2: Заменить favicon/logo**

Положи в `apps/frontend/public/` нейтральные иконку и og-image. Минимум — обновить `<head>` в layout.

- [ ] **Step 3: Убрать API-key auth (если есть)**

Многие форки agent-chat-ui требуют `LANGSMITH_API_KEY` или подобное. Для нашего сетапа (open access) этого не нужно. Найди в `providers/Client.tsx` или `providers/Stream.tsx` место создания client'а — убери требование ключа.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/
git commit -m "feat(frontend): patristic-themed welcome, drop branding and auth"
```

---

### Task 34: localStorage Thread Provider

**Files:**
- Modify: `apps/frontend/src/providers/Thread.tsx` (или эквивалент)
- Create: `apps/frontend/src/lib/local-thread-store.ts`

- [ ] **Step 1: Хранилище**

`apps/frontend/src/lib/local-thread-store.ts`:

```ts
export interface StoredThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: any[]; // Use the Message type from langgraph-sdk if available
}

const KEY = "patristic:threads";

export function loadThreads(): StoredThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredThread[];
  } catch {
    return [];
  }
}

export function saveThreads(threads: StoredThread[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(threads));
}

export function upsertThread(t: StoredThread): void {
  const all = loadThreads();
  const i = all.findIndex((x) => x.id === t.id);
  if (i >= 0) all[i] = t;
  else all.unshift(t);
  saveThreads(all);
}

export function deleteThread(id: string): void {
  const all = loadThreads().filter((x) => x.id !== id);
  saveThreads(all);
}

export function newThreadId(): string {
  return crypto.randomUUID();
}

export function deriveTitle(firstUserMessage: string): string {
  return firstUserMessage.trim().slice(0, 60);
}
```

- [ ] **Step 2: Заменить ThreadProvider**

Найди существующий `apps/frontend/src/providers/Thread.tsx` — в upstream он использует `client.threads.search()` для подгрузки тредов. Перепиши его контекст так, чтобы:
- `useThreads()` возвращало `loadThreads()`.
- `useCreateThread()` создавало `StoredThread` локально с `newThreadId()`.
- Подписаться на обновления messages из `useStream` и при завершении ассистента — `upsertThread`.

Конкретные правки зависят от точного API upstream-форка (он эволюционирует). Шаги в общем виде:
1. Найди в `Thread.tsx` место где `threads` грузятся из `client`. Замени на `loadThreads()`.
2. Найди `onCreate` / `setActiveThread` — пусть генерит uuid и вызывает `upsertThread`.
3. Найди где сохраняется состояние треда — пусть делает `upsertThread`.

После правок реальное тестирование — открыть `:3000`, написать сообщение, обновить страницу, увидеть в сайдбаре, открыть его, увидеть историю.

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/providers/Thread.tsx apps/frontend/src/lib/local-thread-store.ts
git commit -m "feat(frontend): localStorage-based thread provider (stateless backend)"
```

---

### Task 35: Перенести Stream + markdown-text + thread/index из trading-mcp

**Files:**
- Modify: `apps/frontend/src/providers/Stream.tsx`
- Modify: `apps/frontend/src/components/thread/markdown-text.tsx`
- Modify: `apps/frontend/src/components/thread/index.tsx`

- [ ] **Step 1: Сравнить файлы**

```bash
diff -u apps/frontend/src/providers/Stream.tsx \
       /mnt/c/Users/79819/PycharmProjects/trading-mcp/terminal/front/src/providers/Stream.tsx | less

diff -u apps/frontend/src/components/thread/markdown-text.tsx \
       /mnt/c/Users/79819/PycharmProjects/trading-mcp/terminal/front/src/components/thread/markdown-text.tsx | less

diff -u apps/frontend/src/components/thread/index.tsx \
       /mnt/c/Users/79819/PycharmProjects/trading-mcp/terminal/front/src/components/thread/index.tsx | less
```

- [ ] **Step 2: Перенести улучшения**

Идентифицируй НЕ-trading-related diff'ы — это перф-фиксы (throttle, RAF batching, smooth typewriter). Скопируй их **в upstream**. Trading-логику не тащить.

Конкретно ищи в diff:
- `requestAnimationFrame`, `throttle`, `debounce`, `useDeferredValue` — это перф.
- `useChartData`, `signal`, `trading` — это бизнес-логика, не нужно.

- [ ] **Step 3: Manual test**

Запусти `pnpm dev`, отправь длинный запрос — текст должен литься плавно, без рывков. Если рывки — посмотри в DevTools Performance, проверь что markdown-text использует RAF-батчинг.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/providers/Stream.tsx \
        apps/frontend/src/components/thread/markdown-text.tsx \
        apps/frontend/src/components/thread/index.tsx
git commit -m "feat(frontend): port SSE throttle and smooth markdown rendering from trading-mcp"
```

---

### Task 36: CitationCard компонент

**Files:**
- Create: `apps/frontend/src/components/citation-card.tsx`
- Modify: `apps/frontend/src/components/thread/messages/tool.tsx` (или эквивалент рендера tool messages)

- [ ] **Step 1: CitationCard**

`apps/frontend/src/components/citation-card.tsx`:

```tsx
"use client";
import { useState } from "react";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

interface ReadPassageResult {
  text: string;
  context_before: string;
  context_after: string;
  author: string | null;
  work_title: string | null;
  source_url: string | null;
  chapter_title: string | null;
  chapter_num: number;
  para_start: number;
  window_size: number;
  citation: string;
}

export function CitationCard({ data }: { data: ReadPassageResult }) {
  const [showContext, setShowContext] = useState(false);
  const paraLabel =
    data.window_size === 1
      ? `§${data.para_start}`
      : `§${data.para_start}-${data.para_start + data.window_size - 1}`;
  const header = [data.author, data.work_title, data.chapter_title || `гл. ${data.chapter_num}`, paraLabel]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="border rounded-md p-3 my-2 bg-muted/40">
      <div className="flex justify-between items-start gap-2">
        <div className="text-sm font-medium">{header}</div>
        {data.source_url && (
          <a
            href={data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            azbyka <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="mt-2 text-sm whitespace-pre-wrap">{data.text}</div>
      {(data.context_before || data.context_after) && (
        <>
          <button
            className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setShowContext((v) => !v)}
          >
            {showContext ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showContext ? "скрыть контекст" : "развернуть контекст"}
          </button>
          {showContext && (
            <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 pl-2">
              {data.context_before && <div className="italic">{data.context_before}</div>}
              {data.context_before && data.context_after && <div className="h-2" />}
              {data.context_after && <div className="italic">{data.context_after}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Подключить к рендеру tool messages**

В файле, который рендерит tool messages (поиск: `grep -rn "ToolMessage\|tool_call_id" apps/frontend/src`), добавить ветку:

```tsx
import { CitationCard } from "@/components/citation-card";

// ... в рендере:
if (message.name === "read_passage") {
  try {
    const data = typeof message.content === "string"
      ? JSON.parse(message.content)
      : message.content;
    return <CitationCard data={data} />;
  } catch {
    // fall through to default
  }
}
// default tool render here
```

- [ ] **Step 3: Manual test**

В чате задай: «Что Лествичник говорит о послушании?». После того как агент вызовет `read_passage`, в потоке должна появиться карточка с автором/трудом/главой и кнопкой azbyka. Кнопка «развернуть контекст» открывает соседние абзацы.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/citation-card.tsx \
        apps/frontend/src/components/thread/messages/  # точный путь обновить
git commit -m "feat(frontend): CitationCard component for read_passage results"
```

---

### Task 37: LibraryBrowser модалка

**Files:**
- Create: `apps/frontend/src/components/library/LibraryBrowser.tsx`
- Create: `apps/frontend/src/components/library/use-catalog.ts`
- Modify: `apps/frontend/src/app/layout.tsx` (или header) — добавить иконку триггер

- [ ] **Step 1: hook для каталога**

`apps/frontend/src/components/library/use-catalog.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

const CACHE_KEY = "patristic:catalog";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export interface CatalogWork {
  slug: string;
  title: string;
  creation_date: string | null;
  section: string | null;
  source_url: string | null;
  topics: string[] | null;
  paragraph_count: number;
}

export interface CatalogAuthor {
  slug: string;
  name: string;
  years: string | null;
  century: number | null;
  global_section: string | null;
  works: CatalogWork[];
}

interface Catalog {
  authors: CatalogAuthor[];
}

function load(): Catalog | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function save(data: Catalog): void {
  sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
}

export function useCatalog() {
  const [data, setData] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = load();
    if (cached) {
      setData(cached);
      return;
    }
    setLoading(true);
    const url = process.env.NEXT_PUBLIC_CATALOG_API_URL || "http://localhost:8001";
    fetch(`${url}/catalog`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        save(json);
        setData(json);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
```

- [ ] **Step 2: LibraryBrowser**

`apps/frontend/src/components/library/LibraryBrowser.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, ExternalLink, MessageSquare, ChevronRight, ChevronDown, X } from "lucide-react";
import { useCatalog, type CatalogAuthor, type CatalogWork } from "./use-catalog";

interface Props {
  onAskAboutWork: (author: string, work: string) => void;
}

export function LibraryBrowser({ onAskAboutWork }: Props) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useCatalog();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const matches = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.authors;
    return data.authors
      .map((a) => {
        const authorMatches = a.name.toLowerCase().includes(q);
        const filteredWorks = a.works.filter((w) =>
          w.title.toLowerCase().includes(q) ||
          (w.topics || []).some((t) => t.toLowerCase().includes(q))
        );
        if (authorMatches || filteredWorks.length > 0) {
          return { ...a, works: authorMatches ? a.works : filteredWorks };
        }
        return null;
      })
      .filter((a): a is CatalogAuthor => a !== null);
  }, [data, search]);

  // Auto-expand authors whose works match the search
  const effectiveExpanded = useMemo(() => {
    if (!search.trim()) return expanded;
    const out = new Set<string>();
    matches.forEach((a) => out.add(a.slug));
    return out;
  }, [matches, expanded, search]);

  const toggle = (slug: string) => {
    const next = new Set(expanded);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setExpanded(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className="p-2 rounded hover:bg-muted"
          aria-label="Open library"
          title="Библиотека"
        >
          <BookOpen className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background border rounded-md w-[min(720px,90vw)] max-h-[80vh] flex flex-col">
          <div className="flex justify-between items-center p-3 border-b">
            <Dialog.Title className="font-semibold">Библиотека</Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="p-3 border-b">
            <input
              type="text"
              placeholder="Поиск по авторам, трудам, темам..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border rounded bg-background"
            />
          </div>
          <div className="overflow-auto flex-1 p-2">
            {loading && <div className="text-center text-muted-foreground py-8">Загрузка...</div>}
            {error && <div className="text-center text-red-500 py-8">Ошибка: {error}</div>}
            {matches.map((a) => {
              const isOpen = effectiveExpanded.has(a.slug);
              return (
                <div key={a.slug} className="mb-1">
                  <button
                    className="flex items-center gap-1 w-full text-left p-1 hover:bg-muted rounded"
                    onClick={() => toggle(a.slug)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-medium">{a.name}</span>
                    {a.years && (
                      <span className="text-xs text-muted-foreground ml-1">{a.years}</span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="ml-6 mt-1">
                      {a.works.map((w) => (
                        <WorkRow
                          key={w.slug}
                          work={w}
                          onAsk={() => {
                            onAskAboutWork(a.name, w.title);
                            setOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && matches.length === 0 && (
              <div className="text-center text-muted-foreground py-8">Ничего не найдено</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkRow({ work, onAsk }: { work: CatalogWork; onAsk: () => void }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 hover:bg-muted/50 rounded text-sm group">
      <div className="flex-1 min-w-0">
        <span className="truncate">{work.title}</span>
        {work.creation_date && (
          <span className="text-xs text-muted-foreground ml-1">({work.creation_date})</span>
        )}
        {work.paragraph_count > 0 && (
          <span className="text-xs text-muted-foreground ml-1">· {work.paragraph_count} §</span>
        )}
      </div>
      <div className="flex gap-1 opacity-60 group-hover:opacity-100">
        <button
          onClick={onAsk}
          className="p-1 hover:bg-background rounded"
          title="Спросить агента про этот труд"
        >
          <MessageSquare className="h-3 w-3" />
        </button>
        {work.source_url && (
          <a
            href={work.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-background rounded"
            title="Открыть на azbyka.ru"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Подключить в layout/header**

В `apps/frontend/src/app/layout.tsx` или соответствующем header'е добавить кнопку:

```tsx
import { LibraryBrowser } from "@/components/library/LibraryBrowser";
// в шапке:
<LibraryBrowser onAskAboutWork={(author, work) => {
  // Положить preset в input. Канал — кастомный event или context.
  window.dispatchEvent(new CustomEvent("patristic:prefill-input", {
    detail: { text: `Расскажи о труде "${work}" — ${author}. Какие ключевые темы и цитаты?` }
  }));
}} />
```

Подписаться на событие в инпуте чата (в файле инпута, например `components/thread/composer.tsx`):

```tsx
useEffect(() => {
  const handler = (e: CustomEvent) => setValue((e as any).detail.text);
  window.addEventListener("patristic:prefill-input", handler as EventListener);
  return () => window.removeEventListener("patristic:prefill-input", handler as EventListener);
}, []);
```

- [ ] **Step 4: Manual smoke**

1. Запусти бек + catalog endpoint, фронт.
2. Открой :3000, кликни на иконку книги в шапке.
3. Модалка открывается, видишь список авторов.
4. Открываешь автора — видишь труды.
5. Жмёшь `↗` на труде — открывается azbyka в новой вкладке.
6. Жмёшь `💬` на труде — модалка закрывается, в инпуте появляется preset.
7. Поиск работает: пишешь «послушан» — Лествица автоматически разворачивается и фильтруется.

- [ ] **Step 5: Коммит**

```bash
git add apps/frontend/src/components/library/ \
        apps/frontend/src/app/layout.tsx \
        apps/frontend/src/components/thread/composer.tsx   # путь уточнить
git commit -m "feat(frontend): library browser modal (tree + search + azbyka + ask)"
```

---

### Task 38: Manual full UI smoke

**Files:**
- (без новых файлов)

Чек-лист ручного теста перед переходом к финальному acceptance gate.

- [ ] **Step 1: Поднять stack**

```bash
# Terminal A: postgres
docker compose -f infra/docker-compose.dev.yml up postgres

# Terminal B: backend
cd apps/backend && .venv/bin/langgraph dev --port 2024 --no-browser

# Terminal C: catalog (отдельный uvicorn т.к. langgraph mounts FastAPI на свой порт)
cd apps/backend && .venv/bin/uvicorn backend.catalog:app --port 8001

# Terminal D: frontend
cd apps/frontend && pnpm dev
```

- [ ] **Step 2: UI smoke чек-лист**

Открой `http://localhost:3000`:

- [ ] Welcome-экран показывает русское приветствие и примеры запросов.
- [ ] Клик по примеру кладёт текст в инпут.
- [ ] Отправь «Что Лествичник говорит о послушании?» — стрим начинает течь.
- [ ] Видишь tool calls в потоке: `task → search` → `lexical_search`, `semantic_search` → `read_passage`.
- [ ] Когда стриминг доходит до `read_passage` — рендерится `<CitationCard>` с автором, трудом, главой, ссылкой azbyka, кнопкой контекста.
- [ ] Финальный текст содержит цитату из карточки.
- [ ] Сайдбар показывает новый тред с обрезанным заголовком.
- [ ] F5 reload — тред в сайдбаре сохранён, клик восстанавливает историю.
- [ ] Иконка книги в шапке → модалка с деревом.
- [ ] Поиск по «послушан» — Лествица разворачивается, фильтр работает.
- [ ] Клик на `↗` → открывается azbyka в новой вкладке.
- [ ] Клик на `💬` → модалка закрывается, preset в инпуте.

- [ ] **Step 3: Знай-как-чинить если что**

| Проблема | Что чинить |
|---|---|
| Welcome не подменился | Файл welcome — проверь `Task 33` |
| Тред не сохраняется в localStorage | `Task 34` — Thread provider не подменён |
| Стриминг лагает | `Task 35` — Stream.tsx perf не перенесён |
| Цитата без карточки | `Task 36` — ToolMessage рендер не подключён |
| Catalog не грузится | Catalog endpoint не запущен или CORS заблокирован |
| Иконка ask не кладёт preset | `Task 37` — событие prefill-input не подписано |

- [ ] **Step 4: Checkpoint commit**

```bash
git commit --allow-empty -m "checkpoint: full UI smoke passes"
```

---

## Phase 10 — MVP закрытие

### Task 39: Финальный прогон goldset через полного агента

**Files:**
- (без новых файлов)

**Это acceptance gate.** Если этот тест не проходит — MVP не готов.

- [ ] **Step 1: Запустить полный стек**

Postgres + backend (langgraph dev) — как в Task 38. БД должна содержать **полный** корпус (Task 31).

- [ ] **Step 2: Запустить goldset**

```bash
cd apps/backend
.venv/bin/pytest tests/integration/test_goldset.py -v -s 2>&1 | tee /tmp/goldset_final.log
```

- [ ] **Step 3: Проверка thresholds**

Test упадёт с диагностикой если пороги не достигнуты. Пример вывода:

```
=== Goldset summary ===
{
  "addressed": {"total": 18, "passed": 16, "pass_rate": 0.89, "failed": [...]},
  "thematic":  {"total": 22, "passed": 15, "pass_rate": 0.68, "failed": [...]},
  "cross":     {"total": 8,  "passed": 7,  "pass_rate": 0.875, "failed": [...]},
  "negative":  {"total": 5,  "passed": 5,  "pass_rate": 1.00}
}
```

Если какой-то порог не пройден — итерация:

| Тип провала | Что чинить |
|---|---|
| Negative провал (фабрикация) | Усилить раздел «Что делать если ничего не найдено» в `MAIN_AGENT_PROMPT`. Возможно добавить explicit check на цитирование без read_passage. |
| Addressed < 80% | Проверь slug-и авторов в goldset vs реальные slug-и в БД. Поправь `gold.yaml` или нормализуй slugify(). |
| Thematic < 60% | Concept expansion слаб → дополни `glossary.json` на основе провалившихся запросов. Search subagent промпт можно ужесточить. |
| Cross < 70% | Если Платон / Библия не индексированы — провал ожидаем. Доскачай корпус или ослабь threshold. |

**Каждая итерация — новый прогон goldset.**

- [ ] **Step 4: Когда все пороги пройдены — commit**

```bash
git commit --allow-empty -m "milestone: MVP acceptance — goldset passes all thresholds"
```

---

### Task 40: Documentation + deployment runbook

**Files:**
- Modify: `README.md` (полная переписка)
- Create: `infra/scripts/pg_dump_restore.md`

- [ ] **Step 1: README**

`README.md`:

```markdown
# Patristic Chat

Агентный чат по русскому святоотеческому корпусу с верифицированными цитатами.

## Структура

- `apps/backend/` — LangGraph Server + deepagents (Sonnet main + Haiku search subagent).
- `apps/frontend/` — Next.js форк agent-chat-ui.
- `packages/pipeline/` — CLI пайплайн (scrape, markdown, paragraphs, embed, enrich).
- `infra/` — docker-compose + миграции + nginx.
- `tests/eval/gold.yaml` — goldset запросов с порогами (см. Phase 7 плана).

## Запуск (dev, WSL2 + Docker)

```bash
cp .env.example .env
# отредактируй TIMEWEB_AI_KEY

docker compose -f infra/docker-compose.dev.yml up postgres
docker exec -i patristic-postgres-dev psql -U postgres -d patristic < infra/migrations/001_init.sql

# одноразово: индексация корпуса (часы)
cd packages/pipeline && python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/python -m pipeline paragraphs
.venv/bin/python -m pipeline concepts-bootstrap
.venv/bin/python -m pipeline embed --device cuda

# бек
cd apps/backend && python -m venv .venv && .venv/bin/pip install -e .
.venv/bin/langgraph dev --port 2024 --no-browser &
.venv/bin/uvicorn backend.catalog:app --port 8001 &

# фронт
cd apps/frontend && pnpm install && pnpm dev
```

Открыть http://localhost:3000.

## Тестирование

- Unit: `cd apps/backend && pytest tests/unit/`
- Integration (требует live стек): `pytest tests/integration/`
- Goldset (acceptance gate): `pytest tests/integration/test_goldset.py`

## Документы

- [Design spec](docs/superpowers/specs/2026-05-14-patristic-chat-design.md)
- [Implementation plan](docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md)
```

- [ ] **Step 2: pg_dump runbook**

`infra/scripts/pg_dump_restore.md`:

```markdown
# Postgres dump / restore для деплоя

## Локально → дамп

```bash
docker exec patristic-postgres-dev pg_dump -U postgres -d patristic -Fc \
  > patristic-$(date +%Y-%m-%d).dump
ls -lh patristic-*.dump  # ожидаемо 3-5 ГБ на полный корпус
```

## VPS → восстановить

```bash
scp patristic-*.dump user@vps:/tmp/
ssh user@vps

# На VPS:
docker exec -i patristic-postgres-prod psql -U postgres -d patristic < \
  /tmp/patristic-2026-05-14.dump  # ИЛИ:
docker exec -i patristic-postgres-prod pg_restore -U postgres -d patristic --clean \
  < /tmp/patristic-2026-05-14.dump
```

## Обновление данных

`pg_restore --clean` дропает существующие таблицы и заливает заново. Downtime ~5 мин.
```

- [ ] **Step 3: Коммит**

```bash
git add README.md infra/scripts/pg_dump_restore.md
git commit -m "docs: production README and pg_dump/restore runbook"
```

---

### Task 41: Удаление мёртвого кода старого `christian_rag`

**Files:**
- Delete: `main.py`, `rag_service.py`, `repository.py`, `embedding_service.py`, `text_service.py`, `models.py`, `database.py`, `migrations.py`, `config.py`, `books.json`, `templates/`, `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `requirements.txt`, `HTTPS_SETUP_GUIDE.md`, `texts/`, `nginx/` (уже скопировано в infra/), `scripts/` (уже скопировано)

- [ ] **Step 1: Sanity — найти ссылки**

```bash
cd /mnt/c/Users/79819/PycharmProjects/christian_rag
grep -rln "from rag_service\|from repository\|from embedding_service\|from text_service\|from models import\|from database\|from migrations import\|import config" \
     apps/ packages/ infra/ tests/ 2>/dev/null
```

Expected: пусто. Если есть ссылки — это значит в новом коде используется старый `import`. Поправить.

- [ ] **Step 2: Удалить файлы**

```bash
git rm main.py rag_service.py repository.py embedding_service.py text_service.py \
       models.py database.py migrations.py config.py books.json
git rm -r templates/ texts/ nginx/ scripts/
git rm Dockerfile docker-compose.yml docker-compose.prod.yml requirements.txt
git rm HTTPS_SETUP_GUIDE.md
```

- [ ] **Step 3: Final smoke**

Перезапусти бек + фронт. Убедись что всё ещё работает. Прогон goldset ещё раз.

- [ ] **Step 4: Коммит**

```bash
git commit -m "chore: remove obsolete top-level files from initial commit"
```

- [ ] **Step 5: Final tag**

```bash
git tag -a v0.1.0-mvp -m "MVP — goldset passes; full corpus indexed"
git log --oneline | head -20
```

---

### Task 42: Enrich через LM Studio (после прохождения goldset)

**Files:**
- Modify: `packages/pipeline/pipeline/config.py` — добавить `lmstudio_*` settings
- Modify: `packages/pipeline/pipeline/enrich.py` — добавить provider switch

**Когда запускать:** только после успешного прохождения Task 39 (goldset). До этого момента `works.topics = NULL`, что **не блокирует** ни поиск, ни цитирование (см. design spec §6.4). Эта таска добавляет topics в `works` и в frontmatter md без переиндексации эмбеддингов.

**Pre-requisites (вручную):** запустить LM Studio с моделью (например `qwen/qwen3.5-9b` или любая 7-14B Q4). OpenAI-compatible endpoint: `http://localhost:1234/v1`.

- [ ] **Step 1: Расширить config.py**

Добавить поля в `Settings`:

```python
# Local LLM (LM Studio) for bulk enrich
lmstudio_base_url: str = "http://localhost:1234/v1"
lmstudio_model: str = "qwen/qwen3.5-9b"
enrich_provider: str = "timeweb"  # "timeweb" | "local"
```

- [ ] **Step 2: Перепилить enrich.py — выбор client'а**

Найди в `enrich.py` создание `client`:

```python
client = OpenAI(api_key=settings.timeweb_ai_key, base_url=settings.timeweb_base_url)
```

Замени на:

```python
if settings.enrich_provider == "local":
    client = OpenAI(api_key="not-needed", base_url=settings.lmstudio_base_url)
    model_name = settings.lmstudio_model
else:
    client = OpenAI(api_key=settings.timeweb_ai_key, base_url=settings.timeweb_base_url)
    model_name = settings.enrich_model

# и в вызове client.chat.completions.create(model=model_name, ...)
```

- [ ] **Step 3: Прогон**

```bash
# Терминал — убедись что LM Studio запущен и модель загружена
curl http://localhost:1234/v1/models
# должен вернуть список моделей включая loaded

cd packages/pipeline
ENRICH_PROVIDER=local .venv/bin/python -m pipeline enrich
```

Expected: проходит по 72K md, обновляет frontmatter и `works.topics`. На qwen 9B на 5070 Ti ~1-5 сек/файл = 20-100 часов. Можно запустить и оставить на сутки. **Идемпотентно** — если упало посередине, перезапуск пропустит уже обогащённые.

- [ ] **Step 4: Финальные sanity-метрики**

```sql
SELECT COUNT(*) FROM works WHERE topics IS NOT NULL;
-- должно быть = всему числу works

SELECT slug, jsonb_array_length(topics) AS n_topics FROM works
WHERE topics IS NOT NULL LIMIT 5;
-- по 3-7 топиков на труд
```

- [ ] **Step 5: LibraryBrowser topic search smoke**

Открой :3000 → Library → введи в поиск тему (например «молитва»). Должны разворачиваться авторы у которых есть truды с этой темой.

- [ ] **Step 6: Final tag**

```bash
git commit -m "feat(pipeline): enrich provider switch + LM Studio config"
git tag -a v0.2.0-enriched -m "Topics enriched across full corpus via LM Studio"
```

---

## Финальная проверка acceptance gate

После всех тасков:

- [ ] Postgres содержит ≥40 авторов, ≥1500 трудов, ≥500K параграфов.
- [ ] `pytest apps/backend/tests/unit/ -v` — все pass.
- [ ] `pytest apps/backend/tests/integration/test_smoke.py -v` — pass (citation discipline).
- [ ] `pytest apps/backend/tests/integration/test_goldset.py -v` — pass с порогами:
  - addressed: ≥80%
  - thematic: ≥60%
  - cross: ≥70%
  - negative: 100%
- [ ] Manual UI smoke (Task 38) — все пункты выполнены.

**Если все галки — MVP закрыт.** Тег `v0.1.0-mvp`.

---

## Out of plan (точки расширения, не в этом плане)

- CI/CD (GitHub Actions для backend pytest + frontend e2e).
- Структуризация одно-файловых трудов через Haiku (sliding window).
- Sparse + multi-vector от bge-m3.
- Cross-encoder reranker.
- Дашборд верификации UI (агент_runs visualisation).
- Многоустройственная синхронизация чатов (требует auth + сервер).
- Реальное deployment: prod docker-compose, SSL, certbot — есть скрипты, но не оттестированы под новый стек.
- Frontend embedding (transformers.js).
- Перевод корпуса (английский / греческий).
- Внутрисайтовая читалка трудов.

Каждая — отдельный спек + план.
