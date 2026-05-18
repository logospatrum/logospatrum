# apps/backend — patristic chat (custom FastAPI + LangGraph)

Custom slim FastAPI app (`backend.server:app`) wrapping a `deepagents` 0.6 (installed: 0.6.1) ReAct graph. Production model calls go through an OpenAI-compatible endpoint (`OPENAI_BASE_URL` / `OPENAI_API_KEY`).

## Architecture

Two-tier agent in `src/backend/graph.py`:

- **Main agent** (`anthropic/claude-sonnet-4-6`) — orchestrator. Tools: `read_passage`, `list_authors`, `list_works`, `expand_concept`, `lexical_search`, `semantic_search`, `invoke_skill` (see Skills mechanism), plus the deepagents `task` tool to delegate. Wrapped in `StyleMiddleware` (see Styles mechanism) before each LLM call.
- **Search subagent** named `search` (`anthropic/claude-haiku-4-5`) — invoked via `task`. Same tools minus `read_passage`. Returns 3–8 candidates with citations + snippets capped at 200 chars. **No StyleMiddleware** — style does not apply to retrieval.
- Rule: main MUST call `read_passage` before quoting (anti-hallucination); search NEVER quotes directly.
- Citation markup: main agent emits `[[<citation_slug>|«<short verbatim quote>»]]` inline in answers (rule "Маркеры цитат" in `MAIN_AGENT_PROMPT`). The slug is the exact `citation` it passed to `read_passage`; the `«»`-wrapped quote is a verbatim substring of `read_passage.text`. The frontend parses these markers into `[N]` pills + a citations panel (see `apps/frontend/CLAUDE.md`). Author/work/§/azbyka URL are resolved on the frontend by joining slug to the matching `read_passage` result — agents don't repeat that metadata in prose.

`recursion_limit=50` is set both in `graph.py` (`.with_config(...)`) and in `server.py:_run_stream` per-run config — deepagents needs depth for tool-use loops; without it long runs hit the default 25 and abort silently.

System prompts in `src/backend/prompts.py`. The main prompt carries an explicit GOOD/BAD slug example because Sonnet tries to "normalize" slugs like `sokolov_tihon_zadonskij_svjatitel/...` into `tikhon-zadonskyj/...`. Read `prompts.py` before editing — those rules are load-bearing.

## Server entry (`src/backend/server.py`)

`backend.server:app` is the FastAPI app shipped in the container (Dockerfile CMD: `uvicorn backend.server:app --host 0.0.0.0 --port 8000`). Same entry is used in dev — see [Running locally](#running-locally). Routes:

- `GET /info` → `{flags, version}` — LangGraph JS SDK probes this at startup; only checks `res.ok`.
- `GET /health` → `{"status": "ok"}`.
- `GET /catalog` — authors with nested works (json_agg, single query).
- `GET /budget/check?subject=<key>` — pre-run budget gate. When `BUDGET_GUARD_ENABLED=false` returns `allowed=true` unconditionally; otherwise consults `budget_usage` table. Subject keys: `cookie:<uuid>` / `ip:<addr>` / `__global_month`.
- `POST /runs/stream` — stateless SSE stream of `agent.astream(...)`. Body: `{input, stream_mode, stream_subgraphs, config}`. The route injects a throwaway `thread_id` into `config.configurable` (LangGraph requires one even when not persisting), preserving any keys the proxy injected (`subject_key`, `style_id`, …). Emits `event: <mode>|<namespace>` SSE frames.
- `POST /threads/{thread_id}/runs/stream` — same handler; `thread_id` accepted for SDK compatibility but ignored (stateless).
- `/mcp` (and `/mcp/`) → mounted FastMCP sub-app (see "MCP endpoint" below).

CORS is built from `settings.allowed_origin` (comma-separated; `"*"` is silently filtered because Starlette rejects `allow_credentials=True` with wildcard).

Lifespan binds `init_pool()` / `close_pool()` and — when MCP is enabled — wraps the request loop in `mcp.session_manager.run()`. Without that wrap, MCP streaming handlers raise `"Task group is not initialized"` on every request.

## MCP endpoint (`/mcp`)

Built in `server.py:_build_mcp()` via `FastMCP("logospatrum")`. Exposes 6 tools mirroring the chat agent's: `semantic_search_tool`, `lexical_search_tool`, `read_passage_tool`, `list_authors_tool`, `list_works_tool`, `expand_concept_tool`. Sub-app is mounted at `/mcp` with `streamable_http_path="/"`.

Two MCP-specific load-bearing tweaks:

1. **`enable_dns_rebinding_protection = False`** — `FastMCP.settings.transport_security` defaults to allow-localhost-only `Host` headers. In prod the `Host` is `logospatrum.com` (or internal `backend:8000`), so the check would 421 every request. nginx enforces Origin/UA upstream, so disabling the in-app gate is safe.
2. **ASGI scope rewrite `/mcp` → `/mcp/`** (`server.py:_mcp_path_normalize` middleware). Without it, Starlette emits a 307 redirect to `/mcp/` with an *absolute* internal Location header that downstream proxies can't follow. The middleware mutates `scope["path"]` and `scope["raw_path"]` in place so both `/mcp` and `/mcp/` reach the handler with zero redirects. Must run BEFORE the mount is registered.

The Next.js frontend proxy whitelists `/mcp(\/.*)?` as a public path (no HMAC, no budget guard) — MCP is the product feature for plugin consumers.

## Tools (`src/backend/tools/`)

Thin async `@tool` wrappers over Postgres. Read each source before assuming behavior — the docstrings carry the load-bearing usage hints (the system prompts no longer duplicate them):

- `read_passage.py` — **MUST NOT raise** on miss. Returns `{found: true, ...}` or `{found: false, error, citation, work_exists?}`. The non-raising contract is load-bearing: deepagents fires parallel `tool_calls`; if one raises, langgraph cancels siblings (`CancelledError`) and the run hangs. The `work_exists` flag distinguishes "you hallucinated the slug" from "you got the para_num wrong". Format-parse failures also return `{found: false, ...}` (no raise).
- `lexical_search.py` — Postgres `tsvector` + `ts_rank` against `embeddings.text_for_lexical`. Optional `author_slug` / `work_slug` (each accepts `str | list[str]`) / `section` filters. Default `limit=10`. Preprocessing lowercases + strips punctuation + applies `cs_dict.json` (Church-Slavonic → modern) before `plainto_tsquery('russian', …)`.
- `semantic_search.py` — bge-m3 + pgvector cosine (`<=>`) ANN. Same filters. Default `limit=10`. Calls `embeddings.get_service()` to embed the query (this is where the CUDA assertion can fire — see Config).
- `expand_concept.py` — loads `packages/pipeline/glossary.json` (case-insensitive lookup; cached in module). On miss returns `{found: false, suggestions: [...]}` with naive substring fuzzy matches (top 5); the agent should retry with the canonical term.
- `list_authors.py` — `q`-substring filter (case-insensitive on `name_display` + `slug`). Without `q` returns first `limit` authors; full dump is 86 rows (tolerable but the docstring nudges to pass `q`).
- `list_works.py` — works for one `author_slug`, with `topics` JSON parsed. Big-author works (Иоанн Златоуст 154, Феофан 81) without `q` are 16-32 KB JSON — docstring nudges `q` if known.

Shared helpers: `tools/_citation.py` (`parse_citation` / `make_citation`).

## Styles mechanism (`src/backend/styles/`)

Per-run response-style presets, applied via deepagents middleware before each LLM call. Spec: `feat(agent): response-style presets selectable from chat input` (commit `5b12eee`).

- **`styles/*.md`** — 4 presets: `normal.md` (empty body), `academic.md`, `explanatory.md`, `concise.md`. Each has YAML frontmatter (`name`, `description`). Body is the SystemMessage suffix appended to `MAIN_AGENT_PROMPT` for that style.
- **`styles_registry.py`** — `scan_styles(dir) -> dict[name, Style]`. Same pattern as `skills_registry`; malformed files silently skipped.
- **`styles_middleware.py`** — `StyleMiddleware(AgentMiddleware)`. Implements `wrap_model_call` + `awrap_model_call`. Reads `style_id` from `config.configurable` (via `langgraph.config.get_config()`), looks up the preset body, and APPENDS it to `request.system_message.content` (single system, not two — the OpenAI-compat API takes one `system` param). Uses `request.override(system_message=...)` per the deepagents 0.6 API. Empty body → no mutation. Unknown `style_id` → fall back to default (`normal`). No runnable context → fall back to default (defensive for unit tests).
- **`graph.py`** — `_STYLES = scan_styles(...)` at module import; `middleware=[StyleMiddleware(_STYLES)]` passed to `create_deep_agent`. Search subagent dict has NO middleware → style does not bleed into retrieval.
- **Frontend** sends `style_id` as `config.configurable.style_id` via `client.runs.stream(..., { config })`. The Next.js proxy injects `subject_key` but leaves other configurable keys untouched, so this just rides through.

## Skills mechanism (`src/backend/skills/`)

Domain-specific posture skills loaded by the main agent on demand. Ported from `trading-mcp/terminal/agent`. **Main agent only** — search subagent has no access (retrieval is its job, posture is the main agent's). Design spec: [docs/superpowers/specs/2026-05-17-skills-and-adversarial-tests-design.md](../../docs/superpowers/specs/2026-05-17-skills-and-adversarial-tests-design.md).

- **`skills_registry.py`** — `scan_skills(dir)` reads `*.md` with YAML frontmatter (`name`, `description` required; files missing either are silently skipped — one malformed file shouldn't break boot). `render_skills_registry_for_prompt(skills)` returns a compact `- name: description` block for prompt injection. Empty list → empty string.
- **`skill_tools.py`** — `build_skill_tools(*, skills) -> [invoke_skill]`. Only `invoke_skill` is exposed (registry already lives in the system prompt; runtime `list_skills` would duplicate context — explicit YAGNI). **`invoke_skill` MUST NOT raise on miss** — returns `"Skill 'X' not found. Available: [...]"` string. Same load-bearing contract as `read_passage` (langgraph cancels sibling parallel tool calls on raise → run hangs).
- **`skills/*.md`** — current skills: `apologetics.md`, `pastoral.md`. Each: YAML frontmatter (`description` = triggering signal for the agent), then sections: Когда вызывать / Posture / Запрещённые ходы / Пример. **`pastoral.md` Posture rule #3 is a safety-load-bearing guardrail**: crisis mentions (suicide, threat to life, active violence) → hotline (Russia 8-800-2000-122) + priest FIRST, citations later. Don't soften this rule. See commit `18b6d92`.
- **`graph.py`** — `_SKILLS`, `_SKILL_TOOLS`, `_MAIN_PROMPT`, `_STYLES` all computed **once at module import**. Restart the server (uvicorn `--reload` picks it up automatically) to load new/edited skill/style files. Substitution uses `str.replace`, NOT `.format` — the prompt has literal `{found: false, ...}` braces that `.format` would crash on.
- **`prompts.py`** — `{{SKILLS_REGISTRY}}` sentinel literal at the end of `MAIN_AGENT_PROMPT`. Substituted by graph.py at module import. If you rename the sentinel in one file, `.replace()` silently no-ops in the other — `tests/unit/test_prompts_wiring.py` defends the contract (sentinel-present, substitution-replaces-it, braces-preserved).
- **Frontend filter** at `apps/frontend/src/components/logos/turns.ts` hides `invoke_skill` tool calls from the `ThinkingTrace` collapse. Skill-loading is plumbing; the user doesn't need to see it.
- **Adding a new skill**: drop `name.md` with valid frontmatter into `src/backend/skills/`, restart the server. The registry render in the system prompt updates automatically; the agent decides on its own when to call `invoke_skill('name')` based on the description.

## Config (`src/backend/config.py`)

`pydantic-settings` reads `../../.env` from `REPO_ROOT = parents[4]`. Defaults:

- `postgres_dsn: "postgresql://postgres:postgres@localhost:5432/patristic"` — local docker. To point dev against prod corpus (read-only operations only — see "Common failure modes" for the budget-write caveat), set this to the prod DSN.
- `openai_api_key: ""` — required at runtime; the chat agent 401s without it.
- `openai_base_url: "https://api.openai.com/v1"` — the OpenAI-compatible endpoint URL. Any provider that speaks the OpenAI API works (override in `.env`).
- `main_agent_model: "anthropic/claude-sonnet-4-6"` / `search_agent_model: "anthropic/claude-haiku-4-5"` — the model names supported depend on the provider. Confirm with `curl -H "Authorization: Bearer $OPENAI_API_KEY" $OPENAI_BASE_URL/models`.
- `embedding_model: "BAAI/bge-m3"`, `embedding_device: "cpu"` — backend `.venv` has torch CPU-only. If `.env` sets `EMBEDDING_DEVICE=cuda` you get `AssertionError('Torch not compiled with CUDA enabled')` from `semantic_search` when it embeds the query. Bulk embeddings live in the pipeline venv which has CUDA.
- `glossary_path` → `packages/pipeline/glossary.json`; `cs_dict_path` → `packages/pipeline/cs_dict.json`.

## Running locally

The same `uvicorn backend.server:app` that ships in the container — dev and prod entry are identical, only `--reload` differs.

```
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

Frontend `.env.local` should set `NEXT_PUBLIC_API_URL=http://localhost:8000` for direct hits, or leave it unset and run through the Next.js `/api` proxy as in prod.

Integration tests target the same server via `BACKEND_URL` (default `http://localhost:8000`).

## Production

Self-hosted on Timeweb VPS (`31.130.148.190`). Image: `ghcr.io/logospatrum/backend:latest`, built by `.github/workflows/build-and-push.yml` on push to master, deployed via `docker compose pull backend && docker compose up -d backend`. See [`apps/backend/Dockerfile`](Dockerfile) and the deploy memory at `~/.claude/projects/.../memory/deploy_logospatrum.md` for the canonical deploy command sequence.

## Tests

Two suites:

- `tests/unit/` — ~95 tests, no live LLM. DB-touching ones (`test_budget_endpoint`, `test_budget_node`, `test_embeddings_service`, `test_eval_runner` adjacent DB cases, `test_expand_concept`, `test_lexical_search`, `test_list_authors`, `test_list_works`, `test_read_passage`, `test_semantic_search`) use `patristic_test` DB (NOT `patristic`). DB-free ones (`test_session_hmac`, `test_skills_registry`, `test_skill_tools`, `test_prompts_wiring`, `test_styles_registry`, `test_styles_middleware`, the `adversarial_safe`-rule cases in `test_eval_runner`) run anywhere.
- `tests/integration/` — `test_smoke.py`, `test_goldset.py`, `smoke_goldset.py`. Require a running backend on `$BACKEND_URL` (default `http://localhost:8000`) and a real LLM API key. Goldset categories + thresholds: `addressed ≥80%`, `thematic ≥60%`, `cross ≥70%`, `negative =100%`, `adversarial ≥80%` (the last one mechanically checks `forbidden_phrases` substring absence + `required_engagement` citation floor — see `eval_runner.adversarial_safe`).

**Critical: `tests/conftest.py` sets `POSTGRES_DSN=patristic_test` BEFORE `import backend`** (see lines 8–18). Otherwise tools and fixtures hit different DBs (and historically, `db_clean` wiped the production corpus — incident, see git log `ae119d5`). The TRUNCATE fixture is destructive: it runs `TRUNCATE authors, works, chapters, paragraphs, embeddings, budget_usage CASCADE` before and after each test. Never point it at `patristic`. The override is also what makes "dev backend → prod DB" safe for tests: production DSN in `.env` is shadowed by `patristic_test` during pytest.

`patristic_test` must exist with the schema applied:
```
docker exec patristic-postgres-dev psql -U postgres -c "CREATE DATABASE patristic_test"
docker exec patristic-postgres-dev psql -U postgres -d patristic_test -f /tmp/001_init.sql
docker exec patristic-postgres-dev psql -U postgres -d patristic_test -f /tmp/002_abuse_budget.sql
```

Run unit tests: `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit -v`.

`pytest.ini_options` in `pyproject.toml`: `asyncio_mode = "auto"`, `testpaths = ["tests"]`.

## Smoke harness for goldset debugging

`tests/integration/smoke_goldset.py` picks one random goldset entry per category (`addressed`, `thematic`, `cross`, `negative`) with `SEED=42`, streams each run via `langgraph_sdk` with `stream_subgraphs=True`, then `client.runs.join` + `threads.get_state(subgraphs=True)`. Writes to `apps/backend/_smoke/`. **Note**: the per-category sampler does NOT yet include `adversarial` — extend `CATEGORIES` in `smoke_goldset.py:38` if you want adversarial sampled too.

- `qN_<category>.txt` — pretty transcript (main + subagent interleaved, indented)
- `qN_<category>.json` — raw stream events
- `qN_<category>_state.json` — final checkpoint with subgraph states

Run: `BACKEND_URL=http://localhost:<port> PYTHONUTF8=1 .venv/Scripts/python -m tests.integration.smoke_goldset`. To debug a failing query, inspect `_state.json` — `tasks[].error` shows interrupts. Goldset lives at `<repo>/tests/eval/gold.yaml` and is loaded via `backend.eval_runner.load_goldset`.

## Common failure modes

- **401 from the LLM provider** → `OPENAI_API_KEY` missing/expired, or `OPENAI_BASE_URL` doesn't expose the requested model. Verify with `curl -H "Authorization: Bearer $OPENAI_API_KEY" $OPENAI_BASE_URL/models`.
- **Slow first request after a tool change** — usually sync I/O snuck into an async tool (e.g. a fresh `os.scandir`, blocking JSON load). Uvicorn won't crash, just stalls. Wrap with the async-cache pattern: pure sync function + module-level cache + `asyncio.Lock` + `await asyncio.to_thread(load_sync)`. See `expand_concept._load`, `lexical_search._cs_dict`, or `embeddings.service.get_service`.
- **AssertionError "Torch not compiled with CUDA enabled"** → `.env` has `EMBEDDING_DEVICE=cuda`, backend venv has CPU torch.
- **`passage not found` cascade** → Sonnet hallucinated short slugs. Look at the `task` tool result; main should copy citations verbatim. If main mangles slugs, the prompt regression is back — check `prompts.py` GOOD/BAD example is still present.
- **`Task group is not initialized` on every `/mcp` request** → FastMCP session manager lifespan was bypassed (someone removed the `async with _MCP.session_manager.run():` block in `server.py:lifespan`). Restore it.
- **307 redirect from `/mcp` with absolute internal Location** → the `_mcp_path_normalize` ASGI middleware was removed or registered AFTER the mount. The scope rewrite must run BEFORE `app.mount("/mcp", ...)`.
- **Prod image bloated to ~7 GB with nvidia/CUDA wheels** → the `RUN pip install --index-url https://download.pytorch.org/whl/cpu torch` line in `apps/backend/Dockerfile` was removed; without it sentence-transformers pulls the default GPU torch build. Verify the CPU-wheel preinstall is still ahead of `pip install .` in the builder stage.
- **Dev backend hitting prod DB pollutes `budget_usage`** → `budget_record` node writes to `budget_usage` on every run. Pointing `POSTGRES_DSN` at the prod DB without also setting `BUDGET_GUARD_ENABLED=false` means dev sessions count against prod's `__global_month` cap and can pause the public service. Either set the flag false for dev, or use a read-only role.
- **Empty messages list / hang** → run errored mid-flight; check the server's stdout for the traceback, or `_state.json` `tasks` field.
