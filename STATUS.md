# Patristic Chat MVP — Implementation Status

**Last update:** 2026-05-15
**Mode:** Subagent-driven execution (single autonomous session)
**Plan:** [docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md](docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md)

## Acceptance gate

MVP is **done only when** `tests/eval/gold.yaml` (53 entries) passes through full agent with:
- addressed ≥ 80%
- thematic ≥ 60%
- cross ≥ 70%
- negative = 100%

---

## ✅ Done

### Pipeline (Tasks 1-14)
All committed and unit-tested:
- Monorepo skeleton, `.gitignore`, `.env.example`
- Imported scraper/downloader/converter/enricher from sibling `orthodox_rag/` (data moved to `packages/pipeline/data/` and `output/`)
- Postgres 16 + pgvector in WSL Docker (`infra/docker-compose.dev.yml`, container `patristic-postgres-dev`, port 5432)
- SQL migration `infra/migrations/001_init.sql` — 7 tables (authors, works, chapters, paragraphs, embeddings, agent_runs, schema_migrations) + extensions
- Pipeline package `packages/pipeline/`:
  - `pyproject.toml` with all deps (typer, pydantic, psycopg, sentence-transformers, openai, pyyaml, rich)
  - **venv installed in `.venv/`, torch 2.11.0+cu128 verified working on RTX 5070 Ti** (CUDA: True)
  - Modules: `config.py`, `db.py`, `__main__.py` (typer CLI), `models.py`, `slugify.py`, `lexical_preprocess.py`, `paragraphs.py`, `diagnose.py`, `concepts_bootstrap.py`, `embed.py`, `enrich.py`
  - `cs_dict.json` (30 ЦС-substitutions), `seed_concepts.json` (78 seed concepts)
  - **Tests: 20+3+5+3 = 31 unit tests pass** (`slugify`, `lexical_preprocess`, `paragraphs`, `diagnose`)
- Fixed Windows asyncio: `WindowsSelectorEventLoopPolicy` in `__main__.py` (psycopg-pool needs Selector, not Proactor)

### Backend code (Tasks 16-29, partial)
Written and committed, **NOT TESTED** (no backend venv, no tests run):
- `apps/backend/pyproject.toml`, `langgraph.json`, `Dockerfile`
- `src/backend/config.py`, `db.py`, `__init__.py` (with Windows asyncio policy fix)
- `src/backend/embeddings/service.py` — async queue-batching worker
- `src/backend/tools/` — 6 tools: `list_authors`, `list_works`, `expand_concept`, `lexical_search`, `semantic_search`, `read_passage`, `_citation` (helper)
- `src/backend/catalog.py` — FastAPI app with `GET /catalog`
- `src/backend/observability.py` — `agent_runs` writer
- `src/backend/prompts.py` — main + search agent prompts (Russian)
- `src/backend/graph.py` — deepagents `create_deep_agent` with Sonnet+Haiku via Timeweb proxy
- `src/backend/eval_runner.py` — goldset eval logic (pure, testable)
- `tests/eval/gold.yaml` — **53 entries** (18 addressed + 22 thematic + 8 cross + 5 negative)

### Infra niceties
- Postgres `restart: unless-stopped` (auto-recovers when WSL up)
- LM Studio config in `.env`: `LMSTUDIO_BASE_URL=http://localhost:1234/v1`, `LMSTUDIO_MODEL=qwen/qwen3.5-9b`, `ENRICH_PROVIDER=timeweb` (switch to `local` for Task 42)

---

## 🟡 Blockers / known issues

### B1: WSL VM stops between commands
WSL2 Ubuntu auto-suspends when idle. The Docker daemon and postgres container die with it.

**Mitigation:** Keep a persistent background process inside WSL — `wsl -e bash -c "sleep infinity"` running in background. Or run `wsl --` interactively before starting work.

When you restart work: `wsl -e bash -c "cd '/mnt/c/Users/79819/PycharmProjects/christian_rag' && docker compose -f infra/docker-compose.dev.yml up -d postgres"`.

### B2: Pipeline e2e on subset not validated
Task 15 should run `paragraphs` on a 1-3 author subset and verify rows in DB. **Attempted but stuck** — Windows-side bash output buffering masked real progress; tried with project-local `_subset/` dir. Did not complete a clean run end-to-end before stopping.

**Probable cause:** Python on Windows + async psycopg pool may be slow when iterating ~2596 md files. The unit tests for `paragraphs.parse_md / split_paragraphs` pass (5/5), so the parsing logic is correct. The DB ingest path is untested live.

**Verify next:**
```bash
# In Git Bash (with WSL VM running)
cd packages/pipeline
# Use absolute Windows path or project-local subset for OUTPUT_DIR
SUBSET="$(pwd)/_subset"   # already populated with Augustine; delete and recreate smaller if needed
OUTPUT_DIR="$SUBSET" PYTHONUTF8=1 .venv/Scripts/python -m pipeline paragraphs
# Then:
wsl -e bash -c "docker exec patristic-postgres-dev psql -U postgres -d patristic -c 'SELECT slug, paragraph_count FROM works ORDER BY paragraph_count DESC LIMIT 5'"
```

If still slow: smaller subset (just 1 work, ~5-10 md files). The unit tests prove parsing works.

### B3: Backend python venv not created, tests not written/run
Files at `apps/backend/` are scaffold only. Need:
```bash
cd apps/backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"
# Then write tests at tests/unit/test_*.py per plan Tasks 17-24 and run.
```

`deepagents` package version may differ from `>=0.0.10`. Check at install time with `pip index versions deepagents` and adjust pyproject if needed.

### B4: Frontend not started (Tasks 32-37)
Nothing in `apps/frontend/` yet beyond `.gitkeep`. Follow plan tasks 32-37:
1. Clone `https://github.com/langchain-ai/agent-chat-ui` into `apps/frontend/`.
2. Strip branding + add patristic welcome.
3. Replace ThreadProvider with `localStorage` (see plan Task 34).
4. Port `providers/Stream.tsx`, `components/thread/markdown-text.tsx`, `components/thread/index.tsx` from `trading-mcp/terminal/front` for SSE smoothness fixes.
5. Add `CitationCard` component (renders `read_passage` tool results).
6. Add `LibraryBrowser` modal (`use-catalog.ts`, tree + search + azbyka + 💬 ask).

### B5: Goldset author slugs need verification
`tests/eval/gold.yaml` uses slug guesses like `ioann_lestvichnik_prepodobnyj`. After Task 31 full index, run:
```sql
SELECT slug FROM authors ORDER BY slug;
```
and align `expected_authors` in gold.yaml to actual slugs.

### B6: Bash output file buffering
Claude's bash tool buffers command output to file; rich.Progress and similar TUI tools don't render until process exits. Avoid `rich.Progress` for long-running scripts during this debugging phase, or set `PYTHONUNBUFFERED=1` and use plain `print(..., flush=True)`.

---

## 📋 Next steps (ordered)

1. **Validate pipeline e2e on subset (B2 above).** Single author, run `paragraphs`, verify DB rows. Then run `concepts-bootstrap` (Timeweb, ~78 calls), then `embed --device cuda` (subset = minutes on GPU).
2. **Backend venv + tests.** `cd apps/backend && python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"`. Write tests at `tests/unit/test_*.py` per plan (Tasks 17-24). Note: backend tests need same `WindowsSelectorEventLoopPolicy` — already set in `__init__.py`. Tests assume real Postgres + seeded fixtures.
3. **Smoke run.** `cd apps/backend && .venv/Scripts/langgraph dev --port 2024`. In another terminal: `curl -X POST http://localhost:2024/threads`. Validate model strings (Timeweb may use different model id format than `anthropic/claude-sonnet-4-7`).
4. **Full corpus index (Task 31).** `cd packages/pipeline && PYTHONUTF8=1 .venv/Scripts/python -m pipeline paragraphs` (~30-60 min). Then `python -m pipeline concepts-bootstrap`. Then `python -m pipeline embed --device cuda --batch-size 64` (~2-6h GPU). pg_dump optional checkpoint.
5. **Frontend (Tasks 32-37).** See B4.
6. **Goldset baseline + iteration (Tasks 30, 39).** Run, fix author slugs, tune prompts/glossary. Up to 10 iterations.
7. **MVP closeout (Tasks 40-41).** Update README, cleanup old `main.py`/`rag_service.py`/etc.
8. **Enrich via LM Studio (Task 42, post-MVP).** Set `ENRICH_PROVIDER=local` in `.env`, run `python -m pipeline enrich`.

---

## Decisions log

- 2026-05-15: Subset paths must be project-local (Git Bash `/tmp` ≠ Python on Windows `/tmp`). Use `packages/pipeline/_subset/` or absolute Windows paths.
- 2026-05-15: Skip `enrich` in initial MVP run (no impact on goldset). Will run via LM Studio after goldset passes (Task 42). Provider switch already in `enrich.py`.
- 2026-05-15: Goldset stuck policy = 10 iterations max; better → next, worse → revert + retry. Configured but not yet exercised.
- 2026-05-15: Postgres 16 (pgvector/pgvector:pg16) on port 5432 — separate from existing pg11 on 5433. `restart: unless-stopped` added.
- 2026-05-15: torch 2.11.0+cu128 (Blackwell-compatible) in pipeline venv. CUDA verified.
- 2026-05-15: Subagent-driven execution shifted to direct-execution for mechanical scaffolding tasks (1-15) and code-with-spec tasks (16-29) to conserve session context. Subagent dispatches reserved for tricky tasks.

## Git log summary

Run `git log --oneline` to see all commits. Roughly 25+ feat/fix/test commits between `b17e6d0` (plan added) and the head.

## Files NOT YET written (deferred for user resume)

- `apps/backend/tests/conftest.py` and all `tests/unit/test_*.py` (Tasks 17-24)
- `apps/backend/tests/integration/test_smoke.py` (Task 27)
- `apps/backend/tests/integration/test_goldset.py` (Task 28)
- `apps/backend/tests/unit/test_eval_runner.py`
- All of `apps/frontend/` beyond .gitkeep (Tasks 32-37)
- Updated `README.md` (Task 40)
- `infra/scripts/pg_dump_restore.md` runbook (Task 40)
- Cleanup commit removing old top-level py files (Task 41)
