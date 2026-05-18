# Patristic Chat MVP — Implementation Status

**Last update:** 2026-05-15 (autonomous loop)
**Plan:** [docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md](docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md)

## Acceptance gate

MVP done **only when** `tests/eval/gold.yaml` (53 entries) passes through full agent with:
- addressed ≥ 80%
- thematic ≥ 60%
- cross ≥ 70%
- negative = 100%

## ✅ Done

### Pipeline (Tasks 1-14)
- Monorepo skeleton, .gitignore, .env.example
- `packages/pipeline/` — full CLI: scrape/download/markdown_convert/diagnose/paragraphs/concepts_bootstrap/embed/enrich
- Postgres 16 + pgvector in WSL Docker (`infra/docker-compose.dev.yml`), schema migrated
- 31 unit tests (slugify, lexical_preprocess, paragraphs, diagnose)
- torch 2.11.0+cu128 on RTX 5070 Ti (CUDA verified)
- Windows fixes: `WindowsSelectorEventLoopPolicy`, `connect_timeout` for AsyncConnectionPool

### Task 15 — Pipeline e2e validated
- On Augustine subset (10 chapters): lexical + semantic search work; canonical citation format right
- Author slug = `avrelij_avgustin_blazhennyj`, work slug = `avrelij_avgustin_blazhennyj_ispoved`

### Tasks 16-26 — Backend
- `apps/backend/` — pyproject (deepagents 0.6), FastAPI app (`backend.server:app`), Dockerfile
- 6 agent tools + embedding queue worker + catalog + observability + prompts + graph + eval_runner
- **32 unit tests all pass** (`pytest tests/unit/ -v` in 18:43)
- Graph imports cleanly (`CompiledStateGraph`)

### Tasks 28-29 — Goldset infrastructure
- `tests/eval/gold.yaml` — 53 entries (18 addressed + 22 thematic + 8 cross + 5 negative)
- `apps/backend/src/backend/eval_runner.py` — pure eval logic
- `apps/backend/tests/integration/test_goldset.py` — live runner with threshold gate
- `apps/backend/tests/integration/test_smoke.py` — citation discipline + negative case smoke

### Tasks 32-37 — Frontend
- Forked `langchain-ai/agent-chat-ui` → `apps/frontend/`
- Russian welcome with 4 example chips
- localStorage thread provider (cross-tab sync via storage event)
- SSE perf fixes ported from trading-mcp (throttle 50ms, smooth markdown via rAF + useDeferredValue)
- `<CitationCard>` for `read_passage` tool results (collapsible context, azbyka link)
- `<LibraryBrowser>` modal: tree of authors → works, instant client-side search, 💬 ask + ↗ azbyka per work
- `npm run build` green (zero TS errors)

### Task 40 — Documentation
- `README.md` — production quick-start, env quirks, deployment runbook reference
- `infra/scripts/pg_dump_restore.md` — Postgres dump/restore for VPS deployment

### Task 41 — Cleanup of old top-level files
- Removed: `main.py`, `rag_service.py`, `repository.py`, `embedding_service.py`, `text_service.py`, `models.py`, `database.py`, `migrations.py`, `config.py`, `books.json`, `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `requirements.txt`, `HTTPS_SETUP_GUIDE.md`, `templates/`, `nginx/`, `scripts/`, `texts/`

## 🟡 In progress

### Task 31 — Full corpus indexing
Started 2026-05-15 10:11. Currently:
- ✅ **paragraphs:** 85 authors, 2020 works, **709,969 paragraphs** in 8 min
- ✅ **concepts-bootstrap:** glossary 79/79 concepts done (commit `54995e5`)
- ⏸️ **embed (bge-m3 on cuda):** paused by user at 22,208 / ~1.94M windows.
  - v1 was 4h with 0 commits (one giant transaction)
  - v2 was 46 win/sec (autocommit=True caused fsync-per-row in executemany)
  - v3 (commit `cd3a9f1`): `autocommit=False` + explicit `await c.commit()` per batch — one fsync per batch. Not yet validated at scale.
  - Resumable: rerun `cd packages/pipeline && PYTHONUTF8=1 PYTHONUNBUFFERED=1 .venv/Scripts/python -m pipeline embed --device cuda --batch-size 64`. Skips done rows via `_load_done_keys`.
  - `--from-scratch` flag truncates embeddings if needed.
- ✅ **Embed window builder unit tests:** 8 new tests in `packages/pipeline/tests/test_embed_windows.py` (all pass).

## 🔜 Next (after Task 31 finishes)

### Task 39 — Goldset acceptance gate
```bash
# Terminal A
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/uvicorn backend.server:app --port 8000 --reload

# Terminal B (after server says "Ready"):
cd apps/backend && BACKEND_URL=http://localhost:8000 PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/integration/test_goldset.py -v -s
```

Per-iteration tuning loop (max 10):
- If addressed < 80% → check author slugs in `gold.yaml` match real `SELECT slug FROM authors`
- If thematic < 60% → expand `glossary.json` with terms from failed queries; adjust SEARCH_AGENT_PROMPT
- If cross < 70% → indexing of philosophy / Bible may be incomplete
- If negative < 100% → tighten "ничего не найдено" rule in MAIN_AGENT_PROMPT

Each iteration commits.

### Task 38 — Manual UI smoke (requires human eyes)
```bash
# Three terminals
wsl -e bash -c "cd ... && docker compose ... up -d postgres"   # if not running
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/uvicorn backend.server:app --port 8000 --reload
cd apps/frontend && PORT=3001 npm run dev
```
Open http://localhost:3000. Walk through: welcome → submit → see CitationCard → click azbyka → open Library → search → click 💬 → preset in input.

### Task 42 — Enrich via LM Studio (post-MVP)
After goldset passes. User starts LM Studio with qwen3.5-9b on :1234, then:
```bash
ENRICH_PROVIDER=local PYTHONUTF8=1 .venv/Scripts/python -m pipeline enrich
```
Populates `works.topics` for richer library search. No corpus reindex needed.

## Git log

```
aca3e32 test(backend): goldset integration test (acceptance gate runner)
abc3fdd docs: production README + pg_dump/restore runbook
46bdedf chore: postgres restart policy + ignore temp subsets
fa3071e chore: remove obsolete top-level files
1077d65 test(backend): 32 unit tests all pass
8d6087e feat(frontend): patristic chat UI — fork agent-chat-ui + localStorage + library + citations
45a7e0e fix(backend): explicit connect_timeout + deepagents 0.6 API
6c08e44 fix(pipeline): explicit connect_timeout for AsyncConnectionPool
...
```

Total: 40+ commits in this MVP development.
