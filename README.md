# Patristic Chat

Агентный чат по русскому святоотеческому корпусу с верифицированными цитатами.

**Корпус:** ~2000 трудов от ~85 авторов из раздела «Избранные богословы» azbyka.ru + греческая философия (Платон, Аристотель) + Православная Библия. Всё на русском.

**Архитектура:** см. [design spec](docs/superpowers/specs/2026-05-14-patristic-chat-design.md). Кратко — LangGraph Server + deepagents (Sonnet main + Haiku search subagent) поверх PostgreSQL 16 + pgvector + tsvector. Фронт — Next.js форк `agent-chat-ui` с historiей чатов в localStorage и библиографическим браузером с поиском.

## Структура монорепо

```
apps/
├── backend/        # LangGraph Server + 6 тулов агента + FastAPI /catalog
└── frontend/       # форк agent-chat-ui (Next.js + Tailwind + Radix)
packages/
└── pipeline/       # CLI: scrape → markdown → paragraphs → embed → enrich
infra/
├── migrations/     # SQL миграции
├── docker-compose.dev.yml
└── scripts/        # migrate.sh, init-letsencrypt.sh, pg_dump_restore.md
tests/
└── eval/gold.yaml  # 53-entry goldset (acceptance gate)
```

## Быстрый старт (dev на Windows + WSL2)

### 1. Postgres

WSL2 должна быть запущена (`wsl -l -v` показывает Ubuntu Running). Если нет — `wsl -e bash -c "sleep infinity"` в фоне:

```bash
cp .env.example .env
# отредактируй TIMEWEB_AI_KEY (ключ от https://api.timeweb.ai/v1)

wsl -e bash -c "cd '/mnt/c/Users/79819/PycharmProjects/christian_rag' && docker compose -f infra/docker-compose.dev.yml up -d postgres"
# применить миграции
wsl -e bash -c "docker exec -i patristic-postgres-dev psql -U postgres -d patristic" < infra/migrations/001_init.sql
```

### 2. Pipeline (одноразово, индексация корпуса)

Требуется Python 3.13 + (опционально) NVIDIA GPU.

```bash
cd packages/pipeline
python -m venv .venv
# torch с CUDA 12.8 для Blackwell GPU:
.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv/Scripts/pip install -e ".[dev]"

# проверка CUDA:
.venv/Scripts/python -c "import torch; print('CUDA:', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"

# индексация (с PYTHONUTF8=1 для русских docstring-ов в --help):
PYTHONUTF8=1 .venv/Scripts/python -m pipeline diagnose     # отчёт о пробелах
PYTHONUTF8=1 .venv/Scripts/python -m pipeline paragraphs   # ~8 мин на 86K md
PYTHONUTF8=1 .venv/Scripts/python -m pipeline concepts-bootstrap  # ~2-5 мин, Haiku
PYTHONUTF8=1 .venv/Scripts/python -m pipeline embed --device cuda --batch-size 64  # 2-6 ч на GPU
```

Опционально, после прохождения goldset (см. Task 42 в плане):

```bash
# Подними LM Studio с qwen3.5-9b или другой 7-14B моделью на :1234
ENRICH_PROVIDER=local PYTHONUTF8=1 .venv/Scripts/python -m pipeline enrich
```

### 3. Backend

```bash
cd apps/backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"

# юнит-тесты (требуют запущенный postgres):
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit/ -v

# dev server:
PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser
```

LangGraph Server поднимется на `localhost:2024` с агентом `patristic` и встроенным FastAPI приложением `GET /catalog` (для библиографического браузера на фронте).

### 4. Frontend

```bash
cd apps/frontend
npm install
npm run dev
```

Открыть `http://localhost:3000`. Welcome-экран с примерами запросов, иконка библиотеки в шапке.

## Тестирование

| Слой | Команда | Тестов |
|---|---|---|
| Pipeline | `cd packages/pipeline && PYTHONUTF8=1 .venv/Scripts/python -m pytest -v` | 31 |
| Backend | `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit -v` | 32 |
| Frontend build | `cd apps/frontend && npm run build` | — |
| Goldset (acceptance) | `cd apps/backend && pytest tests/integration/test_goldset.py -v -s` | 53 запроса |

## Acceptance gate

MVP считается готовым **только когда `tests/eval/gold.yaml` (53 entries) проходит** через полный агент с порогами:
- addressed ≥ 80%
- thematic ≥ 60%
- cross ≥ 70%
- negative = 100%

См. [implementation plan](docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md), Task 39.

## Deployment

Полный рунбук — [`infra/scripts/pg_dump_restore.md`](infra/scripts/pg_dump_restore.md). Кратко:

1. Локально проиндексировать корпус (см. выше).
2. `wsl -e bash -c "docker exec patristic-postgres-dev pg_dump -U postgres -d patristic -Fc"` → файл-дамп ~3-5 ГБ.
3. `scp` на VPS, `pg_restore` в продовый Postgres.
4. На VPS: `docker compose -f infra/docker-compose.prod.yml up -d` (для прод-конфига см. `infra/docker-compose.prod.yml`, не входит в MVP).
5. SSL: `infra/scripts/init-letsencrypt.sh`.

## Документы

- [Design spec](docs/superpowers/specs/2026-05-14-patristic-chat-design.md)
- [Implementation plan](docs/superpowers/plans/2026-05-14-patristic-chat-mvp.md) — 42 задачи в 10 фазах
- [STATUS.md](STATUS.md) — текущее состояние реализации
- [pg_dump_restore.md](infra/scripts/pg_dump_restore.md) — runbook деплоя БД

## Известные ограничения окружения

- **Windows + WSL2 only.** Бек работает и на Linux/macOS, но команды в README предполагают Git Bash на Windows. На Linux замените `.venv/Scripts/python` на `.venv/bin/python` и убирайте префикс `wsl -e bash -c "..."` вокруг docker-команд.
- **`PYTHONUTF8=1` обязателен на Windows** для рендера русских docstring-ов в typer-help и для корректного логирования. Включён в pipeline и backend по умолчанию через окружение.
- **`WindowsSelectorEventLoopPolicy`** установлен в `__init__.py` обоих пакетов — psycopg-pool 3.3.x иначе виснет на Windows + Python 3.13.
- **GPU.** Эмбеддинг на GPU быстрее в 10-20x. На CPU тоже работает, но фаза embed может занять сутки. Если без GPU — переключите модель на `intfloat/multilingual-e5-small` (`EMBEDDING_MODEL` в `.env`) и сделайте полную переиндексацию.
