# Anti-abuse rate limits + RUB budget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Защитить токеновый бюджет публично-анонимного чата от ботов и любопытных. Слои: nginx (TLS + rate-limit + body cap + Origin guard + UA blacklist), Next.js (cookie `pat_uid` + HMAC session token + custom API proxy с pre-run budget check), backend (FastAPI `/budget/check` + LangGraph node для post-run accounting в Postgres), Postgres (новая таблица `budget_usage`).

**Architecture:** Frontend ходит в LangGraph только через Next.js `/api/*` proxy. Бэкенд не виден наружу (в prod compose без `ports:`). Бюджет считается в рублях по `usage_metadata` из state агента, лимит per-cookie 500₽/день (per-IP 250₽/день fallback), глобальный month-kill 30 000₽. Лимит soft@80% (warning header) → hard@100% (429). Подробности — спека [docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md](../specs/2026-05-16-anti-abuse-rate-limits-design.md).

**Tech Stack:** nginx 1.25+ alpine (envsubst templates), Next.js 15 App Router middleware + node-runtime route handler, FastAPI 0.115 (через `langgraph.json:http.app`), LangGraph graph node, psycopg-async + asyncpg pool, Postgres 16 + pgvector (существующий), HMAC-SHA256 (Node `crypto` + Python `hmac`), Docker Compose.

**Ship-gate:** Каждая фаза должна оставлять систему в работоспособном состоянии (`langgraph dev` + `npm run dev` поднимаются, существующий smoke chat работает). Финальная фаза — 10 acceptance проверок из спеки.

---

## Файловая структура после плана

```
infra/
├── nginx/
│   ├── nginx.prod.conf              # REWRITE
│   ├── proxy_common.conf            # NEW — общие proxy_set_header'ы
│   └── Dockerfile.prod              # EDIT — templates/envsubst
├── docker-compose.prod.yml          # NEW
└── migrations/
    └── 002_abuse_budget.sql         # NEW

apps/backend/src/backend/
├── budget/                          # NEW package
│   ├── __init__.py
│   ├── pricing.py                   # NEW — tariff table + cost_rub()
│   ├── storage.py                   # NEW — get_used_rub / add_usage (PG UPSERT)
│   ├── session.py                   # NEW — HMAC sign/verify (sym с фронтом)
│   └── node.py                      # NEW — post-run accounting node
├── catalog.py                       # EDIT — CORS env-driven + /budget/check + /session
├── config.py                        # EDIT — новые env vars
├── graph.py                         # EDIT — wire budget node на конец графа
└── ...

apps/backend/tests/
├── conftest.py                      # EDIT — TRUNCATE budget_usage в db_clean
└── unit/
    ├── test_budget_pricing.py       # NEW
    ├── test_budget_storage.py       # NEW
    ├── test_session_hmac.py         # NEW
    ├── test_budget_node.py          # NEW — post-run node вокруг fake state
    └── test_budget_endpoint.py      # NEW — FastAPI TestClient

apps/frontend/src/
├── middleware.ts                    # NEW — cookie + meta header inject
├── app/
│   ├── layout.tsx                   # EDIT — <meta name="pat-session"> из заголовка middleware
│   └── api/
│       ├── [..._path]/route.ts      # REWRITE — custom node-runtime proxy
│       └── session/route.ts         # NEW — HMAC refresh endpoint
├── lib/
│   └── session.ts                   # NEW — getPatSession() helper
├── providers/
│   └── Stream.tsx                   # EDIT — inject X-Pat-Session, 401/429/503 handling, surface warning
├── components/
│   └── logos/
│       ├── BudgetBanner.tsx         # NEW
│       ├── LogosShell.tsx           # EDIT — mount BudgetBanner + global 503 block
│       └── i18n.ts                  # EDIT — новые ключи
└── ...

.env.example                         # EDIT — документировать новые vars
CLAUDE.md                            # EDIT — заметки про новые env + prod=nginx-fronted
```

---

## Phase 0 — Подготовка окружения

### Task 0.1: Создать ветку и убедиться что тесты зелёные

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/anti-abuse-budget
```

- [ ] **Step 2: Backend unit-тесты прогоняются как baseline**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v
```

Expected: всё зелёное (~33 теста по `CLAUDE.md`).

- [ ] **Step 3: Frontend vitest baseline**

```bash
cd apps/frontend && npm test
```

Expected: 21 тест проходит.

- [ ] **Step 4: Зафиксировать baseline в plan-комменте**

Никакой команды — записать в TODO «baseline зелёный на коммите `<sha>`», чтобы потом легко сравнить.

---

## Phase 1 — Postgres миграция + чистые модули (pricing, storage, session)

Все задачи этой фазы — pure additions, ничего не ломают. После Phase 1 у нас есть:
- таблица `budget_usage` в `patristic` и `patristic_test`
- модуль `backend.budget.pricing` (₽ из токенов)
- модуль `backend.budget.storage` (UPSERT/SELECT)
- модуль `backend.budget.session` (HMAC sign/verify)
- покрывающие unit-тесты

Без интеграции — ещё ничего не вызывает эти модули.

### Task 1.1: Миграция БД

**Files:**
- Create: `infra/migrations/002_abuse_budget.sql`

- [ ] **Step 1: Создать файл миграции**

```sql
-- infra/migrations/002_abuse_budget.sql
CREATE TABLE IF NOT EXISTS budget_usage (
    subject_key  TEXT          NOT NULL,
    bucket       TEXT          NOT NULL,
    used_rub     NUMERIC(12,4) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_key, bucket)
);
CREATE INDEX IF NOT EXISTS budget_usage_bucket_idx ON budget_usage (bucket);
```

- [ ] **Step 2: Применить к prod DB (`patristic`)**

```bash
docker exec -i patristic-postgres-dev psql -U postgres -d patristic < infra/migrations/002_abuse_budget.sql
```

Expected: `CREATE TABLE` + `CREATE INDEX`.

- [ ] **Step 3: Применить к test DB (`patristic_test`)**

```bash
docker exec -i patristic-postgres-dev psql -U postgres -d patristic_test < infra/migrations/002_abuse_budget.sql
```

- [ ] **Step 4: Проверить схему**

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "\d budget_usage"
```

Expected: видим колонки `subject_key, bucket, used_rub, updated_at` + PK + index.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/002_abuse_budget.sql
git commit -m "feat(infra): add budget_usage table for anti-abuse accounting"
```

---

### Task 1.2: Расширить `conftest.py` чтобы `db_clean` чистил `budget_usage`

**Files:**
- Modify: `apps/backend/tests/conftest.py`

- [ ] **Step 1: Найти фикстуру**

```bash
grep -n TRUNCATE apps/backend/tests/conftest.py
```

Найди строку с `TRUNCATE authors, works, chapters, paragraphs, embeddings CASCADE`.

- [ ] **Step 2: Добавить `budget_usage`**

В этой же строке расширь список таблиц до:
```
TRUNCATE authors, works, chapters, paragraphs, embeddings, budget_usage CASCADE
```

(Делать через Edit с уникальным контекстом — обязательно проверить файл, см. [apps/backend/CLAUDE.md] про защиту от удаления prod корпуса.)

- [ ] **Step 3: Прогнать тесты — должны всё ещё проходить**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v
```

Expected: зелёное (ничто пока не использует `budget_usage`, но truncate не падает).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/tests/conftest.py
git commit -m "test(backend): extend db_clean to truncate budget_usage"
```

---

### Task 1.3: Pricing module — failing test first

**Files:**
- Create: `apps/backend/tests/unit/test_budget_pricing.py`

- [ ] **Step 1: Написать failing test**

```python
# apps/backend/tests/unit/test_budget_pricing.py
import pytest
from backend.budget.pricing import cost_rub, TARIFF_RUB


def test_sonnet_known_cost():
    # 1M input + 1M output of Sonnet 4.6 = 405 + 2025 = 2430 ₽
    assert cost_rub("claude-sonnet-4-6", 1_000_000, 1_000_000) == pytest.approx(2430.0)


def test_haiku_known_cost():
    # 1M input + 1M output of Haiku 4.5 = 108 + 540 = 648 ₽
    assert cost_rub("claude-haiku-4-5", 1_000_000, 1_000_000) == pytest.approx(648.0)


def test_anthropic_prefix_stripped():
    # Anthropic SDK puts the provider prefix; pricing must normalize.
    assert cost_rub("anthropic/claude-sonnet-4-6", 1000, 0) == pytest.approx(0.405)


def test_unknown_model_falls_back_to_default_pessimistically():
    # Unknown ≠ free. Default tariff is pessimistic.
    cost = cost_rub("some-future-model-x", 1000, 1000)
    assert cost == pytest.approx(0.5 + 2.5)  # 500 + 2500 per Mtok
    assert "__default__" in TARIFF_RUB


def test_zero_tokens_zero_cost():
    assert cost_rub("claude-sonnet-4-6", 0, 0) == 0.0
```

- [ ] **Step 2: Run test — expect ImportError**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_pricing.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.budget'`.

- [ ] **Step 3: Создать пакет + pricing.py**

```python
# apps/backend/src/backend/budget/__init__.py
"""Anti-abuse RUB-budget accounting. See docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md"""
```

```python
# apps/backend/src/backend/budget/pricing.py
from typing import TypedDict


class Tariff(TypedDict):
    input_per_mtok: float
    output_per_mtok: float


TARIFF_RUB: dict[str, Tariff] = {
    "claude-sonnet-4-6": {"input_per_mtok": 405.0, "output_per_mtok": 2025.0},
    "claude-haiku-4-5":  {"input_per_mtok": 108.0, "output_per_mtok": 540.0},
    # Pessimistic fallback: a misconfigured model registers as expensive, not free.
    "__default__":       {"input_per_mtok": 500.0, "output_per_mtok": 2500.0},
}


def cost_rub(model: str, input_tokens: int, output_tokens: int) -> float:
    t = TARIFF_RUB.get(_normalize_model(model)) or TARIFF_RUB["__default__"]
    return (
        input_tokens  * t["input_per_mtok"]  / 1_000_000
        + output_tokens * t["output_per_mtok"] / 1_000_000
    )


def _normalize_model(model: str) -> str:
    # Anthropic returns "anthropic/claude-sonnet-4-6" or just "claude-sonnet-4-6".
    return model.split("/")[-1]
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_pricing.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/backend/budget/__init__.py apps/backend/src/backend/budget/pricing.py apps/backend/tests/unit/test_budget_pricing.py
git commit -m "feat(backend): add budget.pricing module with Sonnet/Haiku Timeweb tariffs"
```

---

### Task 1.4: Storage module — failing test first

**Files:**
- Create: `apps/backend/tests/unit/test_budget_storage.py`
- Create: `apps/backend/src/backend/budget/storage.py`

- [ ] **Step 1: Написать failing test**

```python
# apps/backend/tests/unit/test_budget_storage.py
import pytest
from backend.budget import storage


@pytest.mark.asyncio
async def test_get_returns_zero_when_absent(db_clean):
    used = await storage.get_used_rub("cookie:abc", "2026-05-17")
    assert used == 0.0


@pytest.mark.asyncio
async def test_add_inserts_first_time(db_clean):
    after = await storage.add_usage("cookie:abc", "2026-05-17", 12.34)
    assert after == pytest.approx(12.34)
    used = await storage.get_used_rub("cookie:abc", "2026-05-17")
    assert used == pytest.approx(12.34)


@pytest.mark.asyncio
async def test_add_upserts_on_repeat(db_clean):
    await storage.add_usage("cookie:abc", "2026-05-17", 10.0)
    after = await storage.add_usage("cookie:abc", "2026-05-17", 5.5)
    assert after == pytest.approx(15.5)


@pytest.mark.asyncio
async def test_keys_are_isolated_per_subject_and_bucket(db_clean):
    await storage.add_usage("cookie:a", "2026-05-17", 100.0)
    await storage.add_usage("cookie:b", "2026-05-17", 200.0)
    await storage.add_usage("cookie:a", "2026-05-18", 50.0)
    assert await storage.get_used_rub("cookie:a", "2026-05-17") == pytest.approx(100.0)
    assert await storage.get_used_rub("cookie:b", "2026-05-17") == pytest.approx(200.0)
    assert await storage.get_used_rub("cookie:a", "2026-05-18") == pytest.approx(50.0)


def test_today_msk_format():
    today = storage._today_msk()
    assert len(today) == 10 and today[4] == "-" and today[7] == "-"


def test_this_month_msk_format():
    month = storage._this_month_msk()
    assert len(month) == 7 and month[4] == "-"
```

- [ ] **Step 2: Run test — expect ImportError / NameError**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_storage.py -v
```

Expected: `ImportError: cannot import name 'storage' from 'backend.budget'`.

- [ ] **Step 3: Implement storage.py**

```python
# apps/backend/src/backend/budget/storage.py
from datetime import datetime, timedelta, timezone

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
    """UPSERT — returns total used_rub for this (subject, bucket) after the add."""
    async with conn() as c:
        cur = await c.execute(
            """
            INSERT INTO budget_usage (subject_key, bucket, used_rub)
            VALUES (%s, %s, %s)
            ON CONFLICT (subject_key, bucket)
            DO UPDATE SET used_rub   = budget_usage.used_rub + EXCLUDED.used_rub,
                          updated_at = now()
            RETURNING used_rub
            """,
            (subject, bucket, delta_rub),
        )
        row = await cur.fetchone()
        await c.commit()
        return float(row[0])
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_storage.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/backend/budget/storage.py apps/backend/tests/unit/test_budget_storage.py
git commit -m "feat(backend): add budget.storage with race-free PG UPSERT on budget_usage"
```

---

### Task 1.5: Session HMAC module — failing test first

**Files:**
- Create: `apps/backend/tests/unit/test_session_hmac.py`
- Create: `apps/backend/src/backend/budget/session.py`

- [ ] **Step 1: Написать failing test**

```python
# apps/backend/tests/unit/test_session_hmac.py
import pytest
from backend.budget import session as sess

SECRET = "0" * 64  # 32-byte hex


def test_sign_then_verify_roundtrip():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-17", token) is True


def test_verify_fails_on_tampered_token():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-17", tampered) is False


def test_verify_fails_on_wrong_cookie():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:xyz", "2026-05-17", token) is False


def test_verify_fails_on_wrong_date():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    assert sess.verify(SECRET, "cookie:abc", "2026-05-18", token) is False


def test_verify_fails_on_wrong_secret():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    other = "1" * 64
    assert sess.verify(other, "cookie:abc", "2026-05-17", token) is False


def test_token_is_url_safe_base64():
    token = sess.sign(SECRET, "cookie:abc", "2026-05-17")
    import string
    allowed = string.ascii_letters + string.digits + "-_="
    assert all(ch in allowed for ch in token)
```

- [ ] **Step 2: Run test — expect ImportError**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_session_hmac.py -v
```

Expected: `ImportError: cannot import name 'session' from 'backend.budget'`.

- [ ] **Step 3: Implement session.py**

```python
# apps/backend/src/backend/budget/session.py
"""HMAC-SHA256 session token, symmetrical with apps/frontend/src/middleware.ts."""

import base64
import hashlib
import hmac


def sign(secret: str, pat_uid: str, date_str: str) -> str:
    """Return URL-safe base64 token of HMAC_SHA256(secret, pat_uid + ':' + date_str)."""
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{pat_uid}:{date_str}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(mac).decode("ascii")


def verify(secret: str, pat_uid: str, date_str: str, token: str) -> bool:
    expected = sign(secret, pat_uid, date_str)
    return hmac.compare_digest(expected, token)
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_session_hmac.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/backend/budget/session.py apps/backend/tests/unit/test_session_hmac.py
git commit -m "feat(backend): add budget.session HMAC token (sign/verify)"
```

---

## Phase 2 — Backend config + FastAPI `/budget/check` + `/api/session`

После Phase 2:
- В `backend.config.settings` есть новые env vars
- FastAPI отдаёт `GET /budget/check?subject=...` и `GET /session/refresh?cookie=...`
- CORS allow-origin берётся из env

Никто пока не вызывает эти endpoints — но они проверяемы из curl.

### Task 2.1: Расширить `backend/config.py`

**Files:**
- Modify: `apps/backend/src/backend/config.py`

- [ ] **Step 1: Прочитать текущий config**

```bash
cat apps/backend/src/backend/config.py
```

Запомни структуру `Settings(BaseSettings)`.

- [ ] **Step 2: Добавить поля**

Добавь в класс `Settings`:

```python
    # === anti-abuse / budget ===
    pat_session_secret: str = ""  # 32-byte hex; required in prod
    allowed_origin: str = "http://localhost:3000"
    daily_rub_per_cookie: float = 500.0
    daily_rub_per_ip: float = 250.0
    soft_warn_ratio: float = 0.8
    global_monthly_kill_rub: float = 30_000.0
    budget_guard_enabled: bool = True
```

- [ ] **Step 3: Sanity-check import**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -c "from backend.config import settings; print(settings.daily_rub_per_cookie, settings.allowed_origin)"
```

Expected: `500.0 http://localhost:3000`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/backend/config.py
git commit -m "feat(backend): config — add PAT session + RUB budget envs"
```

---

### Task 2.2: `/budget/check` endpoint — failing test first

**Files:**
- Create: `apps/backend/tests/unit/test_budget_endpoint.py`
- Modify: `apps/backend/src/backend/catalog.py`

- [ ] **Step 1: Написать failing test**

```python
# apps/backend/tests/unit/test_budget_endpoint.py
import pytest
from fastapi.testclient import TestClient

from backend.catalog import app
from backend.budget import storage


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_cookie_subject_allowed_when_under_limit(db_clean, client):
    await storage.add_usage("cookie:test1", storage._today_msk(), 100.0)
    r = client.get("/budget/check", params={"subject": "cookie:test1"})
    assert r.status_code == 200
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is False
    assert data["used_rub"] == pytest.approx(100.0)
    assert data["limit_rub"] == pytest.approx(500.0)


@pytest.mark.asyncio
async def test_cookie_subject_warn_at_80pct(db_clean, client):
    await storage.add_usage("cookie:test2", storage._today_msk(), 400.0)
    r = client.get("/budget/check", params={"subject": "cookie:test2"})
    data = r.json()
    assert data["allowed"] is True
    assert data["warn"] is True


@pytest.mark.asyncio
async def test_cookie_subject_denied_at_100pct(db_clean, client):
    await storage.add_usage("cookie:test3", storage._today_msk(), 501.0)
    r = client.get("/budget/check", params={"subject": "cookie:test3"})
    data = r.json()
    assert data["allowed"] is False


@pytest.mark.asyncio
async def test_ip_subject_uses_lower_limit(db_clean, client):
    # IP cap = 250 ₽
    await storage.add_usage("ip:1.2.3.4", storage._today_msk(), 251.0)
    r = client.get("/budget/check", params={"subject": "ip:1.2.3.4"})
    data = r.json()
    assert data["allowed"] is False
    assert data["limit_rub"] == pytest.approx(250.0)


@pytest.mark.asyncio
async def test_global_month_subject(db_clean, client):
    await storage.add_usage("__global_month", storage._this_month_msk(), 30_001.0)
    r = client.get("/budget/check", params={"subject": "__global_month"})
    data = r.json()
    assert data["allowed"] is False
    assert data["limit_rub"] == pytest.approx(30_000.0)
```

- [ ] **Step 2: Run — expect 404 or AttributeError on /budget/check**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_endpoint.py -v
```

Expected: failures with `404 Not Found`.

- [ ] **Step 3: Реализовать endpoint в catalog.py**

Прочитать существующий `catalog.py`. После определения `app = FastAPI(...)` добавить:

```python
from datetime import datetime, timedelta
from .config import settings
from .budget import storage

# CORS — replace existing hardcoded allow_origins with env-driven
from fastapi.middleware.cors import CORSMiddleware
# (remove the hardcoded ["http://localhost:3000"] block; replace with:)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origin.split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)


def _tomorrow_msk_iso() -> str:
    today = datetime.strptime(storage._today_msk(), "%Y-%m-%d").replace(tzinfo=storage.MSK)
    return (today + timedelta(days=1)).isoformat()


def _next_month_msk_iso() -> str:
    month = datetime.strptime(storage._this_month_msk() + "-01", "%Y-%m-%d").replace(tzinfo=storage.MSK)
    # 1st of next month
    if month.month == 12:
        nxt = month.replace(year=month.year + 1, month=1)
    else:
        nxt = month.replace(month=month.month + 1)
    return nxt.isoformat()


@app.get("/budget/check")
async def budget_check(subject: str) -> dict:
    if subject == "__global_month":
        used = await storage.get_used_rub(subject, storage._this_month_msk())
        limit = settings.global_monthly_kill_rub
        return {
            "allowed": used < limit,
            "used_rub": used,
            "limit_rub": limit,
            "warn": used >= settings.soft_warn_ratio * limit,
            "reset_at": _next_month_msk_iso(),
        }
    limit = (
        settings.daily_rub_per_cookie
        if subject.startswith("cookie:")
        else settings.daily_rub_per_ip
    )
    used = await storage.get_used_rub(subject, storage._today_msk())
    return {
        "allowed": used < limit,
        "used_rub": used,
        "limit_rub": limit,
        "warn": used >= settings.soft_warn_ratio * limit,
        "reset_at": _tomorrow_msk_iso(),
    }
```

**Важно:** удалить старый hardcoded CORS middleware блок (`allow_origins=["http://localhost:3000"]`) — заменить полностью на env-driven.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_endpoint.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Прогнать все unit-тесты — ничего не сломалось**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v
```

Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/backend/catalog.py apps/backend/tests/unit/test_budget_endpoint.py
git commit -m "feat(backend): add GET /budget/check + env-driven CORS"
```

---

### Task 2.3: `/session/refresh` endpoint

**Files:**
- Modify: `apps/backend/src/backend/catalog.py`

- [ ] **Step 1: Дописать тест**

В `test_budget_endpoint.py` добавить:

```python
def test_session_refresh_returns_token_for_cookie(monkeypatch, client):
    monkeypatch.setattr("backend.config.settings.pat_session_secret", "0" * 64)
    r = client.get("/session/refresh", params={"cookie": "abc-uid"})
    assert r.status_code == 200
    data = r.json()
    assert data["token"]
    assert data["expires_at"]


def test_session_refresh_400_when_no_secret(monkeypatch, client):
    monkeypatch.setattr("backend.config.settings.pat_session_secret", "")
    r = client.get("/session/refresh", params={"cookie": "abc"})
    assert r.status_code == 500   # misconfigured server
```

- [ ] **Step 2: Run — expect 404**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_endpoint.py -v
```

- [ ] **Step 3: Реализовать**

В `catalog.py` добавь:

```python
from fastapi import HTTPException
from .budget import session as sess


@app.get("/session/refresh")
async def session_refresh(cookie: str) -> dict:
    if not settings.pat_session_secret:
        raise HTTPException(status_code=500, detail="PAT_SESSION_SECRET not configured")
    pat_uid = f"cookie:{cookie}"
    today = storage._today_msk()
    token = sess.sign(settings.pat_session_secret, pat_uid, today)
    return {"token": token, "expires_at": _tomorrow_msk_iso()}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_endpoint.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/backend/catalog.py apps/backend/tests/unit/test_budget_endpoint.py
git commit -m "feat(backend): add GET /session/refresh — HMAC token issuance"
```

---

## Phase 3 — Post-run accounting node в LangGraph

После Phase 3 каждый run пишет ₽-стоимость в `budget_usage`. `subject_key` берётся из `config.configurable["subject_key"]`; если отсутствует — `"__unknown__"` (всё равно accounting).

### Task 3.1: Budget node — failing test first

**Files:**
- Create: `apps/backend/tests/unit/test_budget_node.py`
- Create: `apps/backend/src/backend/budget/node.py`

- [ ] **Step 1: Test fake state → expected ₽ written**

```python
# apps/backend/tests/unit/test_budget_node.py
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from backend.budget import node, storage


def _ai(model: str, input_tokens: int, output_tokens: int) -> AIMessage:
    msg = AIMessage(content="ok")
    msg.response_metadata = {"model": model}
    msg.usage_metadata = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }
    return msg


@pytest.mark.asyncio
async def test_node_records_sonnet_cost(db_clean):
    state = {
        "messages": [
            HumanMessage(content="..."),
            _ai("anthropic/claude-sonnet-4-6", 10_000, 1_000),
            # expected: 10_000 * 405/1M + 1_000 * 2025/1M = 4.05 + 2.025 = 6.075 ₽
        ]
    }
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:abc"}}
    await node.budget_record(state, cfg)
    used = await storage.get_used_rub("cookie:abc", storage._today_msk())
    assert used == pytest.approx(6.075, rel=1e-3)
    # Global month also incremented
    g = await storage.get_used_rub("__global_month", storage._this_month_msk())
    assert g == pytest.approx(6.075, rel=1e-3)


@pytest.mark.asyncio
async def test_node_sums_subagent_haiku_and_main_sonnet(db_clean):
    state = {
        "messages": [
            HumanMessage(content="..."),
            _ai("claude-haiku-4-5", 50_000, 5_000),    # 50_000*108/1M + 5_000*540/1M = 5.4 + 2.7 = 8.1
            _ai("claude-sonnet-4-6", 20_000, 2_000),   # 20_000*405/1M + 2_000*2025/1M = 8.1 + 4.05 = 12.15
            # total: 20.25
        ]
    }
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:x"}}
    await node.budget_record(state, cfg)
    assert await storage.get_used_rub("cookie:x", storage._today_msk()) == pytest.approx(20.25, rel=1e-3)


@pytest.mark.asyncio
async def test_node_falls_back_to_unknown_subject(db_clean):
    state = {"messages": [_ai("claude-sonnet-4-6", 1000, 0)]}
    await node.budget_record(state, {})  # no configurable
    assert await storage.get_used_rub("__unknown__", storage._today_msk()) == pytest.approx(0.405, rel=1e-3)


@pytest.mark.asyncio
async def test_node_swallows_db_errors(monkeypatch, db_clean):
    # Even if storage explodes, the node must not raise — accounting failures
    # MUST NOT break a successful run.
    async def _boom(*a, **kw):
        raise RuntimeError("db gone")
    monkeypatch.setattr("backend.budget.storage.add_usage", _boom)
    state = {"messages": [_ai("claude-sonnet-4-6", 1000, 0)]}
    cfg: RunnableConfig = {"configurable": {"subject_key": "cookie:abc"}}
    # Should not raise.
    await node.budget_record(state, cfg)
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_node.py -v
```

- [ ] **Step 3: Implement node.py**

```python
# apps/backend/src/backend/budget/node.py
"""Post-run accounting node. Runs at the tail of the agent graph.

Reads every AIMessage's usage_metadata + response_metadata.model, converts to
RUB via pricing.cost_rub(), upserts into budget_usage for the day-bucket of
subject_key AND for __global_month.

CONTRACT: this node MUST NOT raise. Accounting failure must never cancel a
successful agent run.
"""

import logging
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from . import pricing, storage
from ..config import settings

log = logging.getLogger(__name__)


async def budget_record(state: dict[str, Any], config: RunnableConfig) -> dict:
    if not settings.budget_guard_enabled:
        return {}

    try:
        subject = (config.get("configurable") or {}).get("subject_key") or "__unknown__"
        total_rub = 0.0
        for msg in state.get("messages", []):
            if not isinstance(msg, AIMessage):
                continue
            usage = getattr(msg, "usage_metadata", None) or {}
            in_tok = int(usage.get("input_tokens") or 0)
            out_tok = int(usage.get("output_tokens") or 0)
            if in_tok == 0 and out_tok == 0:
                continue
            model = (
                (msg.response_metadata or {}).get("model")
                or (msg.response_metadata or {}).get("model_name")
                or "__default__"
            )
            total_rub += pricing.cost_rub(model, in_tok, out_tok)

        if total_rub > 0:
            await storage.add_usage(subject, storage._today_msk(), total_rub)
            await storage.add_usage("__global_month", storage._this_month_msk(), total_rub)
    except Exception:
        log.exception("budget_record failed; swallowing to avoid run cancellation")

    return {}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/test_budget_node.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/backend/budget/node.py apps/backend/tests/unit/test_budget_node.py
git commit -m "feat(backend): add budget.node — post-run RUB accounting"
```

---

### Task 3.2: Wire budget node на конец графа

**Files:**
- Modify: `apps/backend/src/backend/graph.py`

- [ ] **Step 1: Прочитать текущий `graph.py`**

```bash
cat apps/backend/src/backend/graph.py
```

Найди где собирается final compiled graph (вероятно `agent = create_deep_agent(...).with_config(...)` или аналог). Нам нужно повесить `budget_record` так, чтобы он выполнялся **после** того, как агент финализировал ответ.

- [ ] **Step 2: Добавить terminal node**

В `deepagents` граф уже скомпилирован. Самый чистый путь — обернуть в `StateGraph`:

```python
from langgraph.graph import StateGraph, END
from .budget.node import budget_record
# ... existing imports

# After: agent = create_deep_agent(...).with_config({"recursion_limit": 50})

# Wrap to attach a terminal accounting node.
_inner = agent

async def _run_inner(state, config):
    # delegate to the deepagents-built graph
    return await _inner.ainvoke(state, config)

_wrapped = StateGraph(dict)
_wrapped.add_node("agent_inner", _run_inner)
_wrapped.add_node("budget_record", budget_record)
_wrapped.set_entry_point("agent_inner")
_wrapped.add_edge("agent_inner", "budget_record")
_wrapped.add_edge("budget_record", END)

agent = _wrapped.compile()
```

**Внимание:** конкретная форма зависит от того что возвращает `create_deep_agent`. Если у него уже есть `MessagesState`, передай его в `StateGraph(MessagesState)`. Если падает на `ainvoke` — посмотри метод (`invoke`/`astream`/etc) и адаптируй wrapper. Сохрани вызов `.with_config({"recursion_limit": 50})` на финальном compiled graph.

- [ ] **Step 3: Проверить что граф всё ещё стартует**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -c "from backend.graph import agent; print(type(agent))"
```

Expected: класс `CompiledStateGraph` или подобный, без exception.

- [ ] **Step 4: Поднять langgraph dev, отправить один запрос вручную**

```bash
# терминал A
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser

# терминал B — отправить базовый запрос через SDK (или http)
curl -X POST http://localhost:2024/threads -H "Content-Type: application/json" -d "{}"
# затем POST /threads/{id}/runs/stream c assistant_id=agent и input.messages с одним юзер-сообщением
```

После завершения run'а проверить:

```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "SELECT * FROM budget_usage ORDER BY updated_at DESC LIMIT 5;"
```

Expected: 2 строки — `__unknown__` (subject_key не инжектится пока — Phase 5) и `__global_month` с одинаковой суммой.

- [ ] **Step 5: Прогнать все backend unit-тесты**

```bash
cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v
```

Expected: всё зелёное.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/backend/graph.py
git commit -m "feat(backend): attach budget_record node to end of agent graph"
```

---

## Phase 4 — Frontend cookie + middleware + session helper

После Phase 4 на каждый рендер страницы:
- Браузер получает HttpOnly cookie `pat_uid` (если её не было)
- В `<head>` страницы есть `<meta name="pat-session" content="<token>">`
- Helper `getPatSession()` доступен в client коде

Пока ничто эти данные не использует — это base слой.

### Task 4.1: `lib/session.ts` helper + frontend env

**Files:**
- Create: `apps/frontend/src/lib/session.ts`
- Modify: `apps/frontend/.env.example` (если есть) или README — задокументировать `PAT_SESSION_SECRET`

- [ ] **Step 1: Создать helper**

```ts
// apps/frontend/src/lib/session.ts
export function getPatSession(): string {
  if (typeof document === "undefined") return "";
  return (
    document
      .querySelector('meta[name="pat-session"]')
      ?.getAttribute("content") ?? ""
  );
}
```

- [ ] **Step 2: Добавить env пример**

В `apps/frontend/.env.example`:
```
# Same value as backend's PAT_SESSION_SECRET. Server-side only (never NEXT_PUBLIC_).
PAT_SESSION_SECRET=
```

- [ ] **Step 3: Тестов нет — функция тривиальна, проверим компиляцию**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/session.ts apps/frontend/.env.example
git commit -m "feat(frontend): add getPatSession() helper + PAT_SESSION_SECRET env"
```

---

### Task 4.2: `middleware.ts` — issue cookie + compute token

**Files:**
- Create: `apps/frontend/src/middleware.ts`

- [ ] **Step 1: Implement**

```ts
// apps/frontend/src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "node:crypto";

const COOKIE = "pat_uid";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function sign(secret: string, patUid: string, date: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${patUid}:${date}`)
    .digest("base64url");
}

export function middleware(req: NextRequest) {
  const secret = process.env.PAT_SESSION_SECRET ?? "";
  let patUid = req.cookies.get(COOKIE)?.value;
  let setCookie = false;
  if (!patUid) {
    patUid = crypto.randomUUID();
    setCookie = true;
  }
  const token = secret ? sign(secret, `cookie:${patUid}`, todayUtc()) : "";

  // Propagate to downstream (route handlers + RSC) via a request header.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-internal-pat-uid", patUid);
  requestHeaders.set("x-internal-pat-session", token);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (setCookie) {
    res.cookies.set(COOKIE, patUid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = {
  matcher: [
    // Run on pages + /api/* but NOT on static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)).*)",
  ],
};
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Smoke вручную**

```bash
cd apps/frontend && npm run dev
```

Открой `http://localhost:3000/` в incognito → в DevTools → Application → Cookies → должен появиться `pat_uid` (HttpOnly).

Перезагрузи → cookie остаётся прежним.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/middleware.ts
git commit -m "feat(frontend): middleware issues pat_uid cookie + computes session token"
```

---

### Task 4.3: Inject `<meta name="pat-session">` в `layout.tsx`

**Files:**
- Modify: `apps/frontend/src/app/layout.tsx`

- [ ] **Step 1: Прочитать текущий layout**

```bash
cat apps/frontend/src/app/layout.tsx
```

- [ ] **Step 2: Добавить meta**

В `<head>` (`<html><body>` дерева RootLayout) добавь:

```tsx
import { headers } from "next/headers";
// ...

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const patSession = (await headers()).get("x-internal-pat-session") ?? "";
  return (
    <html lang="ru">
      <head>
        <meta name="pat-session" content={patSession} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

Если layout уже async — просто добавить read headers и meta. Если sync — конвертировать в async.

- [ ] **Step 3: Перезагрузить страницу, проверить meta**

В DevTools → Elements → `<head>` должен быть `<meta name="pat-session" content="<base64url-блок>">`.

В Console:
```js
document.querySelector('meta[name="pat-session"]').content
```
Должен вернуть непустую строку.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/layout.tsx
git commit -m "feat(frontend): inject pat-session meta from middleware header"
```

---

### Task 4.4: `/api/session/route.ts` refresh endpoint

**Files:**
- Create: `apps/frontend/src/app/api/session/route.ts`

- [ ] **Step 1: Implement**

```ts
// apps/frontend/src/app/api/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = process.env.PAT_SESSION_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const patUid = req.cookies.get("pat_uid")?.value;
  if (!patUid) {
    return NextResponse.json({ error: "no_cookie" }, { status: 400 });
  }
  const date = new Date().toISOString().slice(0, 10);
  const token = crypto
    .createHmac("sha256", secret)
    .update(`cookie:${patUid}:${date}`)
    .digest("base64url");
  return NextResponse.json({
    token,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}
```

- [ ] **Step 2: Smoke**

```bash
curl -i http://localhost:3000/api/session
# Without cookie → 400
curl -i --cookie "pat_uid=abc-123" http://localhost:3000/api/session
# → 200 + {"token": "...", "expires_at": "..."}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/api/session/route.ts
git commit -m "feat(frontend): add GET /api/session refresh endpoint"
```

---

## Phase 5 — Custom API proxy с HMAC + pre-run budget guard + subject inject

После Phase 5:
- Старый `langgraph-nextjs-api-passthrough` заменён на свой proxy
- Frontend ходит только через `/api/*` → бэкенд (`LANGGRAPH_API_URL` env)
- HMAC проверяется на каждый `/api/*` (кроме `/api/session`)
- Pre-run budget check блокирует перед форвардом /runs
- `subject_key` инжектится в `config.configurable` тела /runs запроса
- Response header `X-Budget-Warning` пропускается обратно в ответ
- На фронте `Stream.tsx` шлёт `X-Pat-Session` и обрабатывает 401/429/503

### Task 5.1: Custom proxy — failing manual smoke first

**Files:**
- Modify: `apps/frontend/src/app/api/[..._path]/route.ts` (полная перезапись)

- [ ] **Step 1: Manual smoke до перезаписи**

```bash
curl -i -X POST http://localhost:3000/api/threads -H "Content-Type: application/json" -d "{}"
```

Expected (текущее поведение): 200/201 — `langgraph-nextjs-api-passthrough` пробрасывает на langgraph.

- [ ] **Step 2: Переписать route.ts**

```ts
// apps/frontend/src/app/api/[..._path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

const BACKEND = process.env.LANGGRAPH_API_URL ?? "http://localhost:2024";
const SECRET = process.env.PAT_SESSION_SECRET ?? "";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function verifyHmac(patUid: string, token: string): boolean {
  if (!SECRET || !patUid || !token) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`cookie:${patUid}:${todayUtc()}`)
    .digest("base64url");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

function subjectKeyFor(req: NextRequest): { key: string; viaCookie: boolean } {
  const patUid = req.cookies.get("pat_uid")?.value;
  if (patUid) return { key: `cookie:${patUid}`, viaCookie: true };
  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "0.0.0.0";
  return { key: `ip:${ip}`, viaCookie: false };
}

async function handle(req: NextRequest, { params }: { params: Promise<{ _path: string[] }> }) {
  const { _path } = await params;
  const pathStr = _path.join("/");
  const url = `${BACKEND}/${pathStr}${req.nextUrl.search}`;

  // `/api/session` is the issuer; never gated by HMAC.
  // (But /api/session is handled by its own route — this proxy never sees it.)

  // 1) HMAC verify (cookie + X-Pat-Session header must agree for today).
  const patUid = req.cookies.get("pat_uid")?.value ?? "";
  const sessionToken = req.headers.get("x-pat-session") ?? "";
  if (!verifyHmac(patUid, sessionToken)) {
    return NextResponse.json({ error: "session_invalid" }, { status: 401 });
  }

  const subject = subjectKeyFor(req);

  // 2) For /runs POST/PUT → pre-run budget guard.
  const isRunStart =
    (req.method === "POST" || req.method === "PUT") &&
    /(^|\/)threads\/[^/]+\/runs(\/stream)?$|(^|\/)runs(\/stream)?$/.test(pathStr);

  if (isRunStart) {
    // Global month gate first.
    const global = await fetch(`${BACKEND}/budget/check?subject=__global_month`).then((r) => r.json());
    if (!global.allowed) {
      return NextResponse.json(
        { error: "service_paused_global_budget", reset_at: global.reset_at },
        { status: 503, headers: { "Retry-After": secondsUntil(global.reset_at).toString() } },
      );
    }

    // Per-subject day gate.
    const day = await fetch(
      `${BACKEND}/budget/check?subject=${encodeURIComponent(subject.key)}`,
    ).then((r) => r.json());
    if (!day.allowed) {
      return NextResponse.json(
        {
          error: "daily_budget_exceeded",
          used_rub: day.used_rub,
          limit_rub: day.limit_rub,
          reset_at: day.reset_at,
        },
        { status: 429, headers: { "Retry-After": secondsUntil(day.reset_at).toString() } },
      );
    }

    // 3) Inject subject_key into config.configurable of the request body.
    const bodyText = await req.text();
    let bodyJson: any = {};
    try { bodyJson = bodyText ? JSON.parse(bodyText) : {}; } catch { /* keep {} */ }
    bodyJson.config = bodyJson.config ?? {};
    bodyJson.config.configurable = bodyJson.config.configurable ?? {};
    bodyJson.config.configurable.subject_key = subject.key;

    const upstream = await fetch(url, {
      method: req.method,
      headers: forwardHeaders(req),
      body: JSON.stringify(bodyJson),
      // SSE: keep stream alive
      // @ts-expect-error duplex required by undici for streaming bodies
      duplex: "half",
    });
    return passthrough(upstream, day);
  }

  // 4) Non-/runs: straight passthrough, but still HMAC-gated above.
  const upstream = await fetch(url, {
    method: req.method,
    headers: forwardHeaders(req),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
    // @ts-expect-error duplex
    duplex: "half",
  });
  return passthrough(upstream);
}

function forwardHeaders(req: NextRequest): Headers {
  const h = new Headers();
  for (const [k, v] of req.headers) {
    // Drop hop-by-hop + our internal markers
    if (["host", "connection", "x-internal-pat-uid", "x-internal-pat-session"].includes(k.toLowerCase())) continue;
    h.set(k, v);
  }
  return h;
}

function passthrough(upstream: Response, day?: { warn: boolean; used_rub: number; limit_rub: number }) {
  const headers = new Headers(upstream.headers);
  if (day?.warn) {
    headers.set("x-budget-warning", `used=${day.used_rub};limit=${day.limit_rub}`);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

function secondsUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 1000));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
```

- [ ] **Step 3: Smoke без HMAC → 401**

```bash
# рестарт `npm run dev` обязателен — runtime сменился на nodejs
cd apps/frontend && npm run dev
```

В другом терминале:
```bash
curl -i -X POST http://localhost:3000/api/threads -H "Content-Type: application/json" -d "{}"
```

Expected: 401 `{"error":"session_invalid"}`.

- [ ] **Step 4: Smoke с правильным HMAC → форвард**

Через браузер открой `http://localhost:3000/` → в DevTools Console:
```js
const token = document.querySelector('meta[name="pat-session"]').content;
fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pat-Session': token }, body: '{}' }).then(r => r.json()).then(console.log);
```

Expected: успешный thread create response.

- [ ] **Step 5: Проверить subject_key в БД**

После реального запуска чата:
```bash
docker exec patristic-postgres-dev psql -U postgres -d patristic -c "SELECT subject_key, used_rub FROM budget_usage ORDER BY updated_at DESC LIMIT 5;"
```

Expected: видим строку `cookie:<uuid>` (не `__unknown__` как раньше).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/api/[..._path]/route.ts
git commit -m "feat(frontend): custom API proxy — HMAC verify + budget guard + subject inject"
```

---

### Task 5.2: `Stream.tsx` — отправлять `X-Pat-Session` + обрабатывать 401/429/503 + warn header

**Files:**
- Modify: `apps/frontend/src/providers/Stream.tsx`

- [ ] **Step 1: Найти где создаётся `useStream(...)` клиент**

```bash
grep -n useStream apps/frontend/src/providers/Stream.tsx
```

- [ ] **Step 2: Подсунуть `defaultHeaders` с токеном**

Импорт:
```ts
import { getPatSession } from "@/lib/session";
```

При создании `useStream` (или эквивалентного langgraph-sdk клиента) — добавить:
```ts
defaultHeaders: { "X-Pat-Session": getPatSession() },
```

Если SDK не принимает defaultHeaders — оберни fetch и проставь header в каждом запросе.

- [ ] **Step 3: Добавить state `budgetWarning` + response interceptor**

Создать context, экспортировать `budgetWarning: {used: number; limit: number} | null` и `setBudgetWarning`. На каждый response который содержит `x-budget-warning` — распарсить и сохранить.

Конкретно: в `StreamProvider` обёртка fetch выглядит так:

```ts
async function fetchWithBudget(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const r = await fetch(input, init);
  const warn = r.headers.get("x-budget-warning");
  if (warn) {
    const used = parseFloat(warn.match(/used=([\d.]+)/)?.[1] ?? "0");
    const limit = parseFloat(warn.match(/limit=([\d.]+)/)?.[1] ?? "0");
    setBudgetWarning({ used, limit });
  } else if (r.status === 200) {
    setBudgetWarning(null);
  }
  if (r.status === 401) {
    // silent refresh once
    await fetch("/api/session");
    return fetch(input, init);
  }
  return r;
}
```

Прокинуть `fetchWithBudget` как кастомный fetch в langgraph-sdk (если SDK поддерживает `fetch` option) или обернуть напрямую.

- [ ] **Step 4: На 429 показать toast (Sonner)**

В том же обработчике:
```ts
if (r.status === 429) {
  const j = await r.clone().json().catch(() => ({}));
  toast.error(`Дневной лимит исчерпан. Возвращайтесь после ${j.reset_at ?? "полуночи"}.`);
}
if (r.status === 503) {
  // delegate to LogosShell to show a global block
  window.dispatchEvent(new CustomEvent("patristic:global-paused", { detail: j }));
}
```

- [ ] **Step 5: Прогон vitest**

```bash
cd apps/frontend && npm test
```

Expected: всё зелёное (никакой существующий тест не зависит от Stream.tsx внутренностей; если зависит — поправить мок).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/providers/Stream.tsx
git commit -m "feat(frontend): Stream — send X-Pat-Session, handle 401/429/503, surface warning"
```

---

## Phase 6 — UI: `BudgetBanner` + i18n + global pause block

После Phase 6 юзер видит:
- Жёлтый банер «Остаток: X ₽» когда warn
- Sonner toast «Дневной лимит исчерпан» на 429
- Большой inline-блок «Сервис временно приостановлен» на 503

### Task 6.1: i18n keys

**Files:**
- Modify: `apps/frontend/src/components/logos/i18n.ts`

- [ ] **Step 1: Добавить ключи**

В RU dict:
```ts
budgetWarning: (used: number, limit: number) =>
  `Осталось ${(limit - used).toFixed(0)} ₽ из дневного лимита ${limit.toFixed(0)} ₽. После 0 ₽ запросы будут отклонены до завтра.`,
budgetExceeded: (resetAt: string) =>
  `Дневной лимит исчерпан. Возвращайтесь после ${new Date(resetAt).toLocaleString("ru-RU")}.`,
globalPaused: "Сервис временно приостановлен — превышен месячный бюджет. Возвращайтесь позже.",
```

В EN dict:
```ts
budgetWarning: (used: number, limit: number) =>
  `${(limit - used).toFixed(0)} ₽ left of today's ${limit.toFixed(0)} ₽ limit. At 0 ₽ requests are rejected until tomorrow.`,
budgetExceeded: (resetAt: string) =>
  `Daily limit reached. Come back after ${new Date(resetAt).toLocaleString("en-US")}.`,
globalPaused: "Service is paused — monthly budget exceeded. Please come back later.",
```

- [ ] **Step 2: Прогнать тесты i18n**

```bash
cd apps/frontend && npm test -- i18n
```

Expected: green (если есть тесты на типизацию ключей — могут потребовать обновления, поправить).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/logos/i18n.ts
git commit -m "feat(frontend): i18n — add budget warning/exceeded/globalPaused keys"
```

---

### Task 6.2: `BudgetBanner.tsx`

**Files:**
- Create: `apps/frontend/src/components/logos/BudgetBanner.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/frontend/src/components/logos/BudgetBanner.tsx
"use client";
import { useStrings } from "./i18n";

export interface BudgetBannerProps {
  used: number;
  limit: number;
  onClose?: () => void;
}

export function BudgetBanner({ used, limit, onClose }: BudgetBannerProps) {
  const s = useStrings();
  return (
    <div
      role="status"
      style={{
        padding: "8px 16px",
        background: "rgba(180,120,40,0.15)",
        borderBottom: "1px solid rgba(180,120,40,0.4)",
        color: "#d8a050",
        fontSize: 13,
        textAlign: "center",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {s.budgetWarning(used, limit)}
      {onClose && (
        <button
          onClick={onClose}
          style={{
            marginLeft: 12,
            background: "transparent",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            fontSize: 16,
          }}
          aria-label="dismiss"
        >×</button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd apps/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/logos/BudgetBanner.tsx
git commit -m "feat(frontend): BudgetBanner UI component"
```

---

### Task 6.3: Wire `BudgetBanner` + global-paused в `LogosShell`

**Files:**
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`

- [ ] **Step 1: Прочитать LogosShell**

```bash
head -120 apps/frontend/src/components/logos/LogosShell.tsx
```

Найди где монтируется TopChrome / какой order layout'а.

- [ ] **Step 2: Импорты + state**

```tsx
import { BudgetBanner } from "./BudgetBanner";
import { useStreamContext } from "@/providers/Stream";
// ...

// inside component:
const { budgetWarning, setBudgetWarning } = useStreamContext();
const [globalPaused, setGlobalPaused] = React.useState<{ reset_at?: string } | null>(null);

React.useEffect(() => {
  function onPause(e: Event) {
    setGlobalPaused((e as CustomEvent).detail ?? {});
  }
  window.addEventListener("patristic:global-paused", onPause);
  return () => window.removeEventListener("patristic:global-paused", onPause);
}, []);
```

(Экспортировать `budgetWarning`/`setBudgetWarning` из Stream provider — если ещё не сделано.)

- [ ] **Step 3: Рендерить под TopChrome**

В JSX, сразу после `<TopChrome ... />`:
```tsx
{budgetWarning && (
  <BudgetBanner
    used={budgetWarning.used}
    limit={budgetWarning.limit}
    onClose={() => setBudgetWarning(null)}
  />
)}
{globalPaused && (
  <div style={{ padding: 40, textAlign: "center", color: "#a8a8a8", fontFamily: "Cormorant" }}>
    {s.globalPaused}
  </div>
)}
```

- [ ] **Step 4: Manual smoke**

Поднять backend + frontend.
В Postgres вручную сделай `INSERT INTO budget_usage (subject_key, bucket, used_rub) VALUES ('cookie:<твой uuid>', '<today>', 450);` и отправь сообщение → должен появиться баннер.

Затем `UPDATE ... SET used_rub = 600` → следующее сообщение → toast 429.

Затем `INSERT ... ('__global_month', '<month>', 31000)` → следующее сообщение → большой блок.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/logos/LogosShell.tsx
git commit -m "feat(frontend): LogosShell — mount BudgetBanner + global-paused block"
```

---

## Phase 7 — nginx: rewrite prod config + proxy_common + Dockerfile

После Phase 7 у нас готов отдельный nginx-контейнер с финальным конфигом — можно запускать локально как часть compose.

### Task 7.1: `proxy_common.conf`

**Files:**
- Create: `infra/nginx/proxy_common.conf`

- [ ] **Step 1: Implement**

```nginx
# infra/nginx/proxy_common.conf
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $server_name;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        "upgrade";
proxy_redirect off;
proxy_connect_timeout 10s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;
proxy_buffering on;
proxy_buffer_size 4k;
proxy_buffers     8 4k;
```

- [ ] **Step 2: Commit**

```bash
git add infra/nginx/proxy_common.conf
git commit -m "feat(infra): add nginx proxy_common.conf (shared proxy headers/timeouts)"
```

---

### Task 7.2: Rewrite `nginx.prod.conf`

**Files:**
- Modify: `infra/nginx/nginx.prod.conf`

- [ ] **Step 1: Прочитать текущий**

```bash
cat infra/nginx/nginx.prod.conf
```

Это стоковый шаблон с одним upstream `app:8000`, его выбрасываем целиком.

- [ ] **Step 2: Заменить содержимое**

Содержимое полностью заменить на финальный конфиг из спеки секции `### 1. nginx layer` (там полный готовый блок: `limit_req_zone`, `limit_req_status 429`, `limit_conn_status 429`, `map $blocked_ua`, `map $allowed_origin`, два `server {}` блока с локациями `/api/runs*`, `/api/threads`, `/api/`, `/` и HTTP→HTTPS redirect).

После замены — открыть файл и **верифицировать** что:
- Все три `location` для `/api/*` имеют `if ($blocked_ua) { return 403; }` И `if ($allowed_origin = 0) { return 403; }`
- Location `/` НЕ имеет UA-guard'а
- `proxy_pass http://nextjs:3000;` во всех location'ах
- `include /etc/nginx/proxy_common.conf;` после каждого `proxy_pass`
- `proxy_buffering off; proxy_read_timeout 300s;` в `/api/runs*` (для SSE)

- [ ] **Step 3: Syntax check (через временный контейнер)**

```bash
docker run --rm -v "$(pwd)/infra/nginx/nginx.prod.conf:/etc/nginx/conf.d/test.conf:ro" -v "$(pwd)/infra/nginx/proxy_common.conf:/etc/nginx/proxy_common.conf:ro" nginx:alpine sh -c "DOMAIN=test.local ALLOWED_ORIGIN=https://test.local envsubst '\$DOMAIN \$ALLOWED_ORIGIN' < /etc/nginx/conf.d/test.conf > /tmp/r.conf && nginx -t -c /tmp/r.conf" || true
```

Note: тест синтаксиса требует чтобы envsubst подставила переменные — иначе `${DOMAIN}` ломает парсер. Этот шаг лишь sanity-check; финальная проверка будет когда поднимется compose.

- [ ] **Step 4: Commit**

```bash
git add infra/nginx/nginx.prod.conf
git commit -m "feat(infra): rewrite nginx.prod.conf — TLS+limits+Origin+UA+per-location rules"
```

---

### Task 7.3: `Dockerfile.prod` — templates + envsubst

**Files:**
- Modify: `infra/nginx/Dockerfile.prod`

- [ ] **Step 1: Заменить содержимое**

```dockerfile
# infra/nginx/Dockerfile.prod
FROM nginx:alpine

# Шаблоны в /etc/nginx/templates/ автоматически прогоняются через envsubst
# скриптом nginx:alpine /docker-entrypoint.d/20-envsubst-on-templates.sh
# и рендерятся в /etc/nginx/conf.d/ перед стартом.
COPY nginx.prod.conf  /etc/nginx/templates/default.conf.template
COPY proxy_common.conf /etc/nginx/proxy_common.conf

# certbot для Let's Encrypt — оставляем
RUN apk add --no-cache certbot openssl
RUN mkdir -p /var/www/certbot

EXPOSE 80 443
# дефолтная CMD `nginx -g 'daemon off;'` подходит
```

**Внимание:** `nginx.prod.conf` сейчас содержит блок `http { ... events { ... } }` — но `templates/default.conf.template` рендерится в `/etc/nginx/conf.d/default.conf`, который inсluded в дефолтный `http {}` контекст. Значит в `nginx.prod.conf` нужно убрать обёртки `events {}` и `http {}` — оставить только директивы `limit_req_zone`, `map`, `server { ... }` (которые валидны в `http`-контексте).

Если убирать обёртки не хочется (или сложно) — альтернатива: рендерить в `/etc/nginx/nginx.conf` напрямую, тогда `events {}` нужен:
```dockerfile
COPY nginx.prod.conf /etc/nginx/templates/nginx.conf.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx
```

Выбрать тот вариант который меньше ломает; задокументировать выбор в коммит-message.

- [ ] **Step 2: Build image**

```bash
docker build -t patristic-nginx:test -f infra/nginx/Dockerfile.prod infra/nginx/
```

Expected: успешный билд.

- [ ] **Step 3: Commit**

```bash
git add infra/nginx/Dockerfile.prod infra/nginx/nginx.prod.conf
git commit -m "feat(infra): Dockerfile.prod — render nginx config via envsubst templates"
```

---

## Phase 8 — Production docker-compose + end-to-end smoke

После Phase 8: `docker compose -f infra/docker-compose.prod.yml up -d` поднимает весь стек локально, можно прогнать 10 acceptance-проверок из спеки.

### Task 8.1: `docker-compose.prod.yml`

**Files:**
- Create: `infra/docker-compose.prod.yml`

- [ ] **Step 1: Создать compose**

Использовать skeleton из спеки секция `### 11. Production compose`. Заполнить:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    networks: [internal]
    environment:
      POSTGRES_DB: patristic
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${PG_PASSWORD:-postgres}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./postgres.dev.conf:/etc/postgresql/postgresql.conf:ro
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    shm_size: 1gb
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d patristic"]
      interval: 5s
      timeout: 5s
      retries: 5

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

  nextjs:
    build:
      context: ../apps/frontend
    networks: [internal]
    env_file: ../.env
    environment:
      LANGGRAPH_API_URL: http://backend:2024
      NODE_ENV: production
    depends_on: [backend]

  nginx:
    build:
      context: ./nginx
      dockerfile: Dockerfile.prod
    networks: [internal]
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN:-localhost}
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN:-https://localhost}
    volumes:
      - letsencrypt:/etc/letsencrypt
      - certbot-webroot:/var/www/certbot
    depends_on: [nextjs]

networks:
  internal:
    driver: bridge

volumes:
  postgres-data:
  letsencrypt:
  certbot-webroot:
```

**Заметка:** убедись что у backend и frontend есть готовые Dockerfile. Backend — да (`apps/backend/Dockerfile`). Frontend — проверить: `ls apps/frontend/Dockerfile*` — если нет, добавить минимальный (`FROM node:20-alpine`, `npm ci`, `npm run build`, `CMD npm start`); это микро-задача, отдельный коммит.

- [ ] **Step 2: Если нужен — создать `apps/frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 3: Поднять локально**

```bash
cd infra && DOMAIN=localhost ALLOWED_ORIGIN=https://localhost docker compose -f docker-compose.prod.yml up -d --build
```

Дождаться healthy:
```bash
docker compose -f infra/docker-compose.prod.yml ps
```

- [ ] **Step 4: Применить миграции внутри prod-postgres**

```bash
docker exec -i $(docker compose -f infra/docker-compose.prod.yml ps -q postgres) psql -U postgres -d patristic < infra/migrations/001_init.sql
docker exec -i $(docker compose -f infra/docker-compose.prod.yml ps -q postgres) psql -U postgres -d patristic < infra/migrations/002_abuse_budget.sql
```

(Корпусные данные в prod-DB — отдельная задача за рамками плана: pg_dump из dev-volume + restore.)

- [ ] **Step 5: Verify все 4 сервиса доступны**

```bash
docker compose -f infra/docker-compose.prod.yml ps
# postgres healthy, backend Up, nextjs Up, nginx Up
```

- [ ] **Step 6: Commit**

```bash
git add infra/docker-compose.prod.yml apps/frontend/Dockerfile
git commit -m "feat(infra): production docker-compose with internal-only backend/nextjs"
```

---

### Task 8.2: 10 acceptance проверок из спеки

Записываем результаты в `infra/SMOKE_ANTI_ABUSE.md` (новый файл — короткий чек-лист).

**Files:**
- Create: `infra/SMOKE_ANTI_ABUSE.md`

- [ ] **Step 1: Поднять локальный self-signed TLS** (если не сделано)

```bash
cd infra/nginx && bash generate-ssl.sh
```

Скопировать сертификаты в `letsencrypt` volume или адаптировать `nginx.prod.conf` чтобы использовать `/etc/nginx/ssl/cert.pem` в режиме DOMAIN=localhost.

- [ ] **Step 2: Прогнать проверки и записать вывод**

```bash
# 1) No Origin → 403
curl -ki -X POST https://localhost/api/runs -d '{}' -H "Content-Type: application/json"
# Expect: HTTP/2 403

# 2) curl UA → 403
curl -ki -X POST https://localhost/api/runs -d '{}' -H "Origin: https://localhost" -H "Content-Type: application/json"
# Expect: HTTP/2 403  (UA "curl/X" matched)

# 3) Mozilla UA but no session → 401
curl -ki -X POST https://localhost/api/runs -d '{}' \
  -H "Origin: https://localhost" -H "Content-Type: application/json" -A "Mozilla/5.0"
# Expect: HTTP/2 401  {"error":"session_invalid"}

# 4) Через браузер — chat работает
# (открыть https://localhost/, отправить вопрос, проверить ответ)

# 5) 100KB body → 413
head -c 100000 /dev/urandom | base64 > /tmp/big.json
curl -ki -X POST https://localhost/api/runs --data-binary "@/tmp/big.json" \
  -H "Origin: https://localhost" -H "Content-Type: application/json" -A "Mozilla/5.0"
# Expect: HTTP/2 413

# 6) 4 параллельных стрима с одного IP → 4-й 429
# (запустить 4 параллельных curl SSE стрима к /api/threads/<id>/runs/<rid>/stream)

# 7) Force budget warn
docker exec patristic-postgres psql -U postgres -d patristic -c \
  "INSERT INTO budget_usage VALUES ('cookie:<твой uuid>', '<today>', 450) ON CONFLICT DO UPDATE SET used_rub=450"
# Следующий запрос → response header X-Budget-Warning
# Затем UPDATE used_rub=600 → 429 от proxy

# 8) Global month exceed
docker exec patristic-postgres psql -U postgres -d patristic -c \
  "INSERT INTO budget_usage VALUES ('__global_month', '<month>', 30001) ON CONFLICT DO UPDATE SET used_rub=30001"
# Любой запрос на /api/runs → 503

# 9) Реальный чат → две строки в budget_usage
docker exec patristic-postgres psql -U postgres -d patristic -c "SELECT * FROM budget_usage ORDER BY updated_at DESC LIMIT 5;"
# Expect: cookie:<uuid> и __global_month с одинаковым used_rub

# 10) Backend restart mid-stream — accounting всё равно лендится
# Запустить чат, через несколько секунд после старта рестартануть backend
# Проверить, что node всё-таки записала в budget_usage (зависит от того,
# успел ли graph дойти до budget_record до kill — это известная границы
# гарантии)
```

Записать результаты (PASS/FAIL/note) в `SMOKE_ANTI_ABUSE.md`.

- [ ] **Step 3: Commit smoke-чеклиста**

```bash
git add infra/SMOKE_ANTI_ABUSE.md
git commit -m "test(infra): record anti-abuse smoke results (10 acceptance checks)"
```

---

## Phase 9 — Docs

### Task 9.1: Обновить корневой `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Прочитать**

```bash
cat CLAUDE.md
```

- [ ] **Step 2: Добавить секцию «Anti-abuse / budget»**

В подходящем месте (после "Two .env files") вставить:

```markdown
## Anti-abuse / RUB budget (added 2026-05-17)

Public-anonymous chat is shielded by a layered defence — see [docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md](docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md) for the full design.

- **In prod (`infra/docker-compose.prod.yml`), the frontend MUST hit LangGraph through Next.js `/api/*` proxy, not directly.** `NEXT_PUBLIC_API_URL` is dev-only; in prod the LangGraph backend is on the internal docker network with no published ports.
- New env vars (loaded from root `.env`): `PAT_SESSION_SECRET` (32-byte hex, required), `DOMAIN`, `ALLOWED_ORIGIN`, `DAILY_RUB_PER_COOKIE` (default 500), `DAILY_RUB_PER_IP` (default 250), `SOFT_WARN_RATIO` (0.8), `GLOBAL_MONTHLY_KILL_RUB` (30000), `BUDGET_GUARD_ENABLED` (true).
- Rotating `PAT_SESSION_SECRET` invalidates all open browser tabs (next request → 401 → silent /api/session refresh fixes it if the cookie is still valid; else hard reload).
- New table: `budget_usage(subject_key, bucket, used_rub, updated_at)`. Apply `infra/migrations/002_abuse_budget.sql` to both `patristic` and `patristic_test`.
- Kill switch: set `BUDGET_GUARD_ENABLED=false` to make `/budget/check` always return allowed (logs would-be charges but doesn't deny). Use as rollback.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — anti-abuse/budget section"
```

---

### Task 9.2: Обновить `.env.example`

**Files:**
- Modify: `.env.example` (если есть) или создать новый

- [ ] **Step 1: Добавить блок**

```
# === Anti-abuse / RUB budget ===
# 32-byte hex (openssl rand -hex 32). REQUIRED in prod.
PAT_SESSION_SECRET=

DOMAIN=localhost
# Comma-split list — for now single origin
ALLOWED_ORIGIN=https://localhost

DAILY_RUB_PER_COOKIE=500
DAILY_RUB_PER_IP=250
SOFT_WARN_RATIO=0.8
GLOBAL_MONTHLY_KILL_RUB=30000
BUDGET_GUARD_ENABLED=true
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(.env.example): document anti-abuse/budget envs"
```

---

## Self-review (run after writing all tasks, before handoff)

**Spec coverage check** — каждый раздел спеки покрыт задачей:
- Sec 1 (nginx) → Task 7.2
- Sec 2 (cookie middleware) → Task 4.2
- Sec 3 (HMAC session) → Tasks 1.5, 4.3, 5.1
- Sec 4 (pre-run guard) → Task 5.1
- Sec 5 (post-run accounting) → Tasks 3.1, 3.2
- Sec 6 (pricing) → Task 1.3
- Sec 7 (storage) → Task 1.4
- Sec 8 (FastAPI surface) → Tasks 2.2, 2.3
- Sec 9 (UX) → Tasks 6.1, 6.2, 6.3, 5.2
- Sec 10 (config envs) → Task 2.1
- Sec 11 (compose) → Task 8.1
- Sec 12 (Dockerfile envsubst) → Task 7.3
- Sec 13 (DB migration) → Task 1.1
- Acceptance criteria → Task 8.2

**Type consistency:**
- `subject_key` форма `cookie:<uuid>` / `ip:<addr>` / `__global_month` / `__unknown__` — единая через `budget.storage`, `budget.node`, `/budget/check`, frontend proxy.
- `cost_rub(model, in_tok, out_tok) → float` — единая сигнатура (test, node).
- `sign(secret, pat_uid, date)` — единая сигнатура в Python и в TS (`crypto.createHmac` + `base64url`). Важно: **в TS middleware и в Python session.py используется один и тот же ввод `pat_uid + ":" + date`**, иначе HMAC не сойдётся. В TS middleware строка `cookie:<uuid>:<date>` (т.к. `pat_uid` уже включает префикс `cookie:`); в Python — `sign(secret, "cookie:<uuid>", "<date>")` тоже формирует `cookie:<uuid>:<date>`. ✓ согласовано.

**Placeholder scan:**
- В Task 3.2 написано "конкретная форма зависит от того что возвращает `create_deep_agent`" — это сознательное place where the engineer needs to look at the actual return type. Не строгий placeholder, но требует внимания. Acceptable.

**Scope check:** один связный план под одну ветку. Ничего не делится дальше.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-anti-abuse-rate-limits.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review между задачами, fast iteration. Подходит потому что задач много (~25) и они слабо связаны внутри фазы.

2. **Inline Execution** — выполнить в этой сессии через executing-plans, batch с checkpoints.

Какой подход?
