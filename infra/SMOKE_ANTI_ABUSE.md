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
