# MCP-as-feature + production rollout — design

**Date:** 2026-05-17
**Scope:** Switch backend from `langgraph dev` to a proper `langgraph build`-produced image (Wolfi-based), whitelist the public API surface so only the endpoints we actually offer are reachable, expose `/mcp` as a public free feature, ship a frontend "Connect your agent" modal, publish a Claude Code plugin (`patristic-plugin`) bundling MCP + a search subagent + a routing skill, and migrate the monorepo to a new GitHub org `logospatrum` with a GHCR-based CI pipeline.
**Status:** Draft, pending user review

## Motivation

The previous spec ([anti-abuse rate limits](2026-05-16-anti-abuse-rate-limits-design.md), landed 2026-05-17) shipped HMAC + RUB-budget protection for the chat surface. Three structural problems remain:

1. **The backend still runs `langgraph dev` in production** ([apps/backend/Dockerfile](apps/backend/Dockerfile) — `CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "2024", "--no-browser"]`). `langgraph dev` is the **development server** — single-process uvicorn, in-memory checkpointer, hot-reload, debug routes. The CLI manual explicitly says "for production, use LangGraph build / LangSmith Deployment." We're shipping the dev server to prod.

2. **The Next.js proxy forwards every path** ([apps/frontend/src/app/api/[..._path]/route.ts](apps/frontend/src/app/api/[..._path]/route.ts)) as long as HMAC verifies. That means every endpoint LangGraph happens to expose — `/mcp`, `/store/*`, `/runs/crons`, `/a2a`, full thread state CRUD, `/openapi.json`, `/assistants/*` — is reachable through `/api/*`. We don't use 90% of these. They're attack surface, not features.

3. **MCP is sitting unused.** LangGraph exposes a Model-Context-Protocol Streamable-HTTP endpoint at `/mcp` that, out of the box, makes our six search/read tools (`read_passage`, `lexical_search`, `semantic_search`, `list_authors`, `list_works`, `expand_concept`) callable by any MCP-compatible client (Claude Code, Cursor, Cline, custom langchain agents). We're paying Postgres for the corpus + embeddings either way. Offering MCP for free, without authentication or quotas, is a near-zero-cost evangelism feature: third parties can wire our patristic library into their own agents.

This spec ties the three together because they touch the same files (the proxy, the compose, the nginx config), they should land in one rollout, and offering MCP publicly only makes sense after the surface is locked down so MCP is the *only* unauthenticated path that exposes anything beyond the diagnostic endpoints.

## Decisions (locked during brainstorming)

- **Backend image:** `langgraph build`-generated, base `langchain/langgraph-api:3.11`, distro `wolfi` (`"image_distro": "wolfi"` in [apps/backend/langgraph.json](apps/backend/langgraph.json)).
- **Persistence:** stay stateless. No PG checkpointer — the official prod base supports stateless graphs without bootstrapping any tables. Our `patristic` corpus DB is untouched.
- **Runtime mode:** `combined_queue_worker` (single container, default). `distributed` mode (separate orchestrator + executor + Redis) is deferred until we see real load.
- **Public endpoints (NO HMAC verify, anyone with the URL):**
  - `/api/info` — diagnostic.
  - `/api/catalog` (and subpaths) — public corpus index.
  - `/api/openapi.json` — LangGraph's OpenAPI spec, useful for MCP-client tool discovery.
  - `/api/mcp` (and subpaths) — the feature.
- **Authenticated endpoints (HMAC + RUB-budget guard + subject inject, browser only):**
  - `POST /api/runs/stream` (the only run-start path we actually use).
  - `POST /api/threads/{id}/runs/stream` (variant for stateful — currently unused but pre-allowed for if-we-ever-add-threads).
- **Frontend `/api/session`** keeps its own dedicated route.ts (Task 4.4 from the previous spec) — it's not routed through the catch-all.
- **Everything else** (`/runs/wait`, `/runs/batch`, `/runs/crons*`, `/store/*`, `/a2a`, `/threads` GET/list, `/assistants/*`, etc.) → 404 from the proxy.
- **Backend `/session/refresh`** ([apps/backend/src/backend/catalog.py](apps/backend/src/backend/catalog.py)) **deleted**. It was an impersonation vector (signed tokens for arbitrary cookie query-params) and unused by the working `/api/session` Next.js route.
- **GitHub org:** `logospatrum`. **Monorepo:** `logospatrum/logospatrum` (migration of current `christian_rag`). **Plugin repo:** `logospatrum/patristic-plugin` (public, separate, attached to monorepo as a git submodule).
- **Container registry:** GHCR (`ghcr.io/logospatrum/backend`, `ghcr.io/logospatrum/frontend`), private-by-default with read-token for prod VPS pull.
- **Deploy mechanism on MVP:** SSH into VPS, `docker compose pull && docker compose up -d`. Webhook / watchtower / auto-deploy deferred.
- **Out of scope (explicit non-goals):**
  - MCP authentication / API keys (free for all).
  - MCP quotas (rate-limit at nginx is the only line).
  - Distributed-mode scaling.
  - Auto-deploy from CI (manual SSH-pull for now).
  - Plugin marketplace listing on Anthropic-hosted directory (we publish on GitHub, users do `/plugin marketplace add <git-url>`).

## Threat model after this spec

| Threat | Mitigation |
|---|---|
| Public MCP scraping the corpus | nginx `limit_req zone=mcp_zone rate=120r/m` per IP. Beyond that — accepted cost; corpus is from azbyka.ru anyway, scraping our wrapper instead of azbyka is a wash. |
| Anonymous MCP agent burning Postgres | Same per-IP nginx rate. PG queries are cheap (indexed). |
| Direct access to `/runs/batch`, `/runs/crons`, `/store/*` to dodge budget | These now 404 at the proxy. Backend never receives the request. |
| `/session/refresh` impersonation | Backend route deleted. Frontend `/api/session` reads cookie of the calling request — can't sign for arbitrary UUIDs. |
| LangGraph adds a new endpoint in future versions we forgot to blacklist | Whitelist (not blacklist) approach — new endpoints are 404 by default until we explicitly allow them. |
| Compromised GHCR pull token on VPS | Token scoped to read-only on the specific image. Rotate via `docker login` on incident. |
| Image supply-chain compromise on base `langchain/langgraph-api` | Wolfi distro minimises packages; pin base by SHA in CI; review base-image releases. Not eliminated — accepted. |

## Architecture

### Request flow (after spec)

```
                          Internet
                             │
                             ▼
              Timeweb L3/L4  (provider)
                             │
                             ▼
              nginx :443  (TLS termination)
                • TLS + security headers
                • UA blacklist (on /api/* EXCEPT /api/mcp)
                • Origin guard (on agent runs only)
                • limit_req zones:
                    - runs_zone (6r/m) — agent runs
                    - mcp_zone (120r/m, NEW) — public MCP
                    - api_zone (60r/m) — catalog, session, openapi
                    - threads_zone (10r/m) — currently unused
                • limit_conn stream_conn — concurrent SSE
                • CORS strict
                             │
              ┌──────────────┴──────────────────────┐
              │                                     │
              ▼                                     │
       Next.js :3000                                │
         • middleware.ts: pat_uid cookie            │
         • /api/[..._path] proxy:                   │
             1. OPTIONS → 204                       │
             2. Path match against:                 │
                - PUBLIC: info, catalog/*, openapi  │
                  .json, mcp/* → forward (no HMAC)  │
                - RUN_START: runs/stream,           │
                  threads/{id}/runs/stream →        │
                  HMAC + budget gate + subject      │
                  inject → forward                  │
                - Everything else → 404             │
             3. /api/session has its own route.ts   │
                            │
                            ▼ (internal docker network only)
       langgraph-built backend :8000  ← Wolfi base
         • graphs.patristic — main agent
         • http.app — FastAPI (catalog + budget/check)
         • post-run node — RUB accounting
         • LangGraph routes: /info, /mcp, /openapi.json,
           /runs/stream, /threads/* (most unused by us),
           /store/*, /runs/crons*, /a2a (unused — proxy filters)
                            │
                            ▼
       Postgres :5432  (internal only)
         • corpus tables (authors, works, …)
         • budget_usage (anti-abuse counters)
```

Boundary: only the Next.js proxy decides what reaches backend. Backend's surface is wide (LangGraph exposes everything by default) but operationally narrowed by the proxy gatekeeper. This is layered defence — the proxy is "policy", the backend is "mechanism".

### Distribution flow (new)

```
github.com/logospatrum/logospatrum            ← monorepo (current christian_rag)
  ├── apps/backend/    → CI builds  →  ghcr.io/logospatrum/backend:<sha>
  ├── apps/frontend/   → CI builds  →  ghcr.io/logospatrum/frontend:<sha>
  └── plugins/patristic-plugin (git submodule)
       └── points at:
            github.com/logospatrum/patristic-plugin  ← standalone public repo
                                                       containing:
                                                       - .claude-plugin/plugin.json
                                                       - agents/teo-search/AGENT.md
                                                       - skills/theology-router/SKILL.md
                                                       - README.md, LICENSE

User-facing install:
  /plugin marketplace add https://github.com/logospatrum/patristic-plugin
  /plugin install patristic

Operator-facing deploy (MVP):
  ssh root@vps
  cd /opt/logospatrum
  git pull
  docker compose -f infra/docker-compose.prod.yml pull
  docker compose -f infra/docker-compose.prod.yml up -d
```

## Components

### 1. Backend prod image via `langgraph build`

[apps/backend/Dockerfile](apps/backend/Dockerfile) is **deleted**. Replaced by [apps/backend/langgraph.json](apps/backend/langgraph.json) directives that drive `langgraph build`:

```jsonc
{
  "dependencies": ["."],
  "graphs": { "patristic": "backend.graph:agent" },
  "env": "../../.env",
  "http": { "app": "backend.catalog:app" },
  "image_distro": "wolfi"
}
```

The CLI command `langgraph build -t ghcr.io/logospatrum/backend:<sha>` produces an image:
- Base: `langchain/langgraph-api:3.11` (with Wolfi userland)
- Listens on `:8000` (NOT `:2024` — that was a dev quirk)
- Binds `0.0.0.0`
- `langgraph_runtime_inmem` checkpointer (RAM, since we're stateless)
- Strips `pip`, `setuptools`, `wheel`, `uv` post-install (smaller attack surface, no shell either with Wolfi)
- `langgraph_api.server:app` via uvicorn, multi-worker production config

For the dev path (still using `langgraph dev` locally on the host machine) — nothing changes. Only the **image** for prod compose changes.

**Wolfi caveat:** sentence-transformers + bge-m3 require torch (~2GB). The Wolfi base image's lack of shell can complicate `pip install` in nested builds, but `langgraph build` handles this — it knows how to install pure-Python deps without invoking shell. Verify on first build that the image actually contains the bge-m3 weights (or that we can warm them on container start without breaking the no-shell constraint).

If Wolfi turns out to be incompatible with our deps after a build attempt, fall back to default debian-based by removing `"image_distro": "wolfi"`. The spec defaults to Wolfi; the engineer flips back if needed and documents.

### 2. Whitelist proxy

[apps/frontend/src/app/api/[..._path]/route.ts](apps/frontend/src/app/api/[..._path]/route.ts) — rewritten with explicit allow-list. Structure:

```ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

const BACKEND = process.env.LANGGRAPH_API_URL ?? "http://localhost:8000";
const SECRET = process.env.PAT_SESSION_SECRET ?? "";

// Public paths — forward without HMAC verify. The MCP endpoint is the
// product feature; the others are diagnostic / informational.
const PUBLIC_RE = /^(info|catalog(\/.*)?|openapi\.json|mcp(\/.*)?)$/;

// Authenticated run-start paths — full HMAC + budget guard + subject inject.
// Frontend uses stateless mode (`runs/stream` directly), the threads variant
// is pre-allowed for if-we-ever-add-stateful-threads.
const RUN_START_RE = /^(threads\/[^/]+\/)?runs\/stream$/;

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ _path: string[] }> },
) {
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204 });

  const { _path } = await params;
  const pathStr = _path.join("/");
  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

  // Public path → forward, no HMAC, no budget.
  if (PUBLIC_RE.test(pathStr)) {
    return passthrough(req, url);
  }

  // Run-start path → HMAC + budget + subject inject.
  if (RUN_START_RE.test(pathStr) && (req.method === "POST" || req.method === "PUT")) {
    return runStart(req, url);
  }

  // Everything else → 404. Whitelist closes by default.
  return new NextResponse(null, { status: 404 });
}

// (passthrough() and runStart() are unchanged from the previous spec's
// implementation — see Task 5.1 of 2026-05-16-anti-abuse-rate-limits-design.md.
// runStart still does: HMAC verify → /budget/check global → /budget/check
// subject → inject subject_key → forward → surface X-Budget-Warning.)

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
```

Important behaviour:
- **MCP is public.** Anyone can `curl https://<domain>/api/mcp/...` without cookies, without Origin header, without User-Agent. Only nginx-level rate limit (`mcp_zone`) constrains them.
- **OpenAPI is public.** MCP-aware clients use it for tool discovery during their own bootstrap.
- **`/info` is public.** Health checks from external monitors don't need auth.
- **Catalog is public.** It's already a free-readable corpus index (authors + works).
- **Everything else 404s.** No HMAC challenge, no error message. From a probe's perspective the endpoint doesn't exist.

### 3. nginx changes

[infra/nginx/nginx.prod.conf](infra/nginx/nginx.prod.conf) gains a new rate-limit zone and a new location block before the catch-all `/api/`:

```nginx
# In the http {} top-level block (alongside existing zones):
limit_req_zone $binary_remote_addr  zone=mcp_zone:10m   rate=120r/m;

# In the HTTPS server {} block, BEFORE `location /api/`:
location /api/mcp {
    # Public MCP — no Origin check (third-party agents call from anywhere),
    # no UA blacklist (curl/python clients are legitimate here).
    limit_req   zone=mcp_zone burst=20 nodelay;
    limit_conn  stream_conn 5;            # generous concurrent for tool-loops
    client_max_body_size 16k;             # MCP tool args are small JSON
    proxy_pass http://nextjs:3000;
    include /etc/nginx/proxy_common.conf;
    proxy_buffering off;                  # SSE-style streaming
    proxy_read_timeout 600s;
}
```

The existing `/api/` location (60r/m) handles `/api/info`, `/api/catalog`, `/api/openapi.json`, `/api/session`. The runs-specific location (`/api/threads*/runs|/api/runs*`) keeps its own zone (6r/m + 32k cap + UA + Origin guards).

### 4. Backend changes

#### 4.1 Port change

The compose backend service now listens on `:8000` (langgraph-built default), not `:2024`. Update [infra/docker-compose.prod.yml](infra/docker-compose.prod.yml):

```yaml
backend:
  image: ghcr.io/logospatrum/backend:latest
  # NO `build:` section — image is fetched from registry
  networks: [internal]
  env_file: ../.env
  environment:
    POSTGRES_DSN: postgresql://postgres:${PG_PASSWORD:-postgres}@postgres:5432/patristic
  depends_on:
    postgres:
      condition: service_healthy
```

And the Next.js env that the proxy reads:
```yaml
nextjs:
  # ...
  environment:
    LANGGRAPH_API_URL: http://backend:8000   # was :2024
    NODE_ENV: production
```

Dev (`langgraph dev` locally on host) keeps `:2024` — that's the dev-mode default. Only the **prod compose image** uses `:8000`.

#### 4.2 Remove `/session/refresh`

Delete the endpoint from [apps/backend/src/backend/catalog.py](apps/backend/src/backend/catalog.py) and its tests from `apps/backend/tests/unit/test_budget_endpoint.py` (`test_session_refresh_returns_token_for_cookie`, `test_session_refresh_500_when_no_secret`). The frontend Next.js [/api/session/route.ts](apps/frontend/src/app/api/session/route.ts) covers the same use case, reads the cookie of the calling request only, can't impersonate.

This removes ~25 lines + 2 tests. Update [CLAUDE.md](CLAUDE.md) anti-abuse section if it mentioned the backend refresh path.

### 5. Frontend "Connect to your agent" modal

New component path: `apps/frontend/src/components/connect/`.

```
apps/frontend/src/components/connect/
├── ConnectAgent.tsx     — main component: trigger pill + Radix Dialog
└── Copyable.tsx         — reusable code-block with clipboard copy button
```

`ConnectAgent.tsx` follows the existing [LibraryBrowser.tsx](apps/frontend/src/components/library/LibraryBrowser.tsx) pattern:
- Self-contained: renders its own `<Dialog.Trigger>` pill + `<Dialog.Content>`.
- Receives no required props (no business logic dependencies).
- Slotted into [LogosShell.tsx](apps/frontend/src/components/logos/LogosShell.tsx)'s `librarySlot`-style mechanism — pass through to [TopChrome](apps/frontend/src/components/logos/TopChrome.tsx) as `connectSlot`.

```tsx
// ConnectAgent.tsx, sketch
"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useStrings } from "@/components/logos/i18n";
import { Copyable } from "./Copyable";

const PLUGIN_REPO = "https://github.com/logospatrum/patristic-plugin";
const MCP_URL = `${typeof window !== "undefined" ? window.location.origin : ""}/api/mcp`;

const PLUGIN_INSTALL =
  `/plugin marketplace add ${PLUGIN_REPO}\n/plugin install patristic`;
const RAW_MCP_INSTALL =
  `claude mcp add --transport http patristic ${MCP_URL}`;
const GENERIC_JSON =
  JSON.stringify(
    { patristic: { type: "http", url: MCP_URL } },
    null,
    2,
  );

export function ConnectAgent() {
  const { s } = useStrings();
  const [tab, setTab] = useState<"claude" | "json">("claude");
  // ... renders Dialog with two tabs, Copyable blocks, links to repo
}
```

`Copyable.tsx` is ~30 lines: pre-block + button → `navigator.clipboard.writeText(text)` → Sonner toast "Скопировано".

**Trigger pill style** matches the library pill in [TopChrome.tsx](apps/frontend/src/components/logos/TopChrome.tsx). Label: "Подключить" / "Connect" (short, fits chrome).

**i18n** — new `connect.*` block in [i18n.ts](apps/frontend/src/components/logos/i18n.ts) for both ru/en:

```ts
connect: {
  trigger: "Подключить" / "Connect",
  triggerAria: "Подключить к своему агенту" / "Connect to your agent",
  title: "Подключи Patristica к своему агенту" / "Connect Patristica to your agent",
  blurb: "MCP-сервер с инструментами поиска по святоотеческой библиотеке. Бесплатно, без регистрации." /
         "MCP server with patristic-corpus search tools. Free, no signup.",
  tabClaude: "Claude Code",
  tabJson: "Другие клиенты (JSON)" / "Other clients (JSON)",
  fullPluginLabel: "Полный плагин (плюс teo-search субагент и автотриггер-скилл):" /
                   "Full plugin (with teo-search subagent and auto-trigger skill):",
  rawMcpLabel: "или только MCP, без агента и скилла:" / "or just the MCP, no agent or skill:",
  jsonBlurb: "Для Cursor, Cline, langchain и других — скопируй в свой mcpServers:" /
             "For Cursor, Cline, langchain, and others — paste into your mcpServers:",
  toolsList: "Доступные инструменты:" / "Available tools:",
  sourcesLink: "Исходники на GitHub" / "Source on GitHub",
  copied: "Скопировано" / "Copied",
},
```

The tool-list block underneath the JSON tab enumerates the 6 tools with one-line descriptions (matches the backend tool docstrings).

#### 5.1 GitHub link in BottomChrome

A small `<a>` link to the monorepo, rendered next to the existing "Корпус собран с azbyka.ru" line in [BottomChrome.tsx](apps/frontend/src/components/logos/BottomChrome.tsx). Uses the existing GitHub icon at `apps/frontend/src/components/icons/github.tsx` (already in the codebase, currently unused).

Layout sketch:
```
─────────────────────────────────────────────────────────────────
   Корпус собран с azbyka.ru  ·  [GH icon] Open source
─────────────────────────────────────────────────────────────────
```

- Target: `https://github.com/logospatrum/logospatrum`
- `target="_blank"` + `rel="noopener noreferrer"`
- Same muted style as the surrounding chrome (palette token for foreground-muted)
- New i18n keys: `bottom.github` ("Open source" / "Open source"), `bottom.githubAria` ("Open the source code on GitHub" / "Открыть исходники на GitHub")

The link is always visible on home + chat modes (BottomChrome already handles its own visibility — it fades out on chat-mode per the existing `opacity` transition).

### 6. Plugin repository (`logospatrum/patristic-plugin`)

New standalone public repo. Contents:

```
patristic-plugin/
├── .claude-plugin/
│   └── plugin.json
├── agents/
│   └── teo-search/
│       └── AGENT.md
├── skills/
│   └── theology-router/
│       └── SKILL.md
├── README.md
└── LICENSE                  (MIT)
```

#### 6.1 `plugin.json`

```json
{
  "name": "patristic",
  "version": "0.1.0",
  "description": "Russian Orthodox patristic corpus — semantic + lexical search, full-passage read, citations to azbyka.ru. ~2,100 works / 86 authors / 726K paragraphs / 1.98M embedding windows.",
  "author": {
    "name": "logospatrum",
    "url": "https://github.com/logospatrum"
  },
  "mcpServers": {
    "patristic": {
      "type": "http",
      "url": "https://logospatrum.com/api/mcp"
    }
  }
}
```

The `logospatrum.com` placeholder must be replaced with the real production domain when the repo is published. Document this in the plugin's `README.md` — "if you fork to self-host, change this URL."

#### 6.2 `agents/teo-search/AGENT.md`

```markdown
---
name: teo-search
description: Specialised search over the Russian Orthodox patristic corpus. Returns 3–8 candidate citations with short snippets. Does NOT quote or read full passages — that's the main agent's job via `read_passage`.
tools:
  - mcp__patristic__lexical_search
  - mcp__patristic__semantic_search
  - mcp__patristic__list_authors
  - mcp__patristic__list_works
  - mcp__patristic__expand_concept
---

You are a search-only subagent for the Russian Orthodox patristic corpus.

You have five MCP tools (server name: `patristic`):

- **`lexical_search`** — Postgres tsvector + ts_rank over the whole corpus.
  Best for terms with a specific verbatim form ("ипостась", "энергия",
  "нетварный", "ὁμοούσιος"). Returns matches with relevance scores.
- **`semantic_search`** — bge-m3 embeddings + pgvector cosine similarity ANN.
  Best for paraphrastic/conceptual queries ("what do the Fathers say about
  love of enemies", "passages on the uncreated light"). Returns top-k by
  vector distance.
- **`list_authors`** — full list of 86 authors with slugs, name, century,
  global section.
- **`list_works`** — works of a single author by `author_slug`, with topics
  and source URLs.
- **`expand_concept`** — resolves Church-Slavonic / archaic synonyms to
  modern Russian terms via a curated glossary. Use when the user types
  a term you suspect isn't directly in the corpus.

## Your job

Take a question. Return 3–8 candidates as a JSON-ish array:

```
[
  {
    "citation": "<author_slug/work_slug/NNNN/pX>",
    "snippet": "<≤200 char excerpt>",
    "author": "<name display>",
    "work": "<work title>",
    "relevance_hint": "<one short sentence: why this matches the question>"
  },
  ...
]
```

## What you do NOT do

- **Never quote verbatim.** You do not have `read_passage`. You only see
  ranked snippets. Anything you write is paraphrased context for the main
  agent — never present it to the user as a quote.
- **Never invent passage content.** If a `snippet` is truncated, say so
  ("(truncated — main agent should `read_passage` to see full text)").
- **Never answer the user's question directly.** Your output is consumed
  by the main agent, which will read passages and compose the answer.
- **Never normalize slugs.** Return the `citation` string exactly as the
  search tool returns it (`sokolov_tihon_zadonskij_svjatitel/sokolov_tihon_zadonskij_svjatitel_simfonija_…/0217/p42`).
  The format is `author_slug/work_slug/NNNN/pX[-Y]` where the chapter is
  zero-padded to 4 digits. Even if it looks redundant — author slug appears
  inside the work slug — that's correct, not a duplication.

## Search strategy

1. **Term-shaped query** (single term, technical theological vocabulary)
   → `lexical_search` first.
2. **Conceptual query** (paraphrastic, "what about", "explain")
   → `semantic_search` first.
3. **Broad / topical query** → run both, dedupe by `citation`, merge by
   blending top results.
4. **Slavonic or archaic term you suspect won't match** → `expand_concept`
   first, retry searches with the canonical synonym.
5. **Diversify**: pick across different authors / different centuries /
   different genres when the question is broad. Don't return five hits
   from the same work unless the question is about that specific work.

## When the corpus has nothing

If neither search returns relevant results, return an empty array `[]`
with a one-line note. Do not fabricate. The main agent will handle the
"not found" path honestly.
```

#### 6.3 `skills/theology-router/SKILL.md`

```markdown
---
name: theology-router
description: Activate when the user asks about Orthodox theology, patristics, Church Fathers, Scripture commentary, sacred tradition, councils, ascetic teaching, dogmatics, hesychasm, Palamism, Christology, Trinity, energies vs essence, or any topic where citing actual patristic sources matters. Routes search to the `teo-search` subagent (search-only, returns candidate citations) and then quotes via `mcp__patristic__read_passage` in the main loop.
---

This is a theological / patristic question. Follow this two-step pattern:

1. **Delegate the search to subagent `teo-search`.** Use the standard Task
   tool. Pass it the user's question (or a focused reformulation of it).
   It returns 3–8 candidates: `[{citation, snippet, author, work, relevance_hint}]`.
   It does NOT include full passage text — only slugs and short snippets.

2. **Read the passages you want to quote, in the main loop.** For each
   citation you plan to use in the answer, call the MCP tool
   `mcp__patristic__read_passage` directly with the citation slug. It
   returns `{text, author, work_title, chapter_num, source_url, ...}`
   — the verbatim full paragraph.

3. **Quote only from `read_passage.text`.** Never quote from the `snippet`
   field of `teo-search`'s output — snippets are truncated and may have
   been reformulated by the search subagent. If a quoted phrase doesn't
   appear verbatim in `read_passage.text`, that's a hallucination.

4. **Citation format**: `author_slug/work_slug/NNNN/pX[-Y]` exactly as
   returned by the tool. Don't simplify, don't kebab-case, don't drop
   redundant prefixes — the long form is correct.

5. **Negative results**: if `teo-search` returns `[]`, say so honestly
   ("в корпусе ничего не нашлось по этой теме") rather than answering
   from general knowledge.
```

#### 6.4 `README.md`

Plain-language intro:
- What the plugin does (one paragraph).
- One-line install: `/plugin marketplace add https://github.com/logospatrum/patristic-plugin` then `/plugin install patristic`.
- Generic MCP JSON snippet for non-Claude-Code clients.
- Tool list with one-line descriptions.
- "Hosted by `<domain>`. If you want to self-host the backend, fork and change `mcpServers.patristic.url` in `.claude-plugin/plugin.json`."
- Link back to monorepo `logospatrum/logospatrum` for backend source.
- License: MIT.

#### 6.5 Submodule wiring

In the monorepo (`logospatrum/logospatrum`), add at `plugins/patristic-plugin`:
```bash
git submodule add https://github.com/logospatrum/patristic-plugin plugins/patristic-plugin
```

`.gitmodules` documents the pointer; the actual content lives in the separate repo. Dev workflow: when iterating on the plugin, `cd plugins/patristic-plugin && git checkout -b feat-foo && ...`; commits go to the plugin repo. Monorepo only stores the submodule SHA.

### 7. CI

`.github/workflows/build-and-push.yml` (new). Single workflow with two parallel jobs (backend + frontend) since they share the trigger and the registry login.

Trigger: push to `main`, or tags `v*`.

```yaml
name: Build and push images
on:
  push:
    branches: [main]
    tags: ['v*']
permissions:
  contents: read
  packages: write

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Install langgraph-cli
        run: pip install -U "langgraph-cli[inmem]"
      - name: Build with langgraph build
        working-directory: apps/backend
        run: |
          langgraph build \
            -t ghcr.io/logospatrum/backend:${{ github.sha }} \
            -t ghcr.io/logospatrum/backend:latest
      - name: Push backend image
        run: |
          docker push ghcr.io/logospatrum/backend:${{ github.sha }}
          docker push ghcr.io/logospatrum/backend:latest

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive   # not strictly needed for build, but harmless
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build frontend image
        run: |
          docker buildx build \
            --push \
            --platform linux/amd64 \
            -f apps/frontend/Dockerfile \
            -t ghcr.io/logospatrum/frontend:${{ github.sha }} \
            -t ghcr.io/logospatrum/frontend:latest \
            apps/frontend
```

Frontend Dockerfile stays as it is (the multi-stage build from the previous spec). Backend Dockerfile is generated by `langgraph build` at CI time — we don't commit it.

### 8. Compose adjustments

[infra/docker-compose.prod.yml](infra/docker-compose.prod.yml):

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    # ... unchanged ...

  backend:
    image: ghcr.io/logospatrum/backend:latest    # was: build: ../apps/backend
    networks: [internal]
    env_file: ../.env
    environment:
      POSTGRES_DSN: postgresql://postgres:${PG_PASSWORD:-postgres}@postgres:5432/patristic
    depends_on:
      postgres:
        condition: service_healthy
    # NOTE: listens on :8000 in this image (langgraph-built default).
    # Internal docker DNS — no published port.

  nextjs:
    image: ghcr.io/logospatrum/frontend:latest   # was: build: ../apps/frontend
    networks: [internal]
    env_file: ../.env
    environment:
      LANGGRAPH_API_URL: http://backend:8000     # was http://backend:2024
      NODE_ENV: production
    depends_on: [backend]

  nginx:
    build:
      context: ./nginx
      dockerfile: Dockerfile.prod   # nginx stays local-build for now;
                                    # configs ship via envsubst at startup
    # ... unchanged ports + volumes ...
```

The user authenticates on the VPS via:
```bash
docker login ghcr.io -u <username> -p <ghcr-pull-token>
```

GHCR pull-tokens are PATs scoped to `read:packages` on the org. Document the token-generation flow in CLAUDE.md.

### 9. Monorepo migration + READMEs

The two GitHub repos (`logospatrum/logospatrum` and `logospatrum/patristic-plugin`) are already created (empty). What's left:

**Migration mechanics for the monorepo:**

1. Check current `origin` (probably the old `christian_rag` URL):
   ```
   git remote -v
   ```
2. Repoint origin and push the full history:
   ```
   git remote set-url origin git@github.com:logospatrum/logospatrum.git
   git push -u origin master
   git push origin --tags
   ```
3. Archive (don't delete) the old `christian_rag` repo via GitHub settings → "Archive this repository". Preserves history at the old URL but prevents accidental pushes.
4. Add the plugin submodule pointer:
   ```
   git submodule add git@github.com:logospatrum/patristic-plugin plugins/patristic-plugin
   git commit -m "feat: add patristic-plugin as submodule"
   git push
   ```

**CI workflow paths** reference `logospatrum/logospatrum` implicitly — GitHub Actions uses `${{ github.repository }}`. No hardcoded URL changes needed inside `.github/workflows/`.

**Monorepo README** (`README.md` at the repo root, currently absent or stub):

Replace with a real onboarding document:

```markdown
# Logospatrum — Theological Research Assistant

![ΛΟΓΟΣ main screen](docs/screenshots/main-screen.png)

Russian Orthodox patristic chat. Agentic RAG over ~2,100 works / 86 authors /
726K paragraphs / 1.98M embedding windows from azbyka.ru. Two-tier deepagents
graph (Claude Sonnet 4.6 main + Haiku 4.5 search subagent via Timeweb AI),
Postgres 16 + pgvector (semantic) + tsvector (lexical), bge-m3 embeddings,
Next.js 15 frontend.

**Live:** https://logospatrum.com

## What's here

- `apps/backend/` — LangGraph graph + FastAPI catalog/budget endpoints.
- `apps/frontend/` — Next.js 15 chat UI (Logos shell).
- `packages/pipeline/` — corpus ingest CLI (scrape, markdown, chapters,
  paragraphs, embed).
- `plugins/patristic-plugin/` — git submodule → [logospatrum/patristic-plugin](https://github.com/logospatrum/patristic-plugin).
  The Claude Code plugin third-party agents install to use our MCP.
- `infra/` — docker-compose, nginx, migrations.
- `docs/superpowers/{specs,plans}/` — design docs + implementation plans.
- `tests/eval/gold.yaml` — 53-query acceptance set.

## Quick links

- **Connect your agent (MCP):** https://logospatrum.com — click "Подключить"
  in the top bar. Or directly: `claude mcp add --transport http patristic https://logospatrum.com/api/mcp`.
- **Plugin repo:** https://github.com/logospatrum/patristic-plugin
- **Backend internals:** [apps/backend/CLAUDE.md](apps/backend/CLAUDE.md)
- **Frontend internals:** [apps/frontend/CLAUDE.md](apps/frontend/CLAUDE.md)
- **Pipeline (data ingest):** [packages/pipeline/](packages/pipeline/)
- **Root project notes:** [CLAUDE.md](CLAUDE.md)

## Local dev

Prereqs: Docker + WSL2 (Windows), Python 3.13, Node 20.

```bash
# Postgres (pgvector)
wsl -e bash -c "cd $(pwd)/infra && docker compose -f docker-compose.dev.yml up -d postgres"

# Backend (LangGraph dev server)
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser

# Frontend
cd apps/frontend && PORT=3001 npm run dev
```

## License

(decide — MIT? AGPL? proprietary?)
```

The screenshot file lives at `docs/screenshots/main-screen.png` and is captured manually:
- 1920×1080 viewport
- Light theme on, EN or RU is fine (use RU since it's the primary audience)
- Home screen with the Monolith input visible, Logo + Quote + Starters
- Browser chrome cropped

**Plugin repo README** (`README.md` in `logospatrum/patristic-plugin`):

```markdown
# Patristica — Claude Code plugin

Russian Orthodox patristic corpus search and citation tools for any
MCP-capable agent. Backed by [logospatrum/logospatrum](https://github.com/logospatrum/logospatrum).

## Install (Claude Code)

```
/plugin marketplace add https://github.com/logospatrum/patristic-plugin
/plugin install patristic
```

This installs:
- **MCP server** `patristic` (HTTP, `https://logospatrum.com/api/mcp`) —
  six tools: `read_passage`, `lexical_search`, `semantic_search`,
  `list_authors`, `list_works`, `expand_concept`.
- **Subagent** `teo-search` — search-only, returns candidate citations
  with snippets. Cannot quote directly (no `read_passage` in its toolset).
- **Skill** `theology-router` — auto-activates on patristic/theological
  questions, routes search to `teo-search` then quotes via
  `mcp__patristic__read_passage` in the main loop.

## Install (other clients)

For Cursor, Cline, langchain-mcp-adapters, custom agents — paste into your
`mcpServers` config:

```json
{
  "patristic": {
    "type": "http",
    "url": "https://logospatrum.com/api/mcp"
  }
}
```

Or just register the MCP without subagent/skill via Claude Code CLI:

```
claude mcp add --transport http patristic https://logospatrum.com/api/mcp
```

## Tools

| Tool | What it does |
|------|--------------|
| `read_passage` | Verbatim paragraph by citation slug, with metadata (author, work, chapter, source URL). |
| `lexical_search` | Postgres tsvector + ts_rank search; best for verbatim terms. |
| `semantic_search` | bge-m3 + pgvector cosine; best for paraphrastic/conceptual queries. |
| `list_authors` | All 86 authors with slugs, name, century, section. |
| `list_works` | Works of one author by `author_slug`. |
| `expand_concept` | Resolve Church-Slavonic / archaic synonyms via glossary. |

## Why a subagent + skill, not just the MCP?

The agent contract enforced by the backend: **search returns candidates,
main reads passages, never quote without `read_passage`**. The subagent
restricts itself to search tools so it can't cheat. The skill teaches your
main loop the two-step pattern automatically.

If you don't want the subagent/skill — install just the MCP via
`claude mcp add` above.

## Self-hosting

The plugin's MCP URL points at `https://logospatrum.com`. If you fork and
run your own backend, change `mcpServers.patristic.url` in
`.claude-plugin/plugin.json`.

## License

MIT.
```

Both READMEs ship in their respective repos. The monorepo's README references the screenshot path; the screenshot is committed to `docs/screenshots/main-screen.png`.

## Configuration

New / changed env vars:

| Var | Where | Default | Notes |
|---|---|---|---|
| `LANGGRAPH_API_URL` | Next.js prod compose | `http://backend:8000` | Was `:2024` — port changed because langgraph-built image listens on 8000. Dev (`langgraph dev` locally) keeps `:2024`. |
| `GHCR_USERNAME`, `GHCR_TOKEN` | VPS (for `docker login`) | (required at deploy time) | PAT with `read:packages`. Rotate via GitHub settings. |

`.env.example` and CLAUDE.md updated.

## Error responses

| Status | When | Body |
|---|---|---|
| `204` | `OPTIONS` preflight (any path) | empty |
| `401` | HMAC verify failed on `/runs/stream` | `{"error":"session_invalid"}` |
| `403` | Origin/UA blocked at nginx (runs paths only) | empty |
| `404` | Whitelist miss in proxy | empty (proxy returns bare 404) |
| `413` | Body > 32k on `/runs*` (nginx) | nginx default |
| `429` | nginx `limit_req` OR daily budget | varies (see anti-abuse spec) |
| `503` | Global monthly budget OR backend down | varies |

The whitelist returns bare 404 (no JSON body) deliberately — probes can't distinguish "doesn't exist" from "exists but is blocked."

## Acceptance criteria

Smoke checks against `docker compose -f infra/docker-compose.prod.yml up -d --build` (assume `.env` has `PAT_SESSION_SECRET`, `ALLOWED_ORIGIN=https://localhost`, `LANGGRAPH_API_URL=http://backend:8000`):

- [ ] **1. MCP is reachable without HMAC.**
  ```
  curl -ki -X POST https://localhost/api/mcp \
    -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
  Expect: 200 with JSON listing 6 tools (`read_passage`, `lexical_search`, `semantic_search`, `list_authors`, `list_works`, `expand_concept`).

- [ ] **2. MCP rate-limited by IP.** Run the request 121 times in a minute → 121st returns `HTTP/2 429`.

- [ ] **3. `/api/openapi.json` is reachable without HMAC.** Returns a JSON OpenAPI 3.x document.

- [ ] **4. `/api/catalog` works without HMAC.** Returns the existing authors+works tree.

- [ ] **5. Blocked endpoints return 404.** Each of these → `HTTP/2 404` with empty body:
  ```
  curl -ki https://localhost/api/store/items
  curl -ki -X POST https://localhost/api/runs/batch -d '{}'
  curl -ki -X POST https://localhost/api/runs/crons -d '{}'
  curl -ki https://localhost/api/threads
  curl -ki https://localhost/api/a2a
  curl -ki https://localhost/api/assistants
  ```

- [ ] **6. Browser chat still works.** Open `https://logospatrum.com/` incognito, send a chat message, get a response. Verify `pat_uid` cookie + `<meta name="pat-session">` + a successful `/api/runs/stream` round-trip with `X-Budget-Warning` header surfacing where applicable.

- [ ] **7. ConnectAgent modal shows correct commands.** Click "Подключить" pill in TopChrome → modal opens → Claude Code tab shows `claude mcp add ...` and `/plugin marketplace add ...` commands with the live domain. JSON tab shows the literal config. Copy buttons work (Sonner toast appears).

- [ ] **8. Plugin install works end-to-end.** In a separate Claude Code instance:
  ```
  /plugin marketplace add https://github.com/logospatrum/patristic-plugin
  /plugin install patristic
  ```
  Then in a session: ask "что говорят святые отцы о любви к врагам" → skill activates → main agent delegates to `teo-search` → reads passages → cites correctly.

- [ ] **9. Raw `claude mcp add` works (no plugin).** Issue `claude mcp add --transport http patristic https://logospatrum.com/api/mcp` in fresh shell → ask a question that prompts tool use → Claude finds and calls our tools.

- [ ] **10. CI green on push to main.** GitHub Actions runs both `backend` and `frontend` jobs, both publish to GHCR with `:latest` + `:<sha>` tags. `docker pull ghcr.io/logospatrum/backend:latest` from the VPS works after `docker login`.

- [ ] **11. Backend port-change rollover (Stage 2 only).** After `docker compose pull && docker compose up -d` with the new langgraph-built image, exec into the nextjs container and `curl -s http://backend:8000/info` returns a JSON `{"flags": …}` payload. The old `:2024` is no longer bound inside the backend container. Until Stage 2 lands, `LANGGRAPH_API_URL` stays at `:2024` and this check is N/A.

## Tests

- Backend: existing unit tests pass unchanged. Delete `test_session_refresh_*` (Task 2.3 removal). No new backend unit tests — the proxy is the new logic and lives in TypeScript.
- Frontend: extend [vitest](apps/frontend/vitest.config.ts) with one new test file covering the proxy's whitelist routing:
  - `apps/frontend/src/app/api/[..._path]/__tests__/route.test.ts` — mocks `fetch`, exercises: public path forwards, run-start path goes through HMAC+budget, blacklist-by-default returns 404.
- Plugin: no automated tests (it's content, not code). Smoke = check #8 above.

## Rollout / rollback

1. **Stage 1 (no user impact):** Land backend lockdown changes (`/session/refresh` deletion, proxy whitelist) and verify smoke checks #1–#6 still pass with the existing `apps/backend/Dockerfile`-built image. This proves the surface change is correct independent of the prod-image swap.

2. **Stage 2 (image swap):** Update `langgraph.json` + delete `apps/backend/Dockerfile`. Run `langgraph build` locally first to verify Wolfi compatibility. If Wolfi breaks (sentence-transformers etc.), fall back to debian (`"image_distro"` removed) and document the why. Push the working image to GHCR, switch compose to `image:` reference, verify smoke #11.

3. **Stage 3 (plugin + modal):** Land plugin repo + monorepo modal + i18n. Smoke #7–#9.

4. **Stage 4 (CI):** Land the workflow file. Verify on a test branch first. Document the SSH-pull recipe in CLAUDE.md.

Rollback knobs:
- **Image rollback:** `docker compose pull ghcr.io/logospatrum/backend:<previous-sha>` then `up -d backend`.
- **Whitelist disable:** revert the proxy to its pre-spec version (full-passthrough with HMAC). One file revert.
- **Budget guard disable:** existing `BUDGET_GUARD_ENABLED=false` knob still works.
- **Plugin yank:** remove from GitHub or update `plugin.json` to disable `mcpServers` block. Existing installs see the MCP server fail to connect and gracefully degrade.

## Files touched

**New:**
- `docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md` (this file)
- `apps/frontend/src/components/connect/ConnectAgent.tsx`
- `apps/frontend/src/components/connect/Copyable.tsx`
- `apps/frontend/src/app/api/[..._path]/__tests__/route.test.ts`
- `.github/workflows/build-and-push.yml`
- `docs/screenshots/main-screen.png` (1920×1080 capture of home screen, RU lang, light on)
- `README.md` (root — rewritten from stub to real onboarding doc; see section 9)
- `plugins/patristic-plugin/` (git submodule pointer; content in separate repo)

**New in separate repo (`logospatrum/patristic-plugin`):**
- `.claude-plugin/plugin.json`
- `agents/teo-search/AGENT.md`
- `skills/theology-router/SKILL.md`
- `README.md` (full install + usage; see section 9)
- `LICENSE` (MIT)

**Modified:**
- `apps/backend/langgraph.json` — add `image_distro: wolfi`
- `apps/backend/src/backend/catalog.py` — remove `/session/refresh` endpoint
- `apps/backend/tests/unit/test_budget_endpoint.py` — remove 2 session tests
- `apps/frontend/src/app/api/[..._path]/route.ts` — whitelist routing
- `apps/frontend/src/components/logos/i18n.ts` — `connect.*` block + `bottom.github*` keys (ru + en)
- `apps/frontend/src/components/logos/LogosShell.tsx` — `connectSlot` mount
- `apps/frontend/src/components/logos/TopChrome.tsx` — render `connectSlot`
- `apps/frontend/src/components/logos/BottomChrome.tsx` — add GitHub link next to azbyka line (section 5.1)
- `infra/nginx/nginx.prod.conf` — `mcp_zone` zone + `/api/mcp` location
- `infra/docker-compose.prod.yml` — `image:` references, port 8000
- `infra/SMOKE_ANTI_ABUSE.md` — update for new whitelist behaviour (some checks change)
- `.env.example` — document `GHCR_USERNAME`/`GHCR_TOKEN`
- `CLAUDE.md` — section on production rollout (CI, SSH-pull, GHCR auth)

**Deleted:**
- `apps/backend/Dockerfile` — replaced by `langgraph build`

## Open questions / follow-ups (NOT this spec)

- **Watchtower / webhook auto-deploy.** Manual SSH-pull is MVP. When deploy frequency rises, automate.
- **MCP usage telemetry.** Currently we have no view into who's using `/mcp` or how heavily. Postgres query log + nginx access log are the raw signals; a small dashboard would help validate the "free feature, low cost" hypothesis. Out of scope.
- **Plugin versioning.** When we change tool signatures, plugin installs go stale. `plugin.json:version` should match what's in the repo; bump on tool changes; advise users via README / GitHub releases. Out of scope.
- **Cross-language MCP smoke.** Verify against Claude Code, Cursor, Cline, langchain-mcp-adapters manually after deploy. Out of automated tests.
- **`langgraph up` for local prod-image testing.** Before the first GHCR push, the engineer should run `langgraph up` locally and confirm the image works against our existing PG. Document the procedure.
