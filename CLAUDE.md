# christian_rag — Claude Code notes

Russian patristic chat MVP. Agentic RAG over Russian Orthodox patristic corpus from azbyka.ru (~2,097 works / 86 authors / 726K paragraphs / ~1.98M embedding windows). Stack: LangGraph Server + deepagents (Sonnet 4.6 main + Haiku 4.5 search subagent via Timeweb AI proxy), Postgres 16 + pgvector + tsvector, bge-m3 embeddings, Next.js 15 frontend forked from `langchain-ai/agent-chat-ui`.

## Layout

- `packages/pipeline/` — data ingest CLI. Subcommands (see `pipeline/__main__.py`): `scrape` (in `scrape.py`, no typer cmd yet — invoke module directly), `download`, `markdown-convert`, `bible-markdown`, `paragraphs`, `embed`, `concepts-bootstrap`, `enrich`, `diagnose`. Own `.venv` (cuda torch). Own `.env`.
- `apps/backend/` — LangGraph graph `backend.graph:agent` + FastAPI catalog mounted at `/catalog` (see `langgraph.json`). Own `.venv` (cpu torch). Reads root `.env` (`langgraph.json` declares `"env": "../../.env"`).
- `apps/frontend/` — Next.js 15 fork of `agent-chat-ui`.
- `infra/docker-compose.dev.yml` — pgvector/pgvector:pg16 container `patristic-postgres-dev`, db `patristic`, user/pass `postgres/postgres`, port 5432.
- `infra/migrations/001_init.sql` — schema (extensions: vector, pg_trgm; tables: authors, works, chapters, paragraphs, embeddings…).
- `tests/eval/gold.yaml` — 53 acceptance queries. Thresholds: addressed ≥80%, thematic ≥60%, cross ≥70%, negative =100%.
- `STATUS.md` — running progress doc.

## Two .env files — do NOT sync

- `/.env` — root. Backend + frontend read this. Has `TIMEWEB_AI_KEY`, `MAIN_AGENT_MODEL` (Timeweb proxy caps at `claude-sonnet-4-6` — no 4-7, confirmed via `GET /v1/models` 2026-05-16; see `apps/backend/src/backend/config.py:21`), `SEARCH_AGENT_MODEL=anthropic/claude-haiku-4-5`, `EMBEDDING_DEVICE=cpu`, `POSTGRES_DSN`, `NEXT_PUBLIC_*`, plus anti-abuse vars (`PAT_SESSION_SECRET`, `DOMAIN`, `ALLOWED_ORIGIN`, `DAILY_RUB_PER_*`, `GLOBAL_MONTHLY_KILL_RUB`, `BUDGET_GUARD_ENABLED`). Gitignored. See `.env.example`.
- `/packages/pipeline/.env` — pipeline-local. `EMBEDDING_DEVICE=cuda` for RTX 5070 Ti (torch+cu128). Pipeline `.venv` has cuda torch; backend `.venv` has cpu torch — keep them separate.

## Windows-specific gotchas (all hit and fixed)

- `asyncio.set_event_loop_policy(WindowsSelectorEventLoopPolicy())` required on Py 3.13 for psycopg-pool. Already set in `packages/pipeline/pipeline/__main__.py:5` and `apps/backend/src/backend/__init__.py:7`.
- `AsyncConnectionPool` needs `kwargs={"connect_timeout": 10}` — without it, `pool.open()` hangs forever and raises empty `PoolTimeout` (psycopg-pool 3.3.x worker bug). See `packages/pipeline/pipeline/db.py:19` and `apps/backend/src/backend/db.py:19`.
- `PYTHONUTF8=1` required for typer `--help` with Cyrillic docstrings (otherwise `UnicodeEncodeError`).
- After `taskkill /F` on `langgraph dev`, Windows holds the TCP port in LISTEN state with the killed PID for several minutes. Use the next port (one session cycled 2024 → 2030).
- WSL2 docker (not Docker Desktop) holds Postgres. WSL VM auto-suspends if idle; keep alive with backgrounded `wsl -e bash -c "sleep infinity"` if you don't want reconnect lag. Reachable from Windows at `localhost:5432`.

## Hidden invariants — do NOT break

1. **Citation format is sacred**: `author_slug/work_slug/NNNN/pX[-Y]`, chapter zero-padded to 4. Slugs are long underscore transliterations, e.g. `sokolov_tihon_zadonskij_svjatitel/sokolov_tihon_zadonskij_svjatitel_simfonija_po_tvorenijam_svjatitelja_tihona_zadonskogo/0217/p42`. The work_slug starts with the full author_slug — that is correct, not a duplication. See `apps/backend/src/backend/tools/_citation.py` for `make_citation`/`parse_citation`. `MAIN_AGENT_PROMPT` in `apps/backend/src/backend/prompts.py` has a GOOD/BAD example because the model wants to "prettify" these (dashes, drop the prefix). Search subagent must return citations verbatim from search results; main agent must copy verbatim into `read_passage`.

2. **`read_passage` MUST NOT raise on miss**. Returns `{found: false, error, work_exists, citation}` instead. See `apps/backend/src/backend/tools/read_passage.py` and its docstring. Reason: deepagents fires parallel tool calls; LangGraph's cancel-on-failure kills siblings when one raises and the run hangs forever.

3. **`embed` is resumable by default**; `--from-scratch` truncates `embeddings`. Encoder buffers 1024 windows then sorts by text length before batching (saves ~3-5× on bge-m3 padding). `fp16=True` and `max_seq_length=512` are defaults. See `packages/pipeline/pipeline/embed.py:140-145`. Resume key set built by `_load_done_keys` (line 56).

4. **Bible epubs go through `pipeline bible-markdown`, NOT `markdown-convert`**. The general converter explicitly skips `data/Bible/` (`packages/pipeline/pipeline/markdown_convert.py:23-30`). Bible md frontmatter has `bible_verse` (not `author`); `paragraphs.py` has a Bible-specific branch via `_ingest_bible` / `_is_bible_path` (line ~201+). Bible work slug is `bible_<book_slug>`.

5. **Backend test DB must be `patristic_test`, never prod `patristic`**. `db_clean` fixture TRUNCATEs all tables. `apps/backend/tests/conftest.py:16` sets `os.environ["POSTGRES_DSN"]` to test DSN BEFORE `import backend` so `pydantic-settings` picks up the test DB; tools and fixtures then share the same DB. If you reorder imports, prod corpus dies.

## Quick-start

Verify against the actual scripts before running — these are the verified shapes as of writing.

- **DB**: `wsl -e bash -c "cd <repo>/infra && docker compose -f docker-compose.dev.yml up -d postgres"`, then apply `infra/migrations/001_init.sql` (also create `patristic_test` db with the same schema for tests).
- **Pipeline**: `cd packages/pipeline && PYTHONUTF8=1 .venv/Scripts/python -m pipeline <command>`. `--help` lists commands.
- **Backend**: `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser`. (`--allow-blocking` is no longer required — sync file I/O in tools and the embedding service is wrapped in `asyncio.to_thread`. See `apps/backend/CLAUDE.md` if BlockingError returns.)
- **Frontend**: `cd apps/frontend && npm run dev`.
- **Unit tests (backend)**: `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v`.
- **Goldset (integration)**: start `langgraph dev`, then `pytest tests/integration/test_goldset.py -v -s`.

## Where to look first when something breaks

- LangGraph dev tracebacks: its stdout log. SSE stream errors come back as `event=error data={error,message}`.
- `apps/backend/_smoke/q{1..4}_*.txt` — last smoke transcripts (addressed / thematic / cross / negative). `*_state.json` has final checkpoint with `tasks` (interrupts/errors) and full message list.
- Postgres queries: `docker exec patristic-postgres-dev psql -U postgres -d patristic -c "<sql>"`.
- If author/work slugs in `gold.yaml` don't match: re-check against `SELECT slug FROM authors` / `SELECT slug FROM works` after a fresh `paragraphs` run — `slugify()` output depends on real folder names in `output/`.

## Anti-abuse / RUB budget (added 2026-05-17)

Public-anonymous chat is gated by a layered defence — see [docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md](docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md) and the smoke checklist at [infra/SMOKE_ANTI_ABUSE.md](infra/SMOKE_ANTI_ABUSE.md).

- **In prod (`infra/docker-compose.prod.yml`), the frontend MUST hit LangGraph through Next.js `/api/*` proxy, not directly.** `NEXT_PUBLIC_API_URL=/api` (relative) routes the browser through the HMAC + budget guard. Setting it to `http://localhost:2024` bypasses anti-abuse entirely.
- Backend is bound to the internal docker network in prod — no published ports. Only `nginx` exposes 80/443.
- New table: `budget_usage(subject_key, bucket, used_rub, updated_at)` — `subject_key` is `cookie:<uuid>` / `ip:<addr>` / `__global_month` / `__unknown__`; `bucket` is `YYYY-MM-DD` (daily, MSK) or `YYYY-MM` (monthly). Apply `infra/migrations/002_abuse_budget.sql` to both `patristic` and `patristic_test`.
- HMAC session token formula is symmetric across Python (`backend.budget.session.sign`), Next.js middleware/layout (`node:crypto.createHmac`), the custom proxy at `/api/[..._path]/route.ts`, and the `/api/session` refresh endpoint. Input: `cookie:<uuid>:<UTC_date>`. Output: `base64url` WITHOUT padding (43 chars). Tests pin a Node-compat vector at `apps/backend/tests/unit/test_session_hmac.py::test_known_node_compatible_vector`.
- Rotating `PAT_SESSION_SECRET` invalidates all open browser tabs (next request → 401 → silent `/api/session` refresh if cookie is still valid; otherwise hard reload).
- Kill switch: `BUDGET_GUARD_ENABLED=false` makes `/budget/check` always return `allowed=true` AND makes the post-run accounting node no-op. Use as rollback.
- Tariffs in `apps/backend/src/backend/budget/pricing.py` are hardcoded Timeweb prices as of 2026-05-16. Update there if Timeweb changes them.

## Production rollout (added 2026-05-17)

Backend image is built by GitHub Actions and pushed to GHCR — see [docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md](docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md).

- **CI** (`.github/workflows/build-and-push.yml`): on push to `master`/`main` or `v*` tag, two parallel jobs build:
  - `ghcr.io/logospatrum/backend:<sha>` + `:latest` via `langgraph build` (Wolfi distro, base `langchain/langgraph-api:3.11`, listens on `:8000`).
  - `ghcr.io/logospatrum/frontend:<sha>` + `:latest` via `apps/frontend/Dockerfile`.
- **VPS deploy (MVP, manual SSH-pull)**:
  ```
  ssh root@<vps>
  cd /opt/logospatrum
  git pull
  docker login ghcr.io -u $GHCR_USERNAME -p $GHCR_TOKEN     # read:packages PAT
  docker compose -f infra/docker-compose.prod.yml pull
  docker compose -f infra/docker-compose.prod.yml up -d
  ```
- **API surface**: the Next.js `/api/[..._path]/route.ts` is a whitelist proxy. Only `/info`, `/catalog`, `/openapi.json`, `/mcp` (public, no HMAC), and `/runs/stream` (HMAC + budget + subject inject) reach the backend. Everything else 404s — including `/store/*`, `/runs/batch`, `/runs/crons`, `/a2a`. New LangGraph endpoints are 404 by default.
- **Plugin**: `logospatrum/patristic-plugin` is a git submodule at `plugins/patristic-plugin`. Iterate on it inside that checkout; commits go to the plugin repo. Monorepo only tracks its SHA.
- **Domain hardcoded in plugin**: `https://logospatrum.com/api/mcp`. If you move the prod domain, update `plugins/patristic-plugin/.claude-plugin/plugin.json` and re-publish the plugin repo.
- **Backend port**: prod compose listens on `:8000` (langgraph-built default). `langgraph dev` locally on the host keeps `:2024`. Only the prod image changed; dev flow unchanged.
- **Wolfi caveat**: if CI build fails on native deps (sentence-transformers/torch), drop `"image_distro": "wolfi"` from `apps/backend/langgraph.json` to fall back to debian-based.

## Don't

- Don't proactively create `*.md` (incl. README) unless asked.
- Don't commit unless asked.
- Don't merge the two `.env`s.
- Don't run backend tests against prod `patristic` DB.
- Don't shorten or "prettify" citation slugs.
