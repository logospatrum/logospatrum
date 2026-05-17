# Anti-abuse rate limits + RUB budget — design

**Date:** 2026-05-16
**Scope:** `infra/nginx/**`, new `infra/docker-compose.prod.yml`, new `infra/migrations/002_abuse_budget.sql`, new `apps/backend/src/backend/budget/**` + FastAPI mount in `apps/backend/src/backend/catalog.py` + graph callback in `apps/backend/src/backend/graph.py`, `apps/frontend/src/middleware.ts` + `apps/frontend/src/app/api/[..._path]/route.ts` rewrite + small UI additions.
**Status:** Draft, pending user review

## Motivation

Chat is publicly anonymous and burns paid Anthropic-via-Timeweb tokens on every run. A single curious visitor with `for i in $(seq 100); do curl -X POST .../runs ...; done` can blow the entire monthly budget overnight. Current `nginx.prod.conf` is a stock template with one upstream `app:8000`, no rate limits, no body cap, no UA filtering, and points at nothing real. `langgraph dev` is listening on `:2024` and the frontend talks to it **directly** via `NEXT_PUBLIC_API_URL=http://localhost:2024` — meaning the backend URL leaks to the browser and is reachable from anywhere.

We need a layered defence sized to the actual cost driver: an expensive run is ~50–80 ₽ (Sonnet ~80K input × 405 ₽/M + ~8K output × 2025 ₽/M ≈ 49 ₽; plus Haiku-subagent ~20–25 ₽). At a daily budget of 500 ₽ per user that is 7–15 runs/day. A pure nginx `limit_req` of "N requests/min" can't see this — it just counts attempts. We need **rubles** as the unit, computed from real `usage_metadata` after each run.

## Decisions (locked during brainstorming)

- **Audience:** public anonymous. No login.
- **Subject key:** HttpOnly UUIDv4 cookie `pat_uid` (1-year Max-Age, Secure, SameSite=Lax). Fallback to IP when cookie is missing (curl/scripts) with a stricter limit.
- **Budget unit:** rubles, computed from Anthropic `usage_metadata` per run, using a static pricing table for Timeweb tariffs.
- **Daily caps:** 500 ₽/day for cookie subjects, 250 ₽/day for IP-only subjects. Bucket day = UTC.
- **Limit policy:** two-phase — `soft warn` at 80 %, `hard 429` at 100 %.
- **Global kill-switch:** monthly cap (default 30 000 ₽) on a single `__global_month` row. When breached, all runs respond 503 until the next month.
- **No Redis.** Counters live in Postgres in a new `budget_usage` table — single new SQL object, no new infrastructure.
- **No Cloudflare** (RU-side payment / availability constraints). Defence lives in nginx + backend; Timeweb provides L3/L4 only.
- **API binding:** frontend goes through Next.js proxy `/api/*` only; LangGraph is not exposed outside the docker network. Two extra checks on the proxy path:
  1. **`Origin` / `Referer` guard** in nginx — `/api/*` only accepts requests whose `Origin` matches the configured domain.
  2. **Short-lived HMAC session token** — Next.js renders `<meta name="pat-session" content="<token>">` on every page, where `token = base64(HMAC_SHA256(secret, pat_uid + ":" + YYYY-MM-DD))`. JS reads the meta and sends it as `X-Pat-Session` on every API call. Backend rejects mismatches with 401. Secret in env, never in the JS bundle.
- **Out of scope (phase C):** Yandex SmartCaptcha, ASN/cloud-egress blocklists, geo filters, `fail2ban`. Add only if logs show real abuse after rollout.

## Threat model (and what blocks what)

| Threat | Blocked by |
|---|---|
| Random visitor with `curl https://.../api/runs` (no headers) | nginx UA blacklist + nginx `Origin` guard (no Origin → 403) |
| Visitor with `curl --header "Origin: ..."` (one-off) | HMAC session token absent → 401 |
| Single browser tab mashing send | nginx `limit_req` on `/api/runs` (6 req/min, burst 3) + daily ₽ budget |
| Single browser opening 10 parallel streams | nginx `limit_conn` (3 concurrent) per IP |
| 100KB prompt to inflate input tokens | nginx `client_max_body_size 32k` on `/api/runs` |
| Same person from new incognito (new cookie) | IP-bound stricter cap (250 ₽/IP/day) catches the cluster |
| Distributed botnet across many IPs | Global monthly kill-switch (30 000 ₽) |
| Targeted scraper that fetches `/` then replays meta token + cookie | Daily ₽ budget per cookie+IP; this is the residual we accept for MVP. Phase C captcha closes it. |
| Single bug causing runaway cost in our code | Global monthly kill-switch + per-subject pre-run guard |
| LangGraph URL discovered and hit directly bypassing nginx | LangGraph bound only to docker-internal network, no published port in prod compose |

## Architecture

```
                       Internet
                          │
                          ▼
            Timeweb L3/L4  (provider-side, not ours)
                          │
                          ▼
            nginx :443  (TLS termination)
              • TLS + security headers
              • client_max_body_size, body timeouts
              • UA blacklist
              • Origin/Referer guard on /api/*
              • limit_req zones (runs, threads, api, default)
              • limit_conn zone for streams
              • CORS strict allow-origin
                          │
              ┌───────────┴──────────────────┐
              │                              │
              ▼                              ▼
       Next.js :3000                  (no other public ports)
         • middleware.ts:
             - Set-Cookie pat_uid if missing
             - inject <meta name="pat-session">
         • /api/[..._path] proxy:
             - verify X-Pat-Session HMAC
             - extract pat_uid → inject into
               config.configurable.subject_key
               for /runs POST/PUT
             - GET FastAPI /budget/check before
               forwarding /runs
             - pass-through everything else
                          │
                          ▼ (docker-internal only)
       LangGraph server :2024
         • graphs.patristic   — main agent
         • http.app           — FastAPI (catalog + budget + session)
         • post-run node:
             - reads usage_metadata from state
             - converts to ₽ via pricing table
             - upserts budget_usage rows
                          │
                          ▼
       Postgres :5432  (docker-internal only)
         • existing corpus tables
         • new budget_usage table
```

Boundaries:

- **nginx** is the coarse filter and TLS terminator. It knows nothing about tokens or rubles. Its job is to stop floods, megabyte prompts, and obvious bots before they reach Next.js.
- **Next.js middleware + API proxy** owns the *identity* layer (cookie + HMAC), the *pre-run gate* (cheap Postgres SELECT through a FastAPI endpoint), and the secure *config injection* (`subject_key`) that ties an HTTP request to a graph run.
- **LangGraph graph** owns *post-run accounting*: a terminal node that reads `usage_metadata` from state and writes ₽ to Postgres. This runs even if the HTTP client disconnects, so accounting cannot be cheated by hanging up mid-stream.
- **FastAPI in `http.app`** owns the SQL: `/budget/check`, `/budget/record` (called only by the LangGraph node, internal), and a refresh helper.
- **Postgres** is the single source of truth for spend.

## Components

### 1. nginx layer (`infra/nginx/nginx.prod.conf` — rewritten)

Single config file rendered from a template (`envsubst`) at container start to pluck `${DOMAIN}` and `${ALLOWED_ORIGIN}` from env. Important blocks:

```nginx
# === rate limit zones (top-level http {}) ===
limit_req_zone  $binary_remote_addr  zone=runs_zone:10m   rate=6r/m;
limit_req_zone  $binary_remote_addr  zone=threads_zone:10m rate=10r/m;
limit_req_zone  $binary_remote_addr  zone=api_zone:10m    rate=60r/m;
limit_conn_zone $binary_remote_addr  zone=stream_conn:10m;

# Match the JSON error table — default 503 for limit_conn would diverge.
limit_req_status  429;
limit_conn_status 429;

# === user-agent blacklist ===
map $http_user_agent $blocked_ua {
    default 0;
    ~*curl 1;
    ~*wget 1;
    ~*python-requests 1;
    ~*scrapy 1;
    ~*httpie 1;
    ~*go-http-client 1;
    ~*libwww-perl 1;
    ~*"^Java/" 1;
    ~*okhttp 1;
    "" 1;                       # empty UA also blocked
}

# === allowed Origin (env-driven; comma-split into a map at render time) ===
map $http_origin $allowed_origin {
    default 0;
    "${ALLOWED_ORIGIN}" 1;      # e.g. "https://patristic.example.ru"
}

# === HTTPS server ===
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;

    client_body_timeout 10s;
    send_timeout        60s;
    keepalive_timeout   60s;

    # NOTE: UA blacklist applies only to /api/*, NOT to / (so search-engine
    # crawlers can still index the public landing/chat page).

    # === API surface: strictest ===
    location ~ ^/api/(threads/[^/]+/runs|runs)(/|$) {
        if ($blocked_ua)         { return 403; }
        if ($allowed_origin = 0) { return 403; }
        limit_req   zone=runs_zone burst=3 nodelay;
        limit_conn  stream_conn 3;
        client_max_body_size 32k;
        proxy_pass http://nextjs:3000;
        include /etc/nginx/proxy_common.conf;
        # long-lived SSE
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location = /api/threads {
        if ($blocked_ua)         { return 403; }
        if ($allowed_origin = 0) { return 403; }
        limit_req zone=threads_zone burst=5 nodelay;
        client_max_body_size 16k;
        proxy_pass http://nextjs:3000;
        include /etc/nginx/proxy_common.conf;
    }

    location /api/ {
        if ($blocked_ua)         { return 403; }
        if ($allowed_origin = 0) { return 403; }
        limit_req zone=api_zone burst=20 nodelay;
        client_max_body_size 64k;
        proxy_pass http://nextjs:3000;
        include /etc/nginx/proxy_common.conf;
    }

    # === everything else (Next.js statics + SSR) ===
    location / {
        proxy_pass http://nextjs:3000;
        include /etc/nginx/proxy_common.conf;
    }
}

# === HTTP → HTTPS redirect + ACME ===
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
```

`proxy_common.conf` carries the standard `proxy_set_header Host/X-Real-IP/X-Forwarded-*` and `proxy_redirect off` so the API and root locations don't duplicate it.

Numbers and reasoning:

- **6 r/min on `/runs`, burst 3**: a normal user opens a fresh question every 10–20 s while reading. 6 r/min sustained + burst 3 = a brief flurry of 4 quick sends without blocking. Even if all 6 in a minute go through, ₽-budget catches it later.
- **10 r/min on POST `/threads`**: cheap operationally but reuses thread IDs in localStorage; legitimate UI rarely creates more than one or two per session. 10 leaves headroom for "open chat in three tabs".
- **60 r/min on `/api/*` (catalog, session, polling, etc.)**: catalog browse is a chatty pattern (search-as-you-type), 60 covers it.
- **`limit_conn stream_conn 3`**: an SSE stream holds a connection for the entire run (~30 s). Three concurrent streams from one IP = legitimately the multi-tab case; four+ is abuse.
- **`client_max_body_size 32k` on `/runs`**: at Russian text average ~4 bytes/char ≈ 8000 chars ≈ ~2500 tokens of user input. Far over a normal chat message, far under "stuff a novel in the prompt".

### 2. Cookie issuance — Next.js middleware (`apps/frontend/src/middleware.ts`, new)

Runs on every request that matches the matcher (HTML routes + `/api/*`). Two responsibilities:

1. If `pat_uid` cookie absent → generate a UUIDv4 via `crypto.randomUUID()` and set it: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`.
2. Compute today's session token (`HMAC_SHA256(PAT_SESSION_SECRET, pat_uid + ":" + YYYY-MM-DD)`) and stash it on a request header `x-internal-pat-session` so the SSR route handlers can read it and inject into the page `<meta>`. (This avoids re-computing in every page; middleware runs once per request.)

Matcher excludes `_next/static`, images, and favicon to avoid pointless work.

### 3. HMAC session token — embed and verify

**Issue side** (`apps/frontend/src/app/layout.tsx`, edit): inside `<head>`, read the header that middleware set and render:

```tsx
<meta name="pat-session" content={headers().get('x-internal-pat-session') ?? ''} />
```

**Client read side** (`apps/frontend/src/lib/session.ts`, new):

```ts
export function getPatSession(): string {
  if (typeof document === 'undefined') return ''
  return document.querySelector('meta[name="pat-session"]')?.getAttribute('content') ?? ''
}
```

`Stream.tsx` provider injects it as `X-Pat-Session` on every request to the LangGraph SDK (the SDK takes `defaultHeaders`). `LibraryBrowser` adds the same header to its `fetch('/api/catalog')`.

**Verify side** (`apps/frontend/src/app/api/[..._path]/route.ts`, rewritten): before forwarding, recompute `HMAC_SHA256(PAT_SESSION_SECRET, cookie.pat_uid + ":" + today_utc)` and constant-time compare against `X-Pat-Session` header. Mismatch → 401 JSON `{error: "session_invalid"}`. Cookie missing → 401 same shape.

**Refresh** (`apps/frontend/src/app/api/session/route.ts`, new): a `GET /api/session` endpoint that re-runs the middleware logic and returns `{token, expires_at_utc}`. The client calls this on the rare midnight-rollover 401 and retries the failed request once silently. **This endpoint is the only `/api/*` path exempt from the HMAC verify** (it is the issuer); the proxy router checks `/api/session` first and bypasses session validation. Origin/Referer guard in nginx still applies.

### 4. Pre-run budget guard

Three pieces of work, in order, inside `/api/[..._path]/route.ts` for POST/PUT to `/runs` or `/threads/<id>/runs`:

1. Extract `pat_uid` from cookies. If absent → `subject_key = "ip:" + request_ip`, otherwise `subject_key = "cookie:" + pat_uid`. `request_ip` comes from `request.headers.get('x-real-ip')` (set by nginx via `proxy_set_header X-Real-IP $remote_addr;` in `proxy_common.conf`) — **never** trust `x-forwarded-for` here without nginx in front, because it's client-supplied.
2. Call the backend FastAPI: `GET http://backend:2024/budget/check?subject=<subject_key>`. The endpoint reads the row for today (Moscow date), computes `used_rub`, looks up the per-subject cap (500 ₽ for cookie:, 250 ₽ for ip:), and answers:
   ```json
   {
     "allowed": true,
     "used_rub": 312.4,
     "limit_rub": 500,
     "warn": false,
     "reset_at": "2026-05-17T00:00:00+03:00"
   }
   ```
   If `allowed=false`, the proxy returns `429` with the same JSON plus `Retry-After: <seconds>` derived from `reset_at`. If `warn=true` (used ≥ 80 %), proxy appends a response header `X-Budget-Warning: used=<>;limit=<>` for the frontend to read.
3. Also check the global month: `GET /budget/check?subject=__global_month`. If breached → `503 Service Unavailable` JSON `{"error":"service_paused_global_budget"}` plus `Retry-After: <to-end-of-month>`.

If both checks pass, the proxy mutates the JSON body to inject `subject_key` into LangGraph's `config.configurable` (read `body.config?.configurable ?? {}`, set `subject_key`, write back) and forwards. The original `langgraph-nextjs-api-passthrough` helper doesn't expose request mutation, so this route handler is rewritten as a thin custom passthrough (~80 lines) that does header copy + body splice + `fetch`. **Runtime changes from `edge` to `nodejs`** — both because `crypto.createHmac` is nodejs-only and because the SSE pass-through is more predictable on the Node runtime.

### 5. Post-run usage accounting — LangGraph terminal node

`apps/backend/src/backend/graph.py` is edited so the compiled graph ends with a synthetic node `budget_record` that runs after the agent finishes. The node:

1. Reads `subject_key` from `RunnableConfig["configurable"]`. If missing (legacy path / direct LangGraph hit that somehow bypassed the proxy) → falls back to `subject_key = "__unknown__"` so accounting still happens against a known bucket.
2. Walks `state["messages"]`, sums `usage_metadata["input_tokens"]` and `usage_metadata["output_tokens"]` per AIMessage. Model name is read from `msg.response_metadata.get("model") or msg.response_metadata.get("model_name")` — Anthropic populates this on every AIMessage from `ChatAnthropic`. Unknown/absent → `__default__` row in the pricing table.
3. Computes ₽ via the pricing table in `budget/pricing.py`.
4. UPSERTs into `budget_usage` for today and for `__global_month`.

The node uses the existing `db.conn()` async context manager (the same pool the tools use). Failures here are **logged and swallowed** — accounting must never crash a successful run. A counter metric is bumped on swallow so silent drift is visible.

This node runs even if the HTTP client disconnected, because LangGraph executes graphs to completion regardless of stream backpressure. That is the design point: accounting can't be cheated by abandoning a stream.

### 6. Pricing module (`apps/backend/src/backend/budget/pricing.py`)

```python
from typing import TypedDict

class Tariff(TypedDict):
    input_per_mtok: float    # ₽ per 1M input tokens
    output_per_mtok: float

TARIFF_RUB: dict[str, Tariff] = {
    "claude-sonnet-4-6": {"input_per_mtok": 405.0, "output_per_mtok": 2025.0},
    "claude-haiku-4-5":  {"input_per_mtok": 108.0, "output_per_mtok": 540.0},
    # Fallback for any model not in the table — deliberately pessimistic
    # so a misconfigured model registers as expensive, not free.
    "__default__":       {"input_per_mtok": 500.0, "output_per_mtok": 2500.0},
}

def cost_rub(model: str, input_tokens: int, output_tokens: int) -> float:
    t = TARIFF_RUB.get(_normalize_model(model)) or TARIFF_RUB["__default__"]
    return (
        input_tokens  * t["input_per_mtok"]  / 1_000_000
        + output_tokens * t["output_per_mtok"] / 1_000_000
    )

def _normalize_model(model: str) -> str:
    # Anthropic returns "anthropic/claude-sonnet-4-6" or just "claude-sonnet-4-6"
    return model.split("/")[-1]
```

Pure function, fully unit-tested.

### 7. Storage module (`apps/backend/src/backend/budget/storage.py`)

```python
from datetime import datetime, timezone, timedelta
from .pricing import cost_rub
from ..db import conn

MSK = timezone(timedelta(hours=3))

def _today_msk() -> str:
    return datetime.now(MSK).strftime("%Y-%m-%d")

def _this_month_msk() -> str:
    return datetime.now(MSK).strftime("%Y-%m")

async def get_used_rub(subject: str, bucket: str) -> float:
    async with conn() as c:
        cur = await c.execute(
            "SELECT used_rub FROM budget_usage WHERE subject_key=%s AND bucket=%s",
            (subject, bucket),
        )
        row = await cur.fetchone()
        return float(row[0]) if row else 0.0

async def add_usage(subject: str, bucket: str, delta_rub: float) -> float:
    async with conn() as c:
        cur = await c.execute(
            """
            INSERT INTO budget_usage (subject_key, bucket, used_rub)
            VALUES (%s, %s, %s)
            ON CONFLICT (subject_key, bucket)
            DO UPDATE SET used_rub = budget_usage.used_rub + EXCLUDED.used_rub,
                          updated_at = now()
            RETURNING used_rub
            """,
            (subject, bucket, delta_rub),
        )
        row = await cur.fetchone()
        await c.commit()
        return float(row[0])
```

Bucket day is Moscow time so "today" matches a Russian-speaking user's intuition of a calendar day, not UTC midnight (3 a.m. MSK).

### 8. FastAPI surface (`apps/backend/src/backend/catalog.py`, extended)

Three new endpoints on the existing FastAPI app mounted via `langgraph.json:http.app`:

```python
@app.get("/budget/check")
async def budget_check(subject: str):
    today = _today_msk()
    month = _this_month_msk()
    daily_limit = 500.0 if subject.startswith("cookie:") else 250.0
    if subject == "__global_month":
        used = await storage.get_used_rub(subject, month)
        return {
            "allowed": used < settings.global_monthly_kill_rub,
            "used_rub": used,
            "limit_rub": settings.global_monthly_kill_rub,
            "warn": used >= 0.8 * settings.global_monthly_kill_rub,
            "reset_at": _next_month_iso(),
        }
    used = await storage.get_used_rub(subject, today)
    return {
        "allowed": used < daily_limit,
        "used_rub": used,
        "limit_rub": daily_limit,
        "warn": used >= 0.8 * daily_limit,
        "reset_at": _tomorrow_iso(),
    }
```

CORS on this app changes from the hardcoded `http://localhost:3000` to `settings.allowed_origin` (one env var, same value as nginx). The existing `/catalog` and `/health` are unchanged. No `/budget/record` HTTP endpoint — accounting goes directly through `storage.add_usage()` from the LangGraph node, no HTTP hop.

### 9. Frontend UX

- `apps/frontend/src/components/logos/BudgetBanner.tsx` (new): a slim banner that appears below `TopChrome` when the last API response carried `X-Budget-Warning`. Text from `i18n.ts` (RU: "Остаток дневного бюджета: X ₽. После 0 ₽ запросы будут отклонены до завтра.").
- `apps/frontend/src/components/logos/LogosShell.tsx` (edit): track `budgetWarning` state, set it from a response interceptor in `Stream.tsx`, render `BudgetBanner` when set.
- `apps/frontend/src/providers/Stream.tsx` (edit): on response, read `X-Budget-Warning` header and `X-Pat-Session` 401 (silent refresh via `/api/session`, retry once). On 429 → toast via Sonner with the JSON's `reset_at`. On 503 → big inline block "Сервис временно приостановлен" in `LogosShell`.
- `apps/frontend/src/components/logos/i18n.ts` (edit): add `budgetWarning`, `budgetExceeded`, `globalPaused` keys for RU and EN.

### 10. Configuration

New env vars (loaded by `apps/backend/src/backend/config.py` and read in Next.js):

| Var | Where | Default | Notes |
|---|---|---|---|
| `PAT_SESSION_SECRET` | both | (required, no default) | 32 random bytes hex (`openssl rand -hex 32`). Rotating it invalidates all live sessions — accepted, MVP. |
| `DOMAIN` | nginx + Next | `localhost` | Used in nginx `server_name`, ACME cert path, and frontend canonical URLs. |
| `ALLOWED_ORIGIN` | nginx + backend CORS | `https://${DOMAIN}` | Single origin. Multiple via comma-split if needed later. |
| `DAILY_RUB_PER_COOKIE` | backend | `500` | Per-cookie cap. |
| `DAILY_RUB_PER_IP` | backend | `250` | IP-fallback cap. |
| `SOFT_WARN_RATIO` | backend | `0.8` | Warning threshold. |
| `GLOBAL_MONTHLY_KILL_RUB` | backend | `30000` | Hard month-wide kill. |

All of these go into `/.env` (the root one — backend + frontend both read it; see `CLAUDE.md` "Two .env files" rule).

### 11. Production compose (`infra/docker-compose.prod.yml`, new)

Skeleton of services and the network boundary (so the implementer doesn't reinvent the topology):

```yaml
services:
  postgres:
    # reuse the dev image and tuned config, but on the internal network only
    image: pgvector/pgvector:pg16
    networks: [internal]
    environment: { POSTGRES_DB: patristic, POSTGRES_USER: postgres, POSTGRES_PASSWORD: ${PG_PASSWORD} }
    volumes: [postgres-data:/var/lib/postgresql/data]
    # NO `ports:` mapping — DB is internal-only

  backend:
    build: ./apps/backend
    networks: [internal]
    env_file: ../.env
    # NO `ports:` mapping — LangGraph reachable only from nextjs/nginx via DNS `backend:2024`
    depends_on: [postgres]

  nextjs:
    build: ./apps/frontend
    networks: [internal]
    env_file: ../.env
    environment:
      # SSR talks to backend over the internal docker DNS, not the public domain
      LANGGRAPH_API_URL: http://backend:2024
    depends_on: [backend]

  nginx:
    build: ./infra/nginx
    networks: [internal]
    ports: ["80:80", "443:443"]   # ONLY public-facing service
    environment:
      DOMAIN: ${DOMAIN}
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}
    volumes:
      - letsencrypt:/etc/letsencrypt
      - certbot-webroot:/var/www/certbot
    depends_on: [nextjs]

networks:
  internal: { driver: bridge }

volumes:
  postgres-data: {}
  letsencrypt: {}
  certbot-webroot: {}
```

The key guarantee: only `nginx` publishes ports. `postgres`, `backend`, `nextjs` are reachable only on the internal docker network — so the LangGraph URL physically cannot be hit from outside, regardless of any other hardening.

### 12. nginx Dockerfile (`infra/nginx/Dockerfile.prod`, edit)

The current Dockerfile copies `nginx.prod.conf` verbatim. The new config has `${DOMAIN}` / `${ALLOWED_ORIGIN}` placeholders that need substitution at container start. Switch the entrypoint to:

```dockerfile
COPY nginx.prod.conf /etc/nginx/templates/default.conf.template
# `nginx:alpine` already runs /docker-entrypoint.d/20-envsubst-on-templates.sh
# at startup, which envsubst-renders every *.template in /etc/nginx/templates/
# into /etc/nginx/conf.d/. So just dropping the template there is enough.
```

No CMD change — the default `nginx -g 'daemon off;'` runs after the envsubst step.

### 13. Database (`infra/migrations/002_abuse_budget.sql`, new)

```sql
CREATE TABLE IF NOT EXISTS budget_usage (
    subject_key  TEXT          NOT NULL,
    bucket       TEXT          NOT NULL,
    used_rub     NUMERIC(12,4) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_key, bucket)
);
CREATE INDEX IF NOT EXISTS budget_usage_bucket_idx ON budget_usage (bucket);
```

Applied via the same path as `001_init.sql`. Test DB `patristic_test` gets it too (so unit tests can exercise the upsert).

No cron cleanup in MVP — at expected volumes (<10 k unique subjects/day × 30 days = 300 k rows) the table is microscopic. A manual `DELETE WHERE bucket < ...` is fine for now; a scheduled cleanup is a phase C tweak.

## Error responses

All API failures return JSON for the frontend to render:

| Status | When | Body |
|---|---|---|
| `401` | Missing/invalid `X-Pat-Session` | `{"error":"session_invalid"}` |
| `403` | Origin/Referer mismatch (nginx) | empty body |
| `403` | UA blacklist (nginx) | empty body |
| `413` | Body > 32 k on `/api/runs*` (nginx) | nginx default |
| `429` | nginx `limit_req` exceeded | nginx default (with `Retry-After`) |
| `429` | Daily ₽ budget exceeded | `{"error":"daily_budget_exceeded","used_rub":...,"limit_rub":...,"reset_at":"..."}` + `Retry-After` |
| `503` | Global monthly budget exceeded | `{"error":"service_paused_global_budget","reset_at":"..."}` + `Retry-After` |

## Acceptance criteria

Smoke checks against a freshly-rolled deployment (or `docker-compose.prod.yml` locally):

1. `curl https://${DOMAIN}/api/runs -X POST -d '{}'` → 403 (no Origin).
2. `curl -H "Origin: https://${DOMAIN}" -A "curl/8" https://${DOMAIN}/api/runs -X POST -d '{}'` → 403 (UA blocked).
3. `curl -H "Origin: https://${DOMAIN}" -A "Mozilla/5.0" https://${DOMAIN}/api/runs -X POST -d '{}'` → 401 (no session).
4. Browser opens `https://${DOMAIN}/`, gets `pat_uid` cookie + `<meta pat-session>`. First chat works.
5. `curl ... -X POST -d "$(head -c 100000 /dev/urandom | base64)"` → 413.
6. Open 4 concurrent SSE streams from one IP → 4th gets 503 from nginx `limit_conn`.
7. Force a row in `budget_usage` to `used_rub=499` for a test cookie → next run returns header `X-Budget-Warning`. Next-next run with `used_rub` past 500 returns 429.
8. Force `__global_month` row past 30 000 → all runs return 503.
9. Run a real chat round, then `SELECT used_rub FROM budget_usage` shows a row in low-tens of rubles for both the cookie subject and `__global_month`.
10. Restart backend mid-stream after the LangGraph node started — verify accounting still landed (because the node ran to completion before the disconnect).

## Tests (unit)

- `apps/backend/tests/unit/test_budget_pricing.py`: known token counts produce expected rubles for both models; `__default__` fallback fires for unknown.
- `apps/backend/tests/unit/test_budget_storage.py`: UPSERT semantics (two inserts on same key sum); reads return 0 on absent key; uses `patristic_test` and the existing `db_clean` fixture (extended to also TRUNCATE `budget_usage`).
- `apps/backend/tests/unit/test_session_hmac.py`: sign+verify roundtrip; tampered token fails; different cookie fails; different date fails; constant-time-compare used.
- `apps/backend/tests/unit/test_budget_endpoint.py`: FastAPI TestClient against `/budget/check` — cookie subject vs ip subject vs global month, allowed vs warn vs deny.

Frontend (vitest): one test for `getPatSession()` returning meta content, one for `BudgetBanner` rendering on warning state.

No new integration tests against the live agent — the existing goldset proves the agent still works; the budget node is checked through its unit test on synthetic state.

## Rollout / rollback

- **Flag:** `BUDGET_GUARD_ENABLED` env (`true` default). When `false`, `/budget/check` always returns `allowed=true, warn=false`, and the post-run node logs the would-be charge but skips the write. This is the rollback knob: if the guard misbehaves, flip the flag without redeploying.
- **Phased rollout:** ship with guard enabled, monitor `budget_usage` for a week against actual usage, calibrate the 500/250 ₽ defaults from real data.
- **Secret rotation:** rotating `PAT_SESSION_SECRET` invalidates all live tabs (they get 401 → silent refresh via `/api/session` works only if the cookie is still valid; if not, page reload fixes it). Document this in `CLAUDE.md`.

## Out of scope (phase C — add only on observed abuse)

- Yandex SmartCaptcha on `/api/runs` for new-cookie + first-request, or for cloud-ASN IPs.
- ASN/cloud-egress blocklist (AWS, DO, Hetzner, OVH ranges) — auto-update from public lists.
- Geo-filter (RU + CIS only) via `geoip2_country`.
- `fail2ban` integration on nginx access log for repeat-offender 429s.
- Per-tool budget breakdown (e.g. cap `semantic_search` calls per run).
- Distinguishing "agent retry" usage from "user retry" usage in accounting.

## Files touched

**New:**
- `docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md` (this file)
- `infra/migrations/002_abuse_budget.sql`
- `infra/docker-compose.prod.yml`
- `infra/nginx/proxy_common.conf`
- `apps/backend/src/backend/budget/__init__.py`
- `apps/backend/src/backend/budget/pricing.py`
- `apps/backend/src/backend/budget/storage.py`
- `apps/backend/src/backend/budget/session.py`
- `apps/backend/src/backend/budget/node.py`
- `apps/backend/tests/unit/test_budget_pricing.py`
- `apps/backend/tests/unit/test_budget_storage.py`
- `apps/backend/tests/unit/test_session_hmac.py`
- `apps/backend/tests/unit/test_budget_endpoint.py`
- `apps/frontend/src/middleware.ts`
- `apps/frontend/src/lib/session.ts`
- `apps/frontend/src/components/logos/BudgetBanner.tsx`
- `apps/frontend/src/app/api/session/route.ts`

**Modified:**
- `infra/nginx/nginx.prod.conf` (rewrite from stock template)
- `infra/nginx/Dockerfile.prod` (add `envsubst` step on container start)
- `apps/backend/src/backend/config.py` (new settings)
- `apps/backend/src/backend/catalog.py` (CORS from env + `/budget/check`)
- `apps/backend/src/backend/graph.py` (wire budget node)
- `apps/backend/tests/conftest.py` (TRUNCATE `budget_usage` in `db_clean`)
- `apps/frontend/src/app/layout.tsx` (inject `<meta pat-session>`)
- `apps/frontend/src/app/api/[..._path]/route.ts` (replace passthrough with custom proxy)
- `apps/frontend/src/providers/Stream.tsx` (inject `X-Pat-Session`, handle 401/429/503, surface warning header)
- `apps/frontend/src/components/logos/LogosShell.tsx` (mount `BudgetBanner`, surface global 503 block)
- `apps/frontend/src/components/logos/i18n.ts` (new keys)
- `/.env.example` (new env vars documented)
- `CLAUDE.md` (briefly note the new gotchas: env vars, secret rotation, prod = nginx-fronted)
