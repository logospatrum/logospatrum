# MCP-as-feature + production rollout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-ify the backend (replace `langgraph dev` with `langgraph build`-produced Wolfi image), lock down the public API surface to a whitelist (only `/info`, `/catalog`, `/openapi.json`, `/mcp`, `/runs/stream` reachable), ship a frontend "Connect to your agent" modal + GitHub link, publish a Claude Code plugin at `logospatrum/patristic-plugin` bundling MCP + `teo-search` subagent + `theology-router` skill, migrate the monorepo to `logospatrum/logospatrum`, and stand up CI that builds + pushes both images to GHCR.

**Architecture:** Backend image switches to `langchain/langgraph-api:3.11` (Wolfi distro). Next.js `[..._path]/route.ts` becomes a strict allow-list proxy. MCP endpoint is free + public, rate-limited only by per-IP nginx zone. Plugin repo is a standalone public repo, attached to monorepo as a git submodule. CI is two parallel GitHub Actions jobs pushing to `ghcr.io/logospatrum/{backend,frontend}`. VPS pulls manually via SSH on MVP.

**Tech Stack:** LangGraph CLI (`langgraph build`), Wolfi-based Python 3.11 base image, GHCR, GitHub Actions, nginx 1.25+ (envsubst templates), Next.js 15 App Router with Node-runtime route handlers, Radix Dialog, Sonner, git submodules, Docker Compose.

**Ship-gate:** Each phase leaves a working system. Phases 1-3 (backend lockdown + image swap + compose) ship together to prod via SSH-pull. Phase 4 (frontend) ships next. Phases 5-7 (plugin) ship independently. Phase 8 (CI) can land any time after migration.

---

## Файловая структура после плана

```
logospatrum/logospatrum (monorepo, was christian_rag)
├── .github/
│   └── workflows/
│       └── build-and-push.yml          # NEW — CI for both images
├── README.md                            # REWRITE — onboarding + screenshot
├── docs/
│   ├── screenshots/
│   │   └── main-screen.png             # NEW — 1920×1080 capture
│   └── superpowers/{specs,plans}/...   # existing
├── apps/backend/
│   ├── Dockerfile                       # DELETE — replaced by langgraph build
│   ├── langgraph.json                   # MODIFY — add image_distro: wolfi
│   └── src/backend/catalog.py           # MODIFY — remove /session/refresh
│       tests/unit/test_budget_endpoint.py  # MODIFY — remove 2 session tests
├── apps/frontend/
│   ├── src/
│   │   ├── app/api/[..._path]/
│   │   │   ├── route.ts                 # REWRITE — whitelist routing
│   │   │   └── __tests__/route.test.ts  # NEW — proxy whitelist tests
│   │   └── components/
│   │       ├── connect/
│   │       │   ├── ConnectAgent.tsx     # NEW — trigger + Radix Dialog
│   │       │   └── Copyable.tsx         # NEW — code-block with copy button
│   │       └── logos/
│   │           ├── i18n.ts              # MODIFY — connect.*, bottom.github*
│   │           ├── LogosShell.tsx       # MODIFY — connectSlot mount
│   │           ├── TopChrome.tsx        # MODIFY — render connectSlot
│   │           └── BottomChrome.tsx     # MODIFY — GitHub link
├── plugins/
│   └── patristic-plugin/                # NEW — git submodule
│       (content lives in logospatrum/patristic-plugin)
├── infra/
│   ├── nginx/nginx.prod.conf            # MODIFY — mcp_zone + /api/mcp loc
│   ├── docker-compose.prod.yml          # MODIFY — image: refs, port 8000
│   └── SMOKE_ANTI_ABUSE.md              # MODIFY — whitelist behaviour
├── .env.example                         # MODIFY — GHCR_* vars
└── CLAUDE.md                            # MODIFY — prod rollout section

logospatrum/patristic-plugin (separate public repo)
├── .claude-plugin/plugin.json           # NEW
├── agents/teo-search/AGENT.md           # NEW
├── skills/theology-router/SKILL.md      # NEW
├── README.md                            # NEW — install + tools
└── LICENSE                              # NEW — MIT
```

---

## Phase 0 — Setup

### Task 0.1: Capture baseline + create branch

**Files:** none (git ops only).

- [ ] **Step 1: Verify clean state**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git status --short
```

Expected: only untracked artifacts (build outputs, foreign canonical-law-corpus docs). No uncommitted modifications to files we'll touch.

- [ ] **Step 2: Note baseline HEAD**

```bash
git rev-parse HEAD
```

Record this SHA; if anything goes wrong end-to-end, this is the safe rollback target.

- [ ] **Step 3: Branch**

```bash
git checkout -b feat/mcp-prod-rollout
```

All Phase 1-9 work happens on this branch. Phase 10 (smoke) is the merge gate.

---

### Task 0.2: Migrate monorepo to `logospatrum/logospatrum`

**Files:** none (git ops only).

- [ ] **Step 1: Inspect current origin**

```bash
git remote -v
```

Expected: shows old `christian_rag` URL (e.g. `git@github.com:<old-user>/christian_rag.git`).

- [ ] **Step 2: Repoint origin**

```bash
git remote set-url origin git@github.com:logospatrum/logospatrum.git
git remote -v
```

Expected: both `fetch` and `push` lines now point at `logospatrum/logospatrum`.

- [ ] **Step 3: Push the full default-branch history**

```bash
git push -u origin master
```

(Repo's default branch is `master` per current state — use `main` only if the user has renamed since.)

Expected: full history (~hundreds of commits) lands on GitHub. The `feat/mcp-prod-rollout` branch is NOT yet pushed.

- [ ] **Step 4: Push tags**

```bash
git push origin --tags
```

- [ ] **Step 5: Verify on GitHub**

Open `https://github.com/logospatrum/logospatrum` in browser. The repo should show recent commits including `fc1f608` (anti-abuse docs commit from yesterday). Tags should be visible under "Releases".

- [ ] **Step 6: Archive old repo (manual via GitHub UI)**

Navigate to old `christian_rag` settings → "Archive this repository". This prevents accidental pushes to the dead URL while preserving its history. Don't delete — old links / forks survive.

---

### Task 0.3: Verify GHCR auth works (manual sanity check, not committed)

**Files:** none.

- [ ] **Step 1: Generate a GitHub PAT scoped to packages**

In `https://github.com/settings/tokens` → "Fine-grained tokens" or classic → permission: `write:packages`. Save the token.

- [ ] **Step 2: Login locally**

```bash
echo <YOUR_PAT> | docker login ghcr.io -u <YOUR_USERNAME> --password-stdin
```

Expected: `Login Succeeded`. The CI job uses the auto-provisioned `GITHUB_TOKEN` so no PAT lands in the repo — this step is only to verify your local push works (will be used in Phase 4 for the first manual push).

- [ ] **Step 3: Save VPS pull-token**

Generate a second PAT scoped to `read:packages` only. Save it as `GHCR_TOKEN` (you'll set this on the VPS at deploy time, NOT committed). This is documented in `.env.example` (Phase 10).

---

## Phase 1 — Backend API surface lockdown

After Phase 1 the backend is **still on `langgraph dev`** (old Dockerfile) but the proxy already enforces the whitelist. Image swap is Phase 2. This split makes Phase 1 risk-free — purely TypeScript edits + backend route removal.

### Task 1.1: Remove backend `/session/refresh` endpoint + tests

**Files:**
- Modify: `apps/backend/src/backend/catalog.py`
- Modify: `apps/backend/tests/unit/test_budget_endpoint.py`

- [ ] **Step 1: Open `catalog.py`, remove the `session_refresh` endpoint**

Find the `@app.get("/session/refresh")` block (the function `session_refresh(cookie: str)` and its preceding 5–10 lines). Delete the whole function. Also remove `from .budget import session as sess` from the top-level imports if no other code in the file uses it (grep first).

```bash
grep -n "sess\." apps/backend/src/backend/catalog.py
```

If `grep` returns nothing → safe to remove the import. If it returns lines → leave the import alone.

- [ ] **Step 2: Remove the two session tests**

In `apps/backend/tests/unit/test_budget_endpoint.py` delete:
- `test_session_refresh_returns_token_for_cookie`
- `test_session_refresh_500_when_no_secret`

These are at the bottom of the file (~30 lines combined).

- [ ] **Step 3: Run remaining tests, verify still pass**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_endpoint.py --tb=short
```

Expected: 7 passed (was 9; removed 2). Run takes ~2 min (backend import overhead).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/backend/src/backend/catalog.py apps/backend/tests/unit/test_budget_endpoint.py
git commit -m "fix(backend): remove /session/refresh — impersonation vector, unused

The endpoint signed an HMAC token for arbitrary cookie= query params.
With a valid token for cookie A, an attacker could mint tokens for
any cookie B. Frontend /api/session route.ts reads the cookie of the
calling request only — same job, no impersonation. Two tests removed
alongside."
```

---

### Task 1.2: Rewrite proxy as whitelist

**Files:**
- Modify: `apps/frontend/src/app/api/[..._path]/route.ts`

- [ ] **Step 1: Read current route.ts state**

```bash
cat apps/frontend/src/app/api/[..._path]/route.ts
```

Note current size (~178 lines per anti-abuse spec). Existing `handle()` does HMAC verify on everything except `/info`, then routes based on `isRunStart` regex.

- [ ] **Step 2: Replace the routing logic with whitelist**

Edit the file:

a) Above the `handle()` function, add two named regexes (replace the old single-purpose regex):

```ts
// Public paths — forwarded without HMAC verify. MCP is the product feature;
// the others are diagnostic / public corpus index.
const PUBLIC_RE = /^(info|catalog(\/.*)?|openapi\.json|mcp(\/.*)?)$/;

// Authenticated run-start paths — full HMAC + budget guard + subject inject.
// Frontend uses stateless `runs/stream`; the threads/{id}/runs/stream variant
// is pre-allowed for if we ever add stateful threading.
const RUN_START_RE = /^(threads\/[^/]+\/)?runs\/stream$/;
```

b) Remove the previous `RUN_START_RE` / `isInfo` if present. Then replace the body of `handle()` (after `if (req.method === "OPTIONS")` early-return) with:

```ts
const { _path } = await params;
const pathStr = _path.join("/");
const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

// Public path — forward, no HMAC, no budget.
if (PUBLIC_RE.test(pathStr)) {
  return passthrough(req, url);
}

// Run-start path — HMAC verify + budget guard + subject inject.
if (RUN_START_RE.test(pathStr) && (req.method === "POST" || req.method === "PUT")) {
  return runStart(req, url);
}

// Everything else — 404. Whitelist closes by default.
return new NextResponse(null, { status: 404 });
```

c) Extract the existing HMAC+budget+subject-inject logic into a `runStart()` async function. Extract the plain forward (with budget-warning header surfacing) into a `passthrough()` async function. Both take `(req: NextRequest, url: string)`.

Both helper functions already exist as inline code in current `handle()` — this is a refactor, not new logic.

- [ ] **Step 3: TypeScript compiles**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Run frontend tests**

```bash
npm test
```

Expected: 83 passed (no test regressions; new test for route.ts is Task 1.3).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/app/api/[..._path]/route.ts
git commit -m "feat(frontend): API proxy whitelist — public /mcp, /info, /catalog, /openapi.json

Everything else 404s by default. Run-start paths (/runs/stream and
/threads/{id}/runs/stream) keep HMAC+budget+subject-inject. Closes
attack surface on /runs/batch, /runs/crons*, /store/*, /a2a, /assistants/*,
and any future LangGraph endpoint we forget to blacklist."
```

---

### Task 1.3: Add proxy whitelist tests

**Files:**
- Create: `apps/frontend/src/app/api/[..._path]/__tests__/route.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// apps/frontend/src/app/api/[..._path]/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock node:crypto BEFORE importing the route (HMAC verify uses it).
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { default: actual, ...actual };
});

// Mock fetch globally.
global.fetch = vi.fn();

import { handle } from "../route";  // assumes handle is exported; if not, use POST/GET exports

function mkRequest(method: string, path: string, opts: { cookie?: string; session?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", `pat_uid=${opts.cookie}`);
  if (opts.session) headers.set("x-pat-session", opts.session);
  if (opts.origin) headers.set("origin", opts.origin);
  return {
    method,
    headers,
    nextUrl: { search: "" } as URL,
    cookies: { get: (k: string) => (k === "pat_uid" && opts.cookie ? { value: opts.cookie } : undefined) },
    text: async () => "{}",
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Parameters<typeof handle>[0];
}

function mkParams(path: string) {
  return { params: Promise.resolve({ _path: path.split("/") }) };
}

describe("proxy whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PAT_SESSION_SECRET = "test-secret-64-chars-long-test-secret-64-chars-long-test-se";
    process.env.LANGGRAPH_API_URL = "http://backend:8000";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{"allowed":true,"used_rub":0,"limit_rub":500,"warn":false,"reset_at":"2026-05-18T00:00:00+03:00"}'),
    );
  });

  it("forwards /info without HMAC", async () => {
    const res = await handle(mkRequest("GET", "info"), mkParams("info"));
    expect(res.status).not.toBe(401);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/info"), expect.anything());
  });

  it("forwards /mcp without HMAC", async () => {
    const res = await handle(mkRequest("POST", "mcp"), mkParams("mcp"));
    expect(res.status).not.toBe(401);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/mcp"), expect.anything());
  });

  it("forwards /catalog without HMAC", async () => {
    const res = await handle(mkRequest("GET", "catalog"), mkParams("catalog"));
    expect(res.status).not.toBe(401);
  });

  it("forwards /openapi.json without HMAC", async () => {
    const res = await handle(mkRequest("GET", "openapi.json"), mkParams("openapi.json"));
    expect(res.status).not.toBe(401);
  });

  it("404s /store/items (blacklist-by-default)", async () => {
    const res = await handle(mkRequest("PUT", "store/items"), mkParams("store/items"));
    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("404s /runs/batch (not in whitelist)", async () => {
    const res = await handle(mkRequest("POST", "runs/batch"), mkParams("runs/batch"));
    expect(res.status).toBe(404);
  });

  it("404s /runs/crons (not in whitelist)", async () => {
    const res = await handle(mkRequest("POST", "runs/crons"), mkParams("runs/crons"));
    expect(res.status).toBe(404);
  });

  it("404s /threads (list endpoint not whitelisted)", async () => {
    const res = await handle(mkRequest("GET", "threads"), mkParams("threads"));
    expect(res.status).toBe(404);
  });

  it("requires HMAC for /runs/stream (no session → 401)", async () => {
    const res = await handle(mkRequest("POST", "runs/stream"), mkParams("runs/stream"));
    expect(res.status).toBe(401);
  });

  it("OPTIONS passes through with 204", async () => {
    const res = await handle(mkRequest("OPTIONS", "anything/at/all"), mkParams("anything/at/all"));
    expect(res.status).toBe(204);
  });
});
```

If `handle` is not currently exported from the route file, export it (or export a separate `routeHandler` and have the HTTP exports delegate to it). This is needed for unit testing — vitest can't easily call a Next.js route handler indirectly.

- [ ] **Step 2: Ensure `handle` is exported from route.ts**

In `apps/frontend/src/app/api/[..._path]/route.ts`, the existing pattern is `export const GET = handle; export const POST = handle; ...`. Change `async function handle(...)` to `export async function handle(...)`. The existing exports still work.

- [ ] **Step 3: Run vitest**

```bash
cd apps/frontend && npm test
```

Expected: 83 + 10 = 93 passed.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/app/api/[..._path]/route.ts apps/frontend/src/app/api/[..._path]/__tests__/route.test.ts
git commit -m "test(frontend): whitelist routing — 10 cases covering public + auth + 404"
```

---

## Phase 2 — `langgraph build` prod image

After Phase 2 the prod compose pulls from GHCR. Wolfi distro engaged.

### Task 2.1: Add `image_distro: wolfi` to `langgraph.json`

**Files:**
- Modify: `apps/backend/langgraph.json`

- [ ] **Step 1: Edit `langgraph.json`**

Add `"image_distro": "wolfi"` to the top-level object:

```json
{
  "dependencies": ["."],
  "graphs": { "patristic": "backend.graph:agent" },
  "env": "../../.env",
  "http": { "app": "backend.catalog:app" },
  "image_distro": "wolfi"
}
```

- [ ] **Step 2: Validate**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph validate
```

Expected: `✅ Configuration validated!` (the previous warning about Wolfi recommendation should no longer fire).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/backend/langgraph.json
git commit -m "feat(backend): opt langgraph.json into Wolfi distro for prod image"
```

---

### Task 2.2: Build prod image locally to verify Wolfi compatibility

**Files:** no commits this task — verification only.

- [ ] **Step 1: Run `langgraph build`**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph build -t logospatrum-backend:test
```

Expected: image builds, ends with `Successfully tagged logospatrum-backend:test`. May take 5-15 min (downloads `langchain/langgraph-api:3.11`, installs deps, caches bge-m3 weights).

If Wolfi fails on a native dep (sentence-transformers / torch), revert `image_distro` from `langgraph.json` and retry with default debian-based. Document the why in a follow-up commit.

- [ ] **Step 2: Inspect the image**

```bash
docker image inspect logospatrum-backend:test --format='{{.Config.Cmd}} {{.Config.WorkingDir}} {{.Config.ExposedPorts}}'
```

Expected: shows a CMD (uvicorn-based), WorkingDir `/deps/backend`, exposed port `8000/tcp`.

- [ ] **Step 3: Smoke-run the container against the dev Postgres**

```bash
docker run --rm -p 8000:8000 \
  --network host \
  -e POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/patristic \
  -e PAT_SESSION_SECRET=$(openssl rand -hex 32) \
  -e TIMEWEB_AI_KEY=dummy \
  logospatrum-backend:test
```

Wait for "Application startup complete" or similar. In another terminal:

```bash
curl -s http://localhost:8000/info | head -3
curl -s http://localhost:8000/openapi.json | head -3
```

Expected: both return JSON (info has version metadata, openapi.json has full spec).

`Ctrl+C` to stop the container.

- [ ] **Step 4: Note observations**

If anything weird happened (Wolfi failed, bge-m3 not bundled, port differs), document inline in a small `infra/PROD_IMAGE_NOTES.md` you'll commit at the end of Phase 2.

---

### Task 2.3: Delete `apps/backend/Dockerfile`

**Files:**
- Delete: `apps/backend/Dockerfile`

- [ ] **Step 1: Remove the file**

```bash
git rm apps/backend/Dockerfile
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(backend): delete hand-rolled Dockerfile — replaced by langgraph build

The prod backend image is now produced by `langgraph build` (which uses
langchain/langgraph-api:3.11 as base with Wolfi distro). Dev workflow
(langgraph dev locally on host) is unchanged."
```

---

## Phase 3 — Compose + nginx + port wiring

### Task 3.1: Swap backend service to `image:` reference, port 8000

**Files:**
- Modify: `infra/docker-compose.prod.yml`

- [ ] **Step 1: Open `infra/docker-compose.prod.yml`**

Find the `backend:` service. Replace:

```yaml
backend:
  build:
    context: ../apps/backend
    dockerfile: Dockerfile
  networks: [internal]
  env_file: ../.env
  environment:
    POSTGRES_DSN: postgresql://postgres:${PG_PASSWORD:-postgres}@postgres:5432/patristic
  depends_on:
    postgres:
      condition: service_healthy
```

With:

```yaml
backend:
  image: ghcr.io/logospatrum/backend:latest
  # NOTE: listens on :8000 (langgraph-built default), not :2024.
  networks: [internal]
  env_file: ../.env
  environment:
    POSTGRES_DSN: postgresql://postgres:${PG_PASSWORD:-postgres}@postgres:5432/patristic
  depends_on:
    postgres:
      condition: service_healthy
```

- [ ] **Step 2: Update the `nextjs` service env**

Find the `nextjs:` block. Change `LANGGRAPH_API_URL`:

```yaml
nextjs:
  image: ghcr.io/logospatrum/frontend:latest
  networks: [internal]
  env_file: ../.env
  environment:
    LANGGRAPH_API_URL: http://backend:8000   # was :2024
    NODE_ENV: production
  depends_on: [backend]
```

(The build → image swap for `nextjs` mirrors backend; we also use a GHCR-pulled frontend image.)

- [ ] **Step 3: Validate the compose syntax**

```bash
cd infra && docker compose -f docker-compose.prod.yml config > /dev/null ; echo "EXIT=$?"
```

Expected: `EXIT=0` (no parsing errors). It may complain that the image doesn't exist yet — that's fine, `config` doesn't pull.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add infra/docker-compose.prod.yml
git commit -m "feat(infra): prod compose pulls images from GHCR, backend on :8000

Backend and frontend are now both image: refs to ghcr.io/logospatrum/*.
LANGGRAPH_API_URL inside the nextjs container moves from :2024 to :8000
because the langgraph-built image listens on the LangGraph default port."
```

---

### Task 3.2: Add `mcp_zone` + `/api/mcp` location to nginx

**Files:**
- Modify: `infra/nginx/nginx.prod.conf`

- [ ] **Step 1: Add the rate-limit zone**

In `infra/nginx/nginx.prod.conf`, find the section with `limit_req_zone` declarations (near the top, after the `events {}` block if present, or at top-level if rendered via envsubst). Add:

```nginx
limit_req_zone  $binary_remote_addr  zone=mcp_zone:10m   rate=120r/m;
```

Right alongside `runs_zone`, `threads_zone`, `api_zone`.

- [ ] **Step 2: Add the `/api/mcp` location**

In the HTTPS server block, **before** the catch-all `location /api/` block, add:

```nginx
location /api/mcp {
    # Public MCP — no Origin check (third-party agents call from anywhere),
    # no UA blacklist (curl/python clients are legitimate here).
    limit_req   zone=mcp_zone burst=20 nodelay;
    limit_conn  stream_conn 5;
    client_max_body_size 16k;
    proxy_pass http://nextjs:3000;
    include /etc/nginx/proxy_common.conf;
    proxy_buffering off;
    proxy_read_timeout 600s;
}
```

The order matters — nginx matches locations by prefix-then-regex; `/api/mcp` more-specific must come before generic `/api/`.

- [ ] **Step 3: Quick syntax check (envsubst-rendered)**

```bash
docker run --rm \
  -v "$(pwd)/infra/nginx/nginx.prod.conf:/etc/nginx/templates/default.conf.template:ro" \
  -v "$(pwd)/infra/nginx/proxy_common.conf:/etc/nginx/proxy_common.conf:ro" \
  -e DOMAIN=test.local \
  -e ALLOWED_ORIGIN=https://test.local \
  nginx:alpine \
  sh -c "envsubst '\$DOMAIN \$ALLOWED_ORIGIN' < /etc/nginx/templates/default.conf.template > /tmp/r.conf && nginx -t -c /tmp/r.conf 2>&1 | tail -3"
```

Expected: `nginx: configuration file /tmp/r.conf test is successful`.

- [ ] **Step 4: Commit**

```bash
git add infra/nginx/nginx.prod.conf
git commit -m "feat(infra): nginx /api/mcp public location + mcp_zone rate limit

120 r/m per IP. No Origin guard. No UA blacklist. SSE-friendly
(proxy_buffering off, 600s read timeout). Sits before the generic
/api/ location so it matches first."
```

---

### Task 3.3: Update `.env.example` with GHCR vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append GHCR section**

Edit `.env.example`, append at the end:

```
# === Container registry (VPS deploy only) ===
# PAT scoped to `read:packages` on the logospatrum org. Required at deploy
# time for `docker login ghcr.io`. NOT used by the running stack.
GHCR_USERNAME=
GHCR_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(.env.example): GHCR credentials for prod deploy"
```

---

## Phase 4 — CI pipeline

### Task 4.1: Create CI workflow

**Files:**
- Create: `.github/workflows/build-and-push.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
# .github/workflows/build-and-push.yml
name: Build and push images

on:
  push:
    branches: [master, main]
    tags: ['v*']

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  ORG: logospatrum

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install langgraph-cli
        run: pip install -U "langgraph-cli[inmem]"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build backend image via langgraph build
        working-directory: apps/backend
        run: |
          langgraph build \
            -t ${REGISTRY}/${ORG}/backend:${{ github.sha }} \
            -t ${REGISTRY}/${ORG}/backend:latest
        env:
          REGISTRY: ${{ env.REGISTRY }}
          ORG: ${{ env.ORG }}

      - name: Push backend image
        run: |
          docker push ${REGISTRY}/${ORG}/backend:${{ github.sha }}
          docker push ${REGISTRY}/${ORG}/backend:latest
        env:
          REGISTRY: ${{ env.REGISTRY }}
          ORG: ${{ env.ORG }}

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push frontend image
        run: |
          docker buildx build \
            --push \
            --platform linux/amd64 \
            -f apps/frontend/Dockerfile \
            -t ${REGISTRY}/${ORG}/frontend:${{ github.sha }} \
            -t ${REGISTRY}/${ORG}/frontend:latest \
            apps/frontend
        env:
          REGISTRY: ${{ env.REGISTRY }}
          ORG: ${{ env.ORG }}
```

- [ ] **Step 2: Validate locally with `act` (optional but recommended)**

If `act` (https://github.com/nektos/act) is installed:

```bash
act -j backend --container-architecture linux/amd64 -n  # dry-run
```

Skip if `act` not installed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-and-push.yml
git commit -m "ci: GitHub Actions — build backend (via langgraph build) + frontend, push to GHCR

Two parallel jobs. Triggers on master/main push + v* tags. Uses
auto-provisioned GITHUB_TOKEN for GHCR auth. Tags both :latest and :<sha>."
```

- [ ] **Step 4: Push the branch and watch the workflow**

```bash
git push -u origin feat/mcp-prod-rollout
```

The workflow won't run on a feature branch (matcher is `master`/`main`/tags). But you can manually trigger via GitHub UI → Actions → Run workflow. Or merge to master at end of plan, and verify the run.

---

## Phase 5 — Frontend Connect modal

### Task 5.1: `Copyable.tsx` — reusable code-block with copy button

**Files:**
- Create: `apps/frontend/src/components/connect/Copyable.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/frontend/src/components/connect/Copyable.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { palette, type } from "@/components/logos/tokens";
import { useStrings } from "@/components/logos/i18n";

export interface CopyableProps {
  /** Text to display + copy to clipboard. Multi-line OK. */
  text: string;
  /** Optional aria-label override for the copy button. */
  copyAriaLabel?: string;
}

export function Copyable({ text, copyAriaLabel }: CopyableProps) {
  const { s } = useStrings();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(s.connect.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(0,0,0,0.25)",
        border: `1px solid ${palette.faint}`,
        borderRadius: 4,
        padding: "12px 40px 12px 14px",
        fontFamily: type.mono,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: palette.body,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {text}
      <button
        onClick={onCopy}
        aria-label={copyAriaLabel ?? s.connect.copyAria}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          padding: "2px 8px",
          background: copied ? palette.bodyMuted : "transparent",
          border: `1px solid ${palette.faint}`,
          borderRadius: 3,
          color: copied ? palette.bg : palette.body,
          fontFamily: type.mono,
          fontSize: 11,
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
      >
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}
```

Note: this uses `palette` tokens from `@/components/logos/tokens`. If the exact token names (`palette.body`, `palette.bg`, `palette.faint`, `palette.bodyMuted`) don't exist, open `apps/frontend/src/components/logos/tokens.ts` and substitute with the closest names; the existing components there will give you the canonical token list.

- [ ] **Step 2: TS check**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`. If it complains about missing token names, fix the substitutions inline.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/components/connect/Copyable.tsx
git commit -m "feat(frontend): Copyable component — code block with clipboard button"
```

---

### Task 5.2: i18n keys for connect modal

**Files:**
- Modify: `apps/frontend/src/components/logos/i18n.ts`

- [ ] **Step 1: Add `connect` block to RU dict**

Find the closing brace of the RU `errors:` block (around line 82). Just after it (still inside the RU object), add:

```ts
    connect: {
      trigger: "Подключить",
      triggerAria: "Подключить к своему агенту",
      title: "Подключи Patristica к своему агенту",
      blurb: "MCP-сервер с инструментами поиска по святоотеческой библиотеке. Бесплатно, без регистрации.",
      tabClaude: "Claude Code",
      tabJson: "Другие клиенты (JSON)",
      fullPluginLabel: "Полный плагин (плюс teo-search субагент и автотриггер-скилл):",
      rawMcpLabel: "или только MCP, без агента и скилла:",
      jsonBlurb: "Для Cursor, Cline, langchain и других — скопируй в свой mcpServers:",
      toolsList: "Доступные инструменты:",
      sourcesLink: "Исходники на GitHub",
      sourcesAria: "Открыть репозиторий плагина",
      copyAria: "Скопировать",
      copied: "Скопировано",
    },
```

- [ ] **Step 2: Add `connect` block to EN dict**

Same structure, English. Find the closing brace of the EN `errors:` block (around line 158, mirrors RU position):

```ts
    connect: {
      trigger: "Connect",
      triggerAria: "Connect to your agent",
      title: "Connect Patristica to your agent",
      blurb: "MCP server with patristic-corpus search tools. Free, no signup.",
      tabClaude: "Claude Code",
      tabJson: "Other clients (JSON)",
      fullPluginLabel: "Full plugin (with teo-search subagent and auto-trigger skill):",
      rawMcpLabel: "or just the MCP, no agent or skill:",
      jsonBlurb: "For Cursor, Cline, langchain, and others — paste into your mcpServers:",
      toolsList: "Available tools:",
      sourcesLink: "Source on GitHub",
      sourcesAria: "Open the plugin repository",
      copyAria: "Copy",
      copied: "Copied",
    },
```

- [ ] **Step 3: Add `bottom.github*` keys (both languages)**

In the RU `bottom:` block (currently `bottom: { corpus: "Корпус собран с azbyka.ru" },`), expand to:

```ts
    bottom: {
      corpus: "Корпус собран с azbyka.ru",
      github: "Open source",
      githubAria: "Открыть исходники на GitHub",
    },
```

Same change for EN `bottom:`:

```ts
    bottom: {
      corpus: "Corpus sourced from azbyka.ru",
      github: "Open source",
      githubAria: "Open the source code on GitHub",
    },
```

- [ ] **Step 4: TS check**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`. The `Strings` type derives from `STRINGS`, so adding keys is type-safe; usages later will benefit from the new entries.

- [ ] **Step 5: Run existing tests**

```bash
npm test -- i18n
```

Expected: green (i18n tests pin format, not exact key set).

- [ ] **Step 6: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/components/logos/i18n.ts
git commit -m "feat(frontend): i18n — connect.* block + bottom.github keys (ru/en)"
```

---

### Task 5.3: `ConnectAgent.tsx` — modal + trigger

**Files:**
- Create: `apps/frontend/src/components/connect/ConnectAgent.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/frontend/src/components/connect/ConnectAgent.tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { palette, type } from "@/components/logos/tokens";
import { useStrings } from "@/components/logos/i18n";
import { Copyable } from "./Copyable";

const PLUGIN_REPO = "https://github.com/logospatrum/patristic-plugin";

const TOOLS: ReadonlyArray<{ name: string; ru: string; en: string }> = [
  { name: "read_passage",    ru: "Verbatim параграф по слугу + метаданные",                en: "Verbatim paragraph by slug, with metadata" },
  { name: "lexical_search",  ru: "Postgres tsvector + ts_rank — для дословных терминов",    en: "Postgres tsvector + ts_rank — best for verbatim terms" },
  { name: "semantic_search", ru: "bge-m3 + pgvector cosine — для смысловых запросов",       en: "bge-m3 + pgvector cosine — best for conceptual queries" },
  { name: "list_authors",    ru: "Список всех 86 авторов",                                  en: "All 86 authors with slugs and metadata" },
  { name: "list_works",      ru: "Работы одного автора по slug",                            en: "Works of one author by slug" },
  { name: "expand_concept",  ru: "Расширение церковнославянизмов через глоссарий",          en: "Resolve Church-Slavonic synonyms via glossary" },
];

export function ConnectAgent() {
  const { s, lang } = useStrings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"claude" | "json">("claude");

  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://logospatrum.com/api/mcp";
    return `${window.location.origin}/api/mcp`;
  }, [open]);

  const pluginInstall =
    `/plugin marketplace add ${PLUGIN_REPO}\n/plugin install patristic`;
  const rawMcpInstall =
    `claude mcp add --transport http patristic ${mcpUrl}`;
  const genericJson = JSON.stringify(
    { patristic: { type: "http", url: mcpUrl } },
    null,
    2,
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          aria-label={s.connect.triggerAria}
          style={{
            padding: "6px 14px",
            background: "transparent",
            border: `1px solid ${palette.faint}`,
            borderRadius: 999,
            color: palette.body,
            fontFamily: type.mono,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {s.connect.trigger}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className="logos-library-overlay"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 50 }}
        />
        <Dialog.Content
          className="logos-library-content"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 51,
            width: "min(640px, 92vw)",
            maxHeight: "85vh",
            overflowY: "auto",
            background: palette.bg,
            border: `1px solid ${palette.faint}`,
            borderRadius: 8,
            padding: "28px 32px",
            color: palette.body,
            fontFamily: type.body,
          }}
        >
          <Dialog.Title
            style={{ fontFamily: type.display, fontSize: 22, marginBottom: 8 }}
          >
            {s.connect.title}
          </Dialog.Title>
          <Dialog.Description
            style={{ fontSize: 13, marginBottom: 24, color: palette.bodyMuted }}
          >
            {s.connect.blurb}
          </Dialog.Description>

          <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button
              role="tab"
              aria-selected={tab === "claude"}
              onClick={() => setTab("claude")}
              style={tabBtnStyle(tab === "claude")}
            >
              {s.connect.tabClaude}
            </button>
            <button
              role="tab"
              aria-selected={tab === "json"}
              onClick={() => setTab("json")}
              style={tabBtnStyle(tab === "json")}
            >
              {s.connect.tabJson}
            </button>
          </div>

          {tab === "claude" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, marginBottom: 8 }}>{s.connect.fullPluginLabel}</p>
                <Copyable text={pluginInstall} />
              </div>
              <div>
                <p style={{ fontSize: 13, marginBottom: 8 }}>{s.connect.rawMcpLabel}</p>
                <Copyable text={rawMcpInstall} />
              </div>
            </div>
          )}

          {tab === "json" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13 }}>{s.connect.jsonBlurb}</p>
              <Copyable text={genericJson} />
              <div>
                <p style={{ fontSize: 13, marginBottom: 8, marginTop: 8 }}>{s.connect.toolsList}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5 }}>
                  {TOOLS.map((t) => (
                    <li key={t.name} style={{ padding: "4px 0", borderBottom: `1px solid ${palette.faint}` }}>
                      <code style={{ fontFamily: type.mono, color: palette.body }}>{t.name}</code>
                      &nbsp;—&nbsp;
                      <span style={{ color: palette.bodyMuted }}>{lang === "ru" ? t.ru : t.en}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, fontSize: 12, color: palette.bodyMuted }}>
            <a
              href={PLUGIN_REPO}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.connect.sourcesAria}
              style={{ color: palette.body, textDecoration: "underline" }}
            >
              {s.connect.sourcesLink}
            </a>
          </div>

          <Dialog.Close asChild>
            <button
              aria-label="Close"
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                background: "transparent",
                border: 0,
                color: palette.body,
                fontSize: 20,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    background: active ? palette.bodyMuted : "transparent",
    border: `1px solid ${palette.faint}`,
    borderRadius: 4,
    color: active ? palette.bg : palette.body,
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
  };
}
```

If the existing `LibraryBrowser` uses different CSS class names than `logos-library-overlay` / `logos-library-content`, copy whatever class names it uses for visual consistency (those classes are defined in `logos.css` — check the existing pattern and match).

- [ ] **Step 2: TS check**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`. Address any palette/type missing-property errors by aligning with `tokens.ts` exports.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/components/connect/ConnectAgent.tsx
git commit -m "feat(frontend): ConnectAgent modal — Claude Code + JSON tabs, tools list"
```

---

### Task 5.4: Mount ConnectAgent in TopChrome via slot

**Files:**
- Modify: `apps/frontend/src/components/logos/TopChrome.tsx`
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`

- [ ] **Step 1: Add `connectSlot` prop to `TopChrome`**

In [TopChrome.tsx](apps/frontend/src/components/logos/TopChrome.tsx), find the props interface (likely around line 14). Add:

```ts
  /** Optional slot for the Connect-agent trigger — rendered inline next to
   *  the Library pill so ConnectAgent keeps its own Radix dialog while
   *  looking like part of the chrome. */
  connectSlot?: React.ReactNode;
```

In the props destructure (line ~27), add `connectSlot`. In the JSX (the line that renders `librarySlot` — around line 74), add the connect slot after library:

```tsx
{!isNarrow && librarySlot}
{!isNarrow && connectSlot}
```

- [ ] **Step 2: Mount `<ConnectAgent />` in LogosShell**

In [LogosShell.tsx](apps/frontend/src/components/logos/LogosShell.tsx):

a) Import:

```ts
import { ConnectAgent } from "@/components/connect/ConnectAgent";
```

b) Where `librarySlot` is created (around line 319):

```tsx
const librarySlot = (
  <LibraryBrowser
    // ... existing props
  />
);
const connectSlot = <ConnectAgent />;
```

c) Pass `connectSlot` to TopChrome alongside `librarySlot` (around line 368):

```tsx
<TopChrome
  inChat={inChat}
  onHome={goHome}
  lightOn={lightOn}
  onToggleLight={toggleLight}
  lang={lang}
  onLangChange={setLang}
  librarySlot={librarySlot}
  connectSlot={connectSlot}
/>
```

- [ ] **Step 3: TS check**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Manual smoke (npm run dev)**

```bash
cd apps/frontend && PORT=3001 npm run dev
```

Open `http://localhost:3001`, see:
- A new "Подключить" pill in the top chrome next to the library button.
- Click it → modal opens with two tabs (Claude Code | Другие клиенты (JSON)).
- Tab switching works.
- Copy buttons copy text to clipboard and show "Скопировано" Sonner toast.
- "Исходники на GitHub" link opens `https://github.com/logospatrum/patristic-plugin` in a new tab.
- × button closes the modal.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/components/logos/TopChrome.tsx apps/frontend/src/components/logos/LogosShell.tsx
git commit -m "feat(frontend): wire ConnectAgent into TopChrome via connectSlot"
```

---

## Phase 6 — GitHub link in BottomChrome

### Task 6.1: Add GitHub link to BottomChrome

**Files:**
- Modify: `apps/frontend/src/components/logos/BottomChrome.tsx`

- [ ] **Step 1: Open `BottomChrome.tsx`**

The current return is a `<footer>` with two `<span>` children. The left span shows `{s.bottom.corpus}`. We'll wrap that span in a flex container holding both the corpus text and the GitHub link.

- [ ] **Step 2: Import the GitHub icon**

Add to the top:

```ts
import { GitHubSVG } from "@/components/icons/github";
```

- [ ] **Step 3: Replace the left span**

Find:

```tsx
<span>{s.bottom.corpus}</span>
```

Replace with:

```tsx
<span style={{ display: "inline-flex", alignItems: "center", gap: 16, pointerEvents: "auto" }}>
  {s.bottom.corpus}
  <a
    href="https://github.com/logospatrum/logospatrum"
    target="_blank"
    rel="noopener noreferrer"
    aria-label={s.bottom.githubAria}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      color: "inherit",
      textDecoration: "none",
      opacity: 0.7,
      transition: "opacity 120ms ease",
    }}
    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
  >
    <span style={{ width: 12, height: 12, display: "inline-block" }}>
      <GitHubSVG width="100%" height="100%" />
    </span>
    {s.bottom.github}
  </a>
</span>
```

Note `pointerEvents: "auto"` overrides the footer's `pointerEvents: "none"` so the link is clickable.

- [ ] **Step 4: TS check**

```bash
cd apps/frontend && npx tsc --noEmit ; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Manual smoke**

Refresh `http://localhost:3001`, look at the bottom-left corner. You should see:

```
КОРПУС СОБРАН С AZBYKA.RU  · [gh-icon] OPEN SOURCE
```

Click the link → opens `github.com/logospatrum/logospatrum` in new tab.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
git add apps/frontend/src/components/logos/BottomChrome.tsx
git commit -m "feat(frontend): GitHub link in BottomChrome — points at the monorepo"
```

---

## Phase 7 — Plugin repository content

This phase works in a **separate git clone** of `logospatrum/patristic-plugin`. After Phase 7, the empty repo on GitHub has all files; Phase 8 attaches it to the monorepo as a submodule.

### Task 7.1: Clone the empty plugin repo

**Files:** none (filesystem prep).

- [ ] **Step 1: Clone to a sibling directory of the monorepo**

```bash
cd C:/Users/79819/PycharmProjects
git clone git@github.com:logospatrum/patristic-plugin.git
cd patristic-plugin
```

Expected: empty directory, just `.git/`.

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p .claude-plugin agents/teo-search skills/theology-router
```

---

### Task 7.2: Plugin manifest

**Files:**
- Create: `patristic-plugin/.claude-plugin/plugin.json`

- [ ] **Step 1: Write the manifest**

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

- [ ] **Step 2: Validate JSON**

```bash
python -c "import json; json.load(open('.claude-plugin/plugin.json'))"
```

Expected: no output (valid JSON).

---

### Task 7.3: `teo-search` subagent

**Files:**
- Create: `patristic-plugin/agents/teo-search/AGENT.md`

- [ ] **Step 1: Write the AGENT.md (verbatim from spec section 6.2)**

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

---

### Task 7.4: `theology-router` skill

**Files:**
- Create: `patristic-plugin/skills/theology-router/SKILL.md`

- [ ] **Step 1: Write the SKILL.md (verbatim from spec section 6.3)**

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

---

### Task 7.5: README + LICENSE

**Files:**
- Create: `patristic-plugin/README.md`
- Create: `patristic-plugin/LICENSE`

- [ ] **Step 1: Write README (verbatim from spec section 9)**

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

- [ ] **Step 2: Write LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 logospatrum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Initial commit + push to plugin repo**

```bash
cd C:/Users/79819/PycharmProjects/patristic-plugin
git add .claude-plugin agents skills README.md LICENSE
git commit -m "feat: initial plugin — MCP + teo-search subagent + theology-router skill

Bundles connection to https://logospatrum.com/api/mcp with:
- teo-search subagent (search-only, no read_passage)
- theology-router skill (auto-triggers on Orthodox / patristic queries)

Install:
  /plugin marketplace add https://github.com/logospatrum/patristic-plugin
  /plugin install patristic"
git push -u origin master
```

Expected: pushes to `logospatrum/patristic-plugin` on GitHub.

- [ ] **Step 4: Verify on GitHub**

Open `https://github.com/logospatrum/patristic-plugin`. The repo shows the file tree with `.claude-plugin/`, `agents/`, `skills/`, `README.md`, `LICENSE`. README renders correctly.

---

## Phase 8 — Attach plugin to monorepo as submodule

### Task 8.1: Add submodule

**Files:**
- New: `plugins/patristic-plugin/` (git submodule)
- New: `.gitmodules`

- [ ] **Step 1: From monorepo root, add the submodule**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag  # path is fine; just the local checkout
git submodule add git@github.com:logospatrum/patristic-plugin plugins/patristic-plugin
```

This creates `.gitmodules` and pulls the plugin repo into `plugins/patristic-plugin/`.

- [ ] **Step 2: Verify submodule state**

```bash
git submodule status
ls plugins/patristic-plugin/
```

Expected: `git submodule status` shows the SHA of the plugin's current `master`. The directory contains `.claude-plugin/`, `agents/`, etc.

- [ ] **Step 3: Commit**

```bash
git add .gitmodules plugins/patristic-plugin
git commit -m "feat: add patristic-plugin as git submodule at plugins/patristic-plugin

Standalone public repo (logospatrum/patristic-plugin) — Claude Code
plugin bundling MCP server, teo-search subagent, theology-router skill.
Monorepo only tracks the submodule SHA; iterate on the plugin inside
its own checkout."
```

---

## Phase 9 — Monorepo README + screenshot

### Task 9.1: Capture the home-screen screenshot

**Files:**
- Create: `docs/screenshots/main-screen.png`

This is a manual step — only the engineer can take the screenshot.

- [ ] **Step 1: Run the frontend in dev**

In one terminal:
```bash
cd apps/frontend && PORT=3001 npm run dev
```

In another (the backend needs to be running too — `langgraph dev` from `apps/backend`, with Postgres up).

- [ ] **Step 2: Open the app in a 1920×1080 viewport**

Open Chrome/Firefox at `http://localhost:3001`. DevTools → Toggle device toolbar → Responsive → set viewport to 1920×1080. Hide DevTools panel.

- [ ] **Step 3: Set up the home screen for the shot**

- Make sure `lightOn` is true (light visible).
- RU language (default).
- No prefill in input.
- Logo + quote + monolith input + starters all visible.
- No chat history hovered open.

- [ ] **Step 4: Capture**

In Chrome DevTools: ⋮ menu → "Capture screenshot" (or "Capture full size screenshot"). Save as PNG.

Crop browser chrome with an image editor if needed. Final dimensions: 1920×1080 exactly (the captured page only; not the browser UI).

- [ ] **Step 5: Save to `docs/screenshots/main-screen.png`**

```bash
cd C:/Users/79819/PycharmProjects/christian_rag
mkdir -p docs/screenshots
# (move/save the captured PNG to docs/screenshots/main-screen.png)
ls -lh docs/screenshots/main-screen.png
```

Expected: file present, ~200-500 KB depending on content.

- [ ] **Step 6: Commit**

```bash
git add docs/screenshots/main-screen.png
git commit -m "docs: add main-screen.png — 1920x1080 home screen capture for README"
```

---

### Task 9.2: Write the monorepo root README

**Files:**
- Modify: `README.md` (rewrite from stub)

- [ ] **Step 1: Check current README state**

```bash
cat README.md 2>&1 | head -10
```

If absent or stub, no preservation needed. If it has prior content worth keeping, append the new content; otherwise overwrite.

- [ ] **Step 2: Write the new README (verbatim from spec section 9)**

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

MIT (matches plugin).
```

- [ ] **Step 3: Verify the screenshot renders in GitHub-style preview**

Either install a local markdown previewer, or wait and verify after pushing.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: monorepo README with screenshot, live link, quick reference

Replaces the prior stub. Embeds the 1920x1080 home-screen capture and
links to live (logospatrum.com), plugin repo, internal CLAUDE.md files."
```

---

## Phase 10 — Docs, smoke prep, and merge

### Task 10.1: Update root CLAUDE.md with prod-rollout section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append a section about CI + deploy**

After the existing "Anti-abuse / RUB budget" section, add:

```markdown
## Production rollout (added 2026-05-17)

Backend image is built by GitHub Actions and pushed to GHCR — see [docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md](docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md).

- **CI** (`.github/workflows/build-and-push.yml`): on push to `master`/`main` or `v*` tag, two parallel jobs build:
  - `ghcr.io/logospatrum/backend:<sha>` + `:latest` via `langgraph build` (Wolfi distro, base `langchain/langgraph-api:3.11`, listens on `:8000`).
  - `ghcr.io/logospatrum/frontend:<sha>` + `:latest` via `apps/frontend/Dockerfile`.
- **VPS deploy (MVP, manual)**:
  ```
  ssh root@vps
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
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): production rollout — CI, GHCR, whitelist proxy, plugin"
```

---

### Task 10.2: Update SMOKE_ANTI_ABUSE.md for whitelist behaviour

**Files:**
- Modify: `infra/SMOKE_ANTI_ABUSE.md`

- [ ] **Step 1: Open the file**

```bash
cat infra/SMOKE_ANTI_ABUSE.md
```

- [ ] **Step 2: Update affected checks**

Some checks need new expected behaviour now that the proxy whitelists paths. Add a new check 12 covering MCP + 4 blocklist verifications:

Append the following at the end of the "## Checks" list, before the "## Pass/fail tracking" section:

```markdown
- [ ] **12. MCP reachable without HMAC.**
  ```
  curl -ki -X POST https://${DOMAIN}/api/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
  Expect: `HTTP/2 200` with JSON listing 6 tools (`read_passage`, `lexical_search`, `semantic_search`, `list_authors`, `list_works`, `expand_concept`).

- [ ] **13. MCP rate-limited by IP.** Fire 121 requests to `/api/mcp` in 60 s → 121st returns `HTTP/2 429`.

- [ ] **14. Blocked endpoints return 404.** Each should return `HTTP/2 404`:
  ```
  curl -ki https://${DOMAIN}/api/store/items
  curl -ki -X POST https://${DOMAIN}/api/runs/batch -d '{}'
  curl -ki -X POST https://${DOMAIN}/api/runs/crons -d '{}'
  curl -ki https://${DOMAIN}/api/threads
  curl -ki https://${DOMAIN}/api/a2a
  curl -ki https://${DOMAIN}/api/assistants
  ```

- [ ] **15. ConnectAgent modal works.** Open `https://${DOMAIN}/` → click "Подключить" pill → modal opens → both tabs work → copy buttons trigger Sonner toast.

- [ ] **16. Plugin install end-to-end.** In a separate Claude Code instance:
  ```
  /plugin marketplace add https://github.com/logospatrum/patristic-plugin
  /plugin install patristic
  ```
  Ask a theological question → `theology-router` skill activates → main delegates to `teo-search` → reads passages → cites correctly.
```

Also add a note near the top: "Note: as of 2026-05-17 some old checks (e.g. check 3 'session_invalid 401') still apply only to `/api/runs/stream`. Public paths (`/api/info`, `/api/catalog`, `/api/openapi.json`, `/api/mcp`) bypass HMAC verify entirely."

- [ ] **Step 3: Commit**

```bash
git add infra/SMOKE_ANTI_ABUSE.md
git commit -m "test(infra): smoke checklist — add MCP, whitelist 404s, plugin install"
```

---

### Task 10.3: Push branch + open PR (or merge directly)

**Files:** none (git ops only).

- [ ] **Step 1: Push feature branch**

```bash
git push -u origin feat/mcp-prod-rollout
```

- [ ] **Step 2: Verify CI fires (optional preview)**

The workflow file's trigger is `master`/`main`/tags, so the feature-branch push won't fire it. You can manually trigger via GitHub UI → Actions → "Build and push images" → Run workflow → choose `feat/mcp-prod-rollout`. Verify both jobs succeed.

If the manual run succeeds, you have a `ghcr.io/logospatrum/backend:<feat-branch-sha>` image ready for prod testing before merging.

- [ ] **Step 3: Merge to master**

Either:
- `gh pr create --title "feat: MCP-as-feature + production rollout" --body "..."` then merge via UI.
- OR locally: `git checkout master && git merge feat/mcp-prod-rollout && git push`.

After the merge push, the workflow fires on master → produces `:latest` images.

- [ ] **Step 4: SSH into VPS and pull**

```bash
ssh root@<vps>
cd /opt/logospatrum     # or wherever the deploy clone lives
git pull
docker login ghcr.io -u $GHCR_USERNAME -p $GHCR_TOKEN
docker compose -f infra/docker-compose.prod.yml pull
docker compose -f infra/docker-compose.prod.yml up -d
```

- [ ] **Step 5: Run smoke checklist**

Walk through `infra/SMOKE_ANTI_ABUSE.md` checks 1–16. Record results in the table at the bottom.

---

## Self-review

After writing this plan, comparing against the spec:

**1. Spec coverage check:**

| Spec section | Tasks |
|---|---|
| Sec 1 (Backend prod image) | Tasks 2.1, 2.2, 2.3 |
| Sec 2 (Whitelist proxy) | Tasks 1.1, 1.2, 1.3 |
| Sec 3 (nginx) | Task 3.2 |
| Sec 4 (Backend changes) | Tasks 1.1 (session/refresh), 3.1 (port) |
| Sec 5 (Connect modal) | Tasks 5.1, 5.2, 5.3, 5.4 |
| Sec 5.1 (BottomChrome GitHub) | Task 6.1 |
| Sec 6 (Plugin repo) | Tasks 7.1-7.5 |
| Sec 7 (CI) | Task 4.1 |
| Sec 8 (Compose) | Task 3.1 |
| Sec 9 (Monorepo migration + READMEs) | Tasks 0.2, 7.5 (plugin README), 9.2 (monorepo README) |
| Configuration / env vars | Task 3.3 |
| Acceptance criteria | Task 10.2 (extends checklist) + Task 10.3 (run) |

All sections covered.

**2. Placeholder scan:** Reviewed for "TBD", "implement later", "similar to". One acceptable hedge in Task 5.1 Step 1 ("If the exact token names don't exist, substitute with closest names") — gives the engineer a concrete fallback strategy with `tokens.ts` as the source-of-truth reference. Not a placeholder per the rule (the engineer doesn't need to invent anything, just align names from an existing file).

**3. Type consistency:**
- `PUBLIC_RE`, `RUN_START_RE` introduced in Task 1.2, referenced consistently.
- `Copyable` props (`text`, `copyAriaLabel`) defined in Task 5.1, used consistently in Task 5.3.
- `connectSlot` prop defined in Task 5.4 step 1, referenced consistently in step 2.
- i18n keys: `connect.*` introduced in Task 5.2, referenced verbatim in Tasks 5.1 (Copyable's `copyAria`, `copied`) and 5.3 (all the others).
- `bottom.github`, `bottom.githubAria` introduced in Task 5.2, used in Task 6.1.
- MCP URL: `https://logospatrum.com/api/mcp` consistent across plugin manifest (7.2), modal (5.3 — via `window.location.origin` fallback), README (7.5), CLAUDE.md (10.1).
- Image tag scheme `ghcr.io/logospatrum/{backend,frontend}:{sha,latest}` consistent across CI (4.1), compose (3.1), CLAUDE.md (10.1).

All consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-mcp-feature-and-prod-rollout.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints. ~30 tasks; works well because most tasks are tightly scoped to one file.

2. **Inline Execution** — execute in this session via `superpowers:executing-plans`.

Which approach?
