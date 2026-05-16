# apps/backend — patristic chat (LangGraph + FastAPI)

LangGraph Server graph plus a FastAPI catalog endpoint for the patristic chat. Built on `deepagents` 0.6 (installed: 0.6.1). Production model calls go through the Timeweb AI proxy (OpenAI-compatible).

## Architecture

Two-tier agent in `src/backend/graph.py`:

- **Main agent** (`anthropic/claude-sonnet-4-6`) — orchestrator. Tools: `read_passage`, `list_authors`, `list_works`, `expand_concept`, `lexical_search`, `semantic_search`, plus the deepagents `task` tool to delegate.
- **Search subagent** named `search` (`anthropic/claude-haiku-4-5`) — invoked via `task`. Same tools minus `read_passage`. Returns 3–8 candidates with citations + snippets capped at 200 chars.
- Rule: main MUST call `read_passage` before quoting (anti-hallucination); search NEVER quotes directly.
- Citation markup: main agent emits `[[<citation_slug>|«<short verbatim quote>»]]` inline in answers (rule 4 in `MAIN_AGENT_PROMPT`). The slug is the exact `citation` it passed to `read_passage`; the `«»`-wrapped quote is a verbatim substring of `read_passage.text`. The frontend parses these markers into `[N]` pills + a citations panel (see `apps/frontend/CLAUDE.md`). Author/work/§/azbyka URL are resolved on the frontend by joining slug to the matching `read_passage` result — agents don't repeat that metadata in prose.

`recursion_limit` is bumped to 50 via `.with_config(...)` in `graph.py`.

System prompts in `src/backend/prompts.py`. The main prompt carries an explicit GOOD/BAD slug example because Sonnet tries to "normalize" slugs like `sokolov_tihon_zadonskij_svjatitel/...` into `tikhon-zadonskyj/...`. Read `prompts.py` before editing — those rules are load-bearing.

## langgraph.json

Mounts both the graph and a custom FastAPI app (module paths, package is editable-installed):

- `graphs.patristic` → `backend.graph:agent`
- `http.app` → `backend.catalog:app` (FastAPI; `/catalog` and `/health`)
- `env` → `../../.env`

## Tools (`src/backend/tools/`)

Thin async `@tool` wrappers over Postgres. Read each source before assuming behavior:

- `read_passage.py` — **MUST NOT raise** on miss. Returns `{found: true, ...}` or `{found: false, error, citation, work_exists?}`. The non-raising contract is load-bearing: deepagents fires parallel `tool_calls`; if one raises, langgraph cancels siblings (`CancelledError`) and the run hangs. The `work_exists` flag distinguishes "you hallucinated the slug" from "you got the para_num wrong". Format-parse failures also return `{found: false, ...}` (no raise).
- `lexical_search.py` — Postgres `tsvector` + `ts_rank` against `embeddings.text_for_lexical`. Optional `author_slug` / `work_slug` filters. Default `limit=10`. Preprocessing lowercases + strips punctuation + applies `cs_dict.json` (Church-Slavonic → modern) before `plainto_tsquery('russian', …)`.
- `semantic_search.py` — bge-m3 + pgvector cosine (`<=>`) ANN. Same optional filters. Default `limit=10`. Calls `embeddings.get_service()` to embed the query (this is where the CUDA assertion can fire — see Config).
- `expand_concept.py` — loads `packages/pipeline/glossary.json` (case-insensitive lookup; cached in module). On miss returns `{found: false, suggestions: [...]}` with naive substring fuzzy matches (top 5); the agent should retry with the canonical term.
- `list_authors.py` — `SELECT slug, name_display, years, century, global_section FROM authors ORDER BY name_display`. Returns all rows; large but tolerable.
- `list_works.py` — works for one `author_slug`, with `topics` JSON parsed.

Shared helpers: `tools/_citation.py` (`parse_citation` / `make_citation`).

## Config (`src/backend/config.py`)

`pydantic-settings` reads `../../.env` from `REPO_ROOT = parents[4]`. Defaults:

- `postgres_dsn: "postgresql://postgres:postgres@localhost:5432/patristic"`
- `main_agent_model: "anthropic/claude-sonnet-4-6"` — Timeweb plan tops out at 4-6; `claude-sonnet-4-7` returns 401 "no access to this model". Verify available models with `curl -H "Authorization: Bearer $TIMEWEB_AI_KEY" https://api.timeweb.ai/v1/models`. Note at `config.py:20-21` says confirmed 2026-05-16.
- `search_agent_model: "anthropic/claude-haiku-4-5"`
- `timeweb_base_url: "https://api.timeweb.ai/v1"`
- `embedding_model: "BAAI/bge-m3"`, `embedding_device: "cpu"` — backend `.venv` has torch CPU-only. If `.env` sets `EMBEDDING_DEVICE=cuda` you get `AssertionError('Torch not compiled with CUDA enabled')` from `semantic_search` when it embeds the query. Bulk embeddings live in the pipeline venv which has CUDA.
- `glossary_path` → `packages/pipeline/glossary.json`; `cs_dict_path` → `packages/pipeline/cs_dict.json`.

## Catalog API (`src/backend/catalog.py`)

FastAPI app with:
- `GET /catalog` — authors with nested works (single grouped query, `json_agg`).
- `GET /health` → `{"status": "ok"}`.
- CORS hardcoded to `allow_origins=["http://localhost:3000"]`, `GET` only.

## Running locally

```
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser
```

(`--allow-blocking` is no longer needed — all sync I/O in tools and the
embedding service is wrapped in `asyncio.to_thread` behind an async
double-checked-locking cache. The fix lives in `expand_concept._load`,
`lexical_search._cs_dict`, and `embeddings.service.get_service`.)

`langgraph dev` defaults to in-memory persistence; threads don't survive restart. Prod = LangSmith Deployment (out of scope for MVP).

## Tests

Two suites:
- `tests/unit/` — ~33 tool tests, no live LLM. Uses `patristic_test` DB (NOT `patristic`). Files: `test_catalog`, `test_embeddings_service`, `test_eval_runner`, `test_expand_concept`, `test_lexical_search`, `test_list_authors`, `test_list_works`, `test_read_passage`, `test_semantic_search`.
- `tests/integration/` — `test_smoke.py`, `test_goldset.py`, `smoke_goldset.py`. Require a running `langgraph dev` server and a real Timeweb key.

**Critical: `tests/conftest.py` sets `POSTGRES_DSN=patristic_test` BEFORE `import backend`** (see lines 8–18). Otherwise tools and fixtures hit different DBs (and historically, `db_clean` wiped the production corpus — incident, see git log `ae119d5`). The TRUNCATE fixture is destructive: it runs `TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE` before and after each test. Never point it at `patristic`.

`patristic_test` must exist with the schema applied:
```
docker exec patristic-postgres-dev psql -U postgres -c "CREATE DATABASE patristic_test"
docker exec patristic-postgres-dev psql -U postgres -d patristic_test -f /tmp/001_init.sql
```

Run unit tests: `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit -v`.

`pytest.ini_options` in `pyproject.toml`: `asyncio_mode = "auto"`, `testpaths = ["tests"]`.

## Smoke harness for goldset debugging

`tests/integration/smoke_goldset.py` picks one random goldset entry per category (`addressed`, `thematic`, `cross`, `negative`) with `SEED=42`, streams each run via `langgraph_sdk` with `stream_subgraphs=True`, then `client.runs.join` + `threads.get_state(subgraphs=True)`. Writes to `apps/backend/_smoke/`:

- `qN_<category>.txt` — pretty transcript (main + subagent interleaved, indented)
- `qN_<category>.json` — raw stream events
- `qN_<category>_state.json` — final checkpoint with subgraph states

Run: `LANGGRAPH_URL=http://localhost:<port> PYTHONUTF8=1 .venv/Scripts/python -m tests.integration.smoke_goldset`. To debug a failing query, inspect `_state.json` — `tasks[].error` shows interrupts. Goldset lives at `<repo>/tests/eval/gold.yaml` and is loaded via `backend.eval_runner.load_goldset`.

## Common failure modes

- **401 from Timeweb** → model not in plan (check `/v1/models`) or expired key. Error string: "You don't have access to this model".
- **BlockingError** → a new sync file I/O / `os.scandir` snuck into an async tool. Wrap it like the other cached loads do: pure sync function + module-level cache + `asyncio.Lock` + `await asyncio.to_thread(load_sync)`. See `expand_concept._load`, `lexical_search._cs_dict`, or `embeddings.service.get_service` for the pattern.
- **AssertionError "Torch not compiled with CUDA enabled"** → `.env` has `EMBEDDING_DEVICE=cuda`, backend venv has CPU torch.
- **`passage not found` cascade** → Sonnet hallucinated short slugs. Look at the `task` tool result; main should copy citations verbatim. If main mangles slugs, the prompt regression is back — check `prompts.py` GOOD/BAD example is still present.
- **Empty messages list / hang** → run errored mid-flight; check `langgraph dev` stdout for the traceback, or `_state.json` `tasks` field.
