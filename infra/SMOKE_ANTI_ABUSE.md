# Anti-abuse smoke checklist

End-to-end verification of the anti-abuse layers landed in 2026-05-17. Run
against a fresh `docker compose -f infra/docker-compose.prod.yml up -d --build`
stack (locally with self-signed TLS, or staging with a real domain).

Prereqs:
1. Stack is up: `docker compose -f infra/docker-compose.prod.yml ps` shows
   `postgres healthy`, `backend Up`, `nextjs Up`, `nginx Up`.
2. Migrations applied to the prod-compose postgres:
   ```
   docker exec -i <pg-container> psql -U postgres -d patristic < infra/migrations/001_init.sql
   docker exec -i <pg-container> psql -U postgres -d patristic < infra/migrations/002_abuse_budget.sql
   ```
3. `.env` (root, loaded by both backend and nextjs) has `PAT_SESSION_SECRET`
   set to `openssl rand -hex 32`. `DOMAIN` set (e.g. `localhost` for dev TLS).
   `ALLOWED_ORIGIN` set to `https://${DOMAIN}`.

## Checks

**Note (2026-05-17):** As of the MCP-prod-rollout spec, only `/api/info`,
`/api/catalog`, `/api/openapi.json`, `/api/mcp`, and `/api/runs/stream`
reach the backend. Everything else (`/store/*`, `/runs/batch`,
`/runs/crons*`, `/a2a`, `/threads` GET, `/assistants/*`) returns `404`
from the proxy without contacting backend. The HMAC checks (#1-3) apply
ONLY to `/runs/stream`; public paths bypass HMAC entirely.


For each `curl` example, replace `https://localhost` with your real domain.
Use `-k` only for local self-signed TLS.

- [ ] **1. No Origin → 403.** `/api/runs*` requires `Origin: https://${DOMAIN}`.
  ```
  curl -ki -X POST https://localhost/api/runs -d '{}' -H "Content-Type: application/json"
  ```
  Expect: `HTTP/2 403`.

- [ ] **2. curl UA → 403.** UA blacklist on `/api/*` blocks scripted clients.
  ```
  curl -ki -X POST https://localhost/api/runs -d '{}' \
    -H "Origin: https://localhost" -H "Content-Type: application/json"
  ```
  Expect: `HTTP/2 403` (UA `curl/X` matched).

- [ ] **3. Mozilla UA but no session → 401.** Proxy HMAC verify fires.
  ```
  curl -ki -X POST https://localhost/api/runs -d '{}' \
    -H "Origin: https://localhost" -H "Content-Type: application/json" \
    -A "Mozilla/5.0"
  ```
  Expect: `HTTP/2 401` with body `{"error":"session_invalid"}`.

- [ ] **4. Browser chat works end-to-end.** Open `https://${DOMAIN}/` in a
  fresh incognito window. Verify in DevTools:
  - `pat_uid` HttpOnly cookie set on first request.
  - `<meta name="pat-session">` populated with a 43-char base64url string.
  - Sending a chat message produces a real answer.

- [ ] **5. 100KB body → 413.** `client_max_body_size 32k` on `/api/runs*`.
  ```
  head -c 100000 /dev/urandom | base64 > /tmp/big.json
  curl -ki -X POST https://localhost/api/runs --data-binary "@/tmp/big.json" \
    -H "Origin: https://localhost" -H "Content-Type: application/json" \
    -A "Mozilla/5.0"
  ```
  Expect: `HTTP/2 413`.

- [ ] **6. 4 parallel SSE streams → 4th 429.** `limit_conn stream_conn 3`
  caps concurrent stream connections per IP.
  Open 3 long-lived SSE connections, then a 4th:
  ```
  for i in 1 2 3 4; do
    curl -kN https://localhost/api/runs/stream ... -H "..." &
  done
  ```
  Expect: 4th connection returns `HTTP/2 429`.

- [ ] **7. Soft budget warning at 80%.** Seed via DB:
  ```
  docker exec <pg> psql -U postgres -d patristic -c \
    "INSERT INTO budget_usage VALUES ('cookie:<your-uuid>', '$(date +%Y-%m-%d)', 450, now()) ON CONFLICT (subject_key,bucket) DO UPDATE SET used_rub=450"
  ```
  Send a chat message → response has `X-Budget-Warning: used=450;limit=500`
  header → `BudgetBanner` appears in UI.

- [ ] **8. Hard 429 at 100%.** Bump the row to 600:
  ```
  ... DO UPDATE SET used_rub=600
  ```
  Next chat request → proxy returns 429 `{"error":"daily_budget_exceeded",...}`
  → Sonner toast shows "Дневной лимит исчерпан…".

- [ ] **9. Global month kill-switch → 503.** Seed `__global_month`:
  ```
  ... ('__global_month', '$(date +%Y-%m)', 30001, now()) ...
  ```
  Any chat request → proxy returns 503 `{"error":"service_paused_global_budget"}`
  → `LogosShell` shows the top-pinned "Сервис временно приостановлен" alert.

- [ ] **10. Real chat writes both budget rows.** After a successful round-trip:
  ```
  docker exec <pg> psql -U postgres -d patristic -c \
    "SELECT * FROM budget_usage ORDER BY updated_at DESC LIMIT 5;"
  ```
  Expect: `cookie:<uuid>` and `__global_month` rows with the same
  `used_rub` value (single-digit to low-tens of rubles for a basic query).

- [ ] **11. MCP reachable without HMAC.** The product feature.
  ```
  curl -ki -X POST https://${DOMAIN}/api/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
  Expect: `HTTP/2 200` with JSON listing 6 tools (`read_passage`,
  `lexical_search`, `semantic_search`, `list_authors`, `list_works`,
  `expand_concept`). No `Origin`, no `pat_uid`, no `X-Pat-Session`
  required — that's the point.

- [ ] **12. MCP rate-limited by IP.** Fire 121 requests to `/api/mcp` in 60s
  → 121st returns `HTTP/2 429` (mcp_zone 120r/m).

- [ ] **13. Blacklist returns 404 from proxy.** Each should return `HTTP/2 404`
  with empty body, AND backend should never see the request (verify via
  nginx access log or backend log silence):
  ```
  curl -ki https://${DOMAIN}/api/store/items
  curl -ki -X POST https://${DOMAIN}/api/runs/batch -d '{}'
  curl -ki -X POST https://${DOMAIN}/api/runs/crons -d '{}'
  curl -ki https://${DOMAIN}/api/threads
  curl -ki https://${DOMAIN}/api/a2a
  curl -ki https://${DOMAIN}/api/assistants
  ```

- [ ] **14. ConnectAgent modal works.** Open `https://${DOMAIN}/` → click
  "Подключить" pill in TopChrome → modal opens → both tabs render →
  copy buttons copy + show Sonner toast → "Исходники на GitHub" link
  opens `github.com/logospatrum/patristic-plugin` in new tab.

- [ ] **15. BottomChrome GitHub link.** Visible on home (faded on chat
  per existing BottomChrome opacity transition). Click → opens
  `github.com/logospatrum/logospatrum`.

- [ ] **16. Plugin install end-to-end.** Fresh Claude Code instance:
  ```
  /plugin marketplace add https://github.com/logospatrum/patristic-plugin
  /plugin install patristic
  ```
  Ask theological question (e.g. "что говорят отцы о любви к врагам")
  → `theology-router` skill activates → main delegates to `teo-search`
  → main reads passages via `read_passage` → cites correctly.

- [ ] **17. Backend port 8000 reachable from nginx (Stage 2 only).**
  After `docker compose pull && docker compose up -d backend` with the
  langgraph-built image:
  ```
  docker exec <nginx-container-id> sh -c 'wget -qO- http://backend:8000/info | head -3'
  ```
  Expect: JSON with langgraph version info. Old `:2024` is no longer
  bound inside the backend container.

## Pass/fail tracking

Date: ______
Stack git SHA: ______
Tester: ______

| # | Result | Notes |
|---|--------|-------|
| 1 |        |       |
| 2 |        |       |
| 3 |        |       |
| 4 |        |       |
| 5 |        |       |
| 6 |        |       |
| 7 |        |       |
| 8 |        |       |
| 9 |        |       |
| 10 |       |       |
