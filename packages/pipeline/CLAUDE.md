# packages/pipeline — CLAUDE.md

Audience: Claude Code working inside `packages/pipeline/`. Auto-loaded.

## What this package is

Data ingestion CLI for the patristic corpus: scrape azbyka.ru → download epub → convert to md → parse paragraphs into Postgres → embed windows with bge-m3 → optional concept bootstrap + LLM enrich.

## CLI commands (typer in `pipeline/__main__.py`)

The typer app exposes ONLY these subcommands:
- `diagnose` — fs scan of `output/` and `data/`, writes `diagnose_report.json`. No DB. `pipeline/diagnose.py`.
- `paragraphs` — parses every md (patristic + Bible) and writes `paragraphs`/`works`/`authors`/`chapters` via in-memory accumulation + bulk COPY-FROM-STDIN (replaced the legacy row-by-row executemany flow). Both flows live in `pipeline/paragraphs.py`; Bible branch is `_ingest_bible`. **Known tech-debt:** the patristic pass buffers ~2.6M paragraph rows in RAM (~1.5 GB peak) before COPY. See TODO at the top of `paragraphs.run()` — convert to streaming 2-pass (pass 1 collects authors/works/chapters, pass 2 streams parsed rows directly into the COPY cursor) to drop RAM to ~50 MB at the cost of one extra parse pass. Worth doing before any further corpus expansion.
- `bible-markdown` — Bible-specific epub→md (verse-per-md). Skip-if-exists per book. `pipeline/bible_md_convert.py`.
- `embed` — bge-m3 encoding + HNSW/GIN build. See perf section below. `pipeline/embed.py`.
- `concepts-bootstrap` — generates `glossary.json` (synonyms/related/greek per concept) via the configured OpenAI-compatible endpoint (Haiku) from `seed_concepts.json`. Resumable. Currently 79/79 done. `pipeline/concepts_bootstrap.py`.
- `enrich` — populates `works.topics` via LLM (remote OpenAI-compatible or LM Studio, per `ENRICH_PROVIDER`). Post-MVP. `pipeline/enrich.py`.

NOT wired to typer (despite the file names): `pipeline/scrape.py` (`Scraper` class), `pipeline/download.py` (`Downloader` class), `pipeline/markdown_convert.py` (`MarkdownConverter` class). They live as importable classes only — if you need them from CLI you must add a typer command yourself. They take a `Config` instance, not the global `settings` (legacy code path).

Run pattern: `cd packages/pipeline && PYTHONUTF8=1 .venv/Scripts/python -m pipeline <command> [flags]`. Always set `PYTHONUTF8=1` on Windows or typer --help dies with UnicodeEncodeError on Cyrillic (cp1252).

## Two markdown flows (Bible vs patristic) — real foot-gun

They look the same but aren't.

**Patristic flow** (`MarkdownConverter` → `paragraphs._upsert_*` path):
- Frontmatter has `author`, `book_title`, `chapter_title`, `chapter_number`, `section`, `source_url`, `global_section`, `author_years_of_life`, `creation_date`.
- One md = one chapter; body has multiple paragraphs separated by blank lines.
- Parsing: `split_paragraphs` (blank-line split, falls back to single-newline if no blanks), noise-filter, `MIN_PARA_CHARS=30`.
- Uses BS4 `"xml"` parser (`markdown_convert.py:53`).

**Bible flow** (`bible_md_convert.run()` → `paragraphs._ingest_bible` path):
- Frontmatter has `book_title`, `bible_verse` ("1Кор.1:1 Павел, ..."), `verse_number`, `source_url`. **No `author` field.** That's why the patristic loop in `paragraphs.run()` (which requires `author` + `book_title`) skipped Bible silently for months.
- One md = one verse. Filename pattern: `NNNN_<book>_<chapter>_<verse>[_<endverse>]_<snippet>.md` (parsed by `_BIBLE_FILENAME_RE` in `paragraphs.py`).
- `bible_md_convert._find_verse_ref_span` has two HTML branches: newer Толковая Библия epubs (Иов, Псалтирь, Числа, etc.) dropped the `class="bibtext"` span; fallback finds a `<span>` containing an `<a href=".../azbyka.ru/biblia/...">` or matching `_VERSE_REF_RE`.
- Uses BS4 `"html.parser"` (NOT `"xml"`). With `"xml"` BS4 splits `class="paragraph"` into per-character lists.
- Pseudo-author for all Bible: slug `svjashhennoe_pisanie`, name "Священное Писание". Work slug: `bible_<slugified_book_dir>`. Constants in `paragraphs.py`.

If you regenerate from scratch you MUST run both the patristic epub→md conversion AND `bible-markdown` before `paragraphs`. `bible-markdown` is skip-if-exists per book dir.

## Embed performance (`embed.py`)

Profiled with `profile_embed.py` (committed; uses isolated `patristic_profile` DB so you can re-benchmark without risk). Baseline single-thread sync was ~46–48 win/sec on RTX 5070 Ti, bottleneck encode 88.5%. With fp16 + max_seq=512 + length-sorted 1024-window buffer: ~167 win/sec sync; in async pipeline with 2 db_writers ~270 win/sec target, ~135 win/sec average with `--throttle-ms 100 --cpu-threads 4`.

Defaults: `fp16=True, max_seq_length=512, sort_buffer=1024, db_workers=2, queue_size=8, batch_size=settings.embedding_batch_size` (which is 32 from config; `.env` also sets 32). Bigger batch_size helps GPU utilization until VRAM cap.

Low-impact knobs for "I need to use the computer while it embeds":
- `--throttle-ms 100` — `asyncio.sleep` between encode batches; lets Windows display driver share GPU.
- `--cpu-threads 4` — caps `torch.set_num_threads`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS`, sets `TOKENIZERS_PARALLELISM=false`.

Indexing (`_create_indexes`) drops + recreates HNSW(m=16, ef_construction=64) on `vector` and GIN on `text_for_lexical`, then `ANALYZE`. On 2M rows ~1-2 hours, IO-bound. Could speed up with `SET maintenance_work_mem='4GB'` before CREATE INDEX (not done, for safety).

Resume relies on `_load_done_keys` — loads all `(work_slug, chapter_num, para_num, window_size)` tuples into memory (~250MB for 2M rows). Fine for current corpus.

DB writer uses `set_autocommit(False)` with explicit `await c.commit()` per batch — one fsync per batch. Setting autocommit True makes psycopg `executemany` open one transaction per row (orders of magnitude slower).

## DB connection (`db.py`)

`AsyncConnectionPool` with `kwargs={"connect_timeout": 10}`. Without this kwarg `pool.open()` hangs forever on Windows + py3.13 (psycopg-pool 3.3.x worker hangs inside `connection_class.connect`). Don't remove.

Pool `min_size=1, max_size=8`. Embed uses `db_workers=2` by default so 2 active connections during the long run.

`WindowsSelectorEventLoopPolicy` is set at the top of `__main__.py` before any asyncio imports — Proactor breaks psycopg-pool.

## .env (pipeline-local)

`packages/pipeline/.env` is separate from repo root `.env`. Don't sync them. Pipeline-local keeps `EMBEDDING_DEVICE=cuda` (this venv has torch+cu128). Backend keeps `cpu` (cpu-only torch).

Vars read by `Settings` (`config.py`): `POSTGRES_DSN`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ENRICH_MODEL`, `ENRICH_PROVIDER` (`"openai"` | `"local"`), `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DEVICE`, `EMBEDDING_BATCH_SIZE`. Also `OUTPUT_DIR` from os.environ overrides `output/` for subset runs.

## Tests

`tests/test_slugify.py`, `test_lexical_preprocess.py`, `test_paragraphs.py`, `test_diagnose.py`, `test_embed_windows.py`, `test_bible_helpers.py`. Run:

```
cd packages/pipeline && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/ -v
```

All tests are pure / offline. None touch the DB, none mock `conn()`. They cover parsing helpers, slugification, paragraph splitting, window construction (`_build_windows_for_chapter`), Bible filename/verse helpers, and the filesystem analyzer. Fixtures live in `tests/fixtures/`.

## Common pitfalls

- Running pipeline without `PYTHONUTF8=1` → typer --help crashes with UnicodeEncodeError on cp1252.
- Embedding hangs at "[model] loading" → confirm CUDA is visible: `.venv/Scripts/python -c "import torch; print(torch.cuda.is_available())"`. If False, reinstall torch with `+cu128 --index-url ...`.
- `--from-scratch` followed by Ctrl-C loses progress (no checkpoint, embeddings table was just truncated). Use only when intentional.
- Re-running `paragraphs` is idempotent (UPSERT authors/works/chapters + DELETE-then-INSERT per chapter) but expensive (8-10 min full corpus). Use `diagnose` first to see what's actually missing.
- `paragraphs.run()` skips files where `author` or `book_title` is empty — silent skip, no error. Bible files go through `_ingest_bible` instead via the `_is_bible_path` split.
