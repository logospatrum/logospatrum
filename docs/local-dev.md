# Local development

Prereqs: Docker, Python 3.13, Node 20.

Two Python virtualenvs by design — keep them separate:

- `apps/backend/.venv` — CPU torch (LangGraph dev server, FastAPI).
- `packages/pipeline/.venv` — CUDA torch (bge-m3 embedding on GPU).

Two `.env` files by design — do **not** sync them:

- `/.env` — backend + frontend. See [`.env.example`](../.env.example).
- `/packages/pipeline/.env` — pipeline-local (`EMBEDDING_DEVICE=cuda`).

## Postgres (pgvector)

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
```

Apply schema to both prod and test databases:

```bash
docker exec -i patristic-postgres-dev psql -U postgres -d patristic      < infra/migrations/001_init.sql
docker exec -i patristic-postgres-dev psql -U postgres -d patristic_test < infra/migrations/001_init.sql
# repeat for 002_abuse_budget.sql
```

## Backend (LangGraph dev server)

```bash
cd apps/backend
.venv/bin/langgraph dev --port 2024 --no-browser
```

Open http://localhost:2024 for LangGraph Studio.

## Frontend (Next.js)

```bash
cd apps/frontend
PORT=3001 npm run dev
```

Dev runs on port **3001**, not 3000 — see [`apps/frontend/CLAUDE.md`](../apps/frontend/CLAUDE.md).

## Pipeline (corpus ingest)

```bash
cd packages/pipeline
.venv/bin/python -m pipeline --help
```

Subcommands: `scrape`, `download`, `markdown-convert`, `bible-markdown`,
`paragraphs`, `embed`, `concepts-bootstrap`, `enrich`, `diagnose`.

`embed` is resumable by default; pass `--from-scratch` to truncate.

## Tests

Backend unit tests:

```bash
cd apps/backend && .venv/bin/python -m pytest tests/unit/ -v
```

Goldset (integration, requires `langgraph dev` running):

```bash
cd apps/backend && .venv/bin/python -m pytest tests/integration/test_goldset.py -v -s
```

53-query acceptance set at [`tests/eval/gold.yaml`](../tests/eval/gold.yaml).
Pass thresholds: addressed ≥80%, thematic ≥60%, cross ≥70%, negative =100%.

## Windows

Development was done on Windows with WSL2 Docker. If you're on Windows,
see the Windows-specific notes in [`CLAUDE.md`](../CLAUDE.md) — event-loop
policy, psycopg-pool timeout, `PYTHONUTF8=1` for Cyrillic, `langgraph dev`
orphan workers, venv `Scripts/` vs `bin/`.
