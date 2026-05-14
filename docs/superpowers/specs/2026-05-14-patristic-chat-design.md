# Patristic Chat — Design Spec

**Дата:** 2026-05-14
**Статус:** утверждено для перехода к плану реализации

## 1. Цель и контекст

Проект превращается из черновика RAG-сервиса в полноценный **сайт с агентным чатом по русскому святоотеческому корпусу**. Пользователь задаёт вопросы (адресные и тематические) — получает ответы с **верифицированными точными цитатами** и ссылкой на источник (azbyka.ru).

**Корпус (фул для MVP):**
- 85 авторов из раздела «Избранные богословы» azbyka.ru
- Греческая философия (раздел `filosofija`)
- Православная Библия (Синодальный)

Данные уже наскрейплены и большая часть конвертирована в markdown в соседнем проекте `orthodox_rag` (2117 epub, 72532 md-файлов главного типа). Эти артефакты переносим в монорепо.

**Главный архитектурный принцип:** агент **физически работает только с точным текстом**, который вернул `read_passage` по конкретной канонической ссылке. Это главный механизм против галлюцинаций.

## 2. Сценарии запросов

Два класса, оба требуют **точной цитаты со ссылкой**, а не пересказа:

1. **Адресный.** «Что говорит Лествичник про послушание?» — известен автор/труд. Решается лексикой + фильтрами по метаданным.
2. **Тематический.** «Найди цитаты про осуждение ближнего.» — автор неизвестен. Требует concept expansion + lexical + semantic.

Язык ответа = язык вопроса. Для не-русских вопросов agent показывает **и** русский оригинал, **и** working translation с явной отметкой «не authoritative».

## 3. Структура монорепо

```
christian_rag/
├── apps/
│   ├── backend/              # LangGraph Server + deepagents граф
│   │   ├── graph.py
│   │   ├── tools/            # list_authors, list_works, expand_concept,
│   │   │                     # lexical_search, semantic_search, read_passage
│   │   ├── embeddings/       # bge-m3 service с queue+batching worker
│   │   ├── db.py             # psycopg async pool
│   │   ├── langgraph.json    # конфиг LangGraph Server
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   └── frontend/             # форк upstream agent-chat-ui
│       ├── src/...           # Next.js 15 + Tailwind + Radix + langgraph-sdk
│       ├── package.json
│       └── Dockerfile
├── packages/
│   └── pipeline/             # CLI data pipeline
│       ├── pipeline/         # модули
│       ├── data/             # epub + json metadata (из orthodox_rag/data)
│       ├── output/           # md-файлы (из orthodox_rag/output)
│       ├── glossary.json     # концептный словарь (committed)
│       └── pyproject.toml
├── infra/
│   ├── migrations/           # SQL миграции
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   └── scripts/              # init-letsencrypt и т.п.
├── docs/superpowers/specs/   # этот файл и будущие
├── .env.example
└── README.md
```

**Старый код:** `orthodox_rag/` и старый `christian_rag/main.py`+`rag_service.py`+`embedding_service.py`+`text_service.py`+`repository.py` уходят в архив. Никаких бэк-ссылок из нового кода. Переиспользуем точечно:
- `orthodox_rag/src/scraper.py`, `downloader.py`, `converter.py` → копируем в `packages/pipeline/pipeline/`
- `orthodox_rag/data/`, `output/` → физически перемещаем в `packages/pipeline/`
- `christian_rag/scripts/init-letsencrypt.sh` → `infra/scripts/`
- `christian_rag/nginx/` → `infra/nginx/`
- Все остальные python-файлы — выбрасываем (ChromaDB подход не подходит, Yandex эмбеддинги меняем на bge-m3, наивный char-чанкинг заменяется paragraph-windows).

## 4. Бек: LangGraph Server + deepagents

### 4.1 Граф

Один deepagents граф с main agent и одним subagent.

```python
# apps/backend/graph.py (схема)
from deepagents import create_deep_agent
from langchain_openai import ChatOpenAI

main_model = ChatOpenAI(
    base_url="https://api.timeweb.ai/v1",
    api_key=os.environ["TIMEWEB_AI_KEY"],
    model="anthropic/claude-sonnet-4-7",
)

search_model = ChatOpenAI(
    base_url="https://api.timeweb.ai/v1",
    api_key=os.environ["TIMEWEB_AI_KEY"],
    model="anthropic/claude-haiku-4-5",
)

search_subagent = {
    "name": "search",
    "description": "Patristic corpus search. Делегируй для поиска цитат.",
    "prompt": SEARCH_AGENT_PROMPT,
    "tools": ["lexical_search", "semantic_search",
              "list_authors", "list_works", "expand_concept"],
    "model": search_model,
}

agent = create_deep_agent(
    model=main_model,
    tools=[read_passage, list_authors, list_works, expand_concept],
    instructions=MAIN_AGENT_PROMPT,
    subagents=[search_subagent],
)
```

### 4.2 Тулы

| Тул | Main | Search | Описание |
|---|:-:|:-:|---|
| `list_authors()` | ✓ | ✓ | Список авторов: slug, имя, годы, эпоха |
| `list_works(author_slug)` | ✓ | ✓ | Труды автора: slug, title, год, section, topics |
| `expand_concept(term)` | ✓ | ✓ | Читает `glossary.json` → synonyms / related / antonyms / greek |
| `lexical_search(query, author_slug=None, work_slug=None, limit=10)` | | ✓ | Postgres `tsvector` + ts_rank, опц. фильтры |
| `semantic_search(query, author_slug=None, work_slug=None, limit=10)` | | ✓ | bge-m3 → pgvector ANN, опц. фильтры |
| `read_passage(citation, context_n=2)` | ✓ | | Точный текст абзаца(ев) + N абзацев контекста + метаданные + source_url |

**Жёсткие правила в промптах:**

- **Main:** «Перед каждой цитатой в ответе ОБЯЗАН вызвать `read_passage`. Цитировать что-то не из вывода `read_passage` — запрещено. Snippets от search-субагента — только для решения релевантности.»
- **Search:** «Никогда не цитируешь напрямую. Возвращаешь только список кандидатов с `citation` + snippet ≤200 символов. Перед каждым тематическим поиском зови `expand_concept`.»

### 4.3 Формат канонической ссылки

```
<author_slug>/<work_slug>/<chapter_num>/p<start>[-<end>]
```

Пример: `ioann_zlatoust/besedy_na_matfeja/0042/p7-9`

- `author_slug`, `work_slug` — нормализованные транслит-имена из имён папок `output/`.
- `chapter_num` — `0042` из имени файла `0042_*.md`. Для одно-файловых трудов фолбэк `0001`.
- `p7-9` — абзацы 7-9 (1-based) в этой главе. Один абзац — `p7`.

В UI рендерится по-человечески: «Иоанн Златоуст, Беседы на Матфея, Беседа 42, §7-9» + кнопка «открыть на azbyka ↗» (URL из `works.source_url`).

### 4.4 Эмбеддинги

`apps/backend/embeddings/service.py` — micro-batching queue worker:

- Singleton bge-m3 (`sentence_transformers.SentenceTransformer`) загружается при старте бека.
- `asyncio.Queue` собирает входящие `(text, Future)`.
- Background worker накапливает батч до 16 элементов или 50ms окно — что наступит раньше.
- Один `model.encode(batch)` в `asyncio.to_thread`, чтобы не блокировать event loop.
- Результаты раздаются по фьючерам.

Это даёт корректность под async, естественный батчинг (амортизация matmul даёт ускорение в 3-5x на CPU), и backpressure через размер очереди.

**На прод (без GPU):** ~200-500ms per query на современном CPU. Не бутылочное горлышко на фоне LLM-вызовов 1-3s каждый.

**Фолбэк если упрёмся в нагрузку:** swap на `intfloat/multilingual-e5-small` + переиндексация. Архитектура от этого не страдает.

### 4.5 БД схема

PostgreSQL 16 + pgvector + tsvector.

```sql
authors(
  slug TEXT PK,
  name_display TEXT,
  years TEXT,
  century INT,
  global_section TEXT
);

works(
  slug TEXT PK,
  author_slug TEXT REFERENCES authors,
  title_display TEXT,
  creation_date TEXT,
  section TEXT,            -- e.g. "Аскетические сочинения"
  source_url TEXT,         -- azbyka URL на труд
  topics JSONB,            -- результат enrich (опц.)
  paragraph_count INT
);

chapters(
  work_slug TEXT REFERENCES works,
  chapter_num INT,
  title TEXT,
  source_md_path TEXT,
  PRIMARY KEY (work_slug, chapter_num)
);

paragraphs(
  work_slug TEXT,
  chapter_num INT,
  para_num INT,
  text TEXT NOT NULL,
  char_offset_start INT,
  char_offset_end INT,
  PRIMARY KEY (work_slug, chapter_num, para_num),
  FOREIGN KEY (work_slug, chapter_num) REFERENCES chapters
);

embeddings(
  work_slug TEXT,
  chapter_num INT,
  para_num INT,          -- стартовый абзац окна
  window_size INT,       -- 1, 2 или 3
  vector vector(1024),
  text_for_lexical TSVECTOR,
  PRIMARY KEY (work_slug, chapter_num, para_num, window_size),
  FOREIGN KEY (work_slug, chapter_num, para_num) REFERENCES paragraphs
);

-- Индексы
CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX embeddings_lexical_idx ON embeddings USING gin (text_for_lexical);
CREATE INDEX embeddings_filter_idx ON embeddings (work_slug, chapter_num);

-- Для наблюдаемости
agent_runs(
  id BIGSERIAL PK,
  thread_id TEXT,        -- ephemeral uuid из клиента
  messages JSONB,        -- финальный state
  citations_used JSONB,  -- ссылки которые цитировал агент
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4.6 Stateless контракт

LangGraph граф **без checkpointer**. Каждый POST на `/threads/{id}/runs/stream` несёт полный `messages` в payload. Сервер обрабатывает, стримит, забывает (только записывает `agent_runs` для наблюдаемости).

История чатов целиком живёт в браузере (см. секцию фронта). Это снимает требование к серверной персистентности тредов и упрощает horizontal scale.

### 4.7 Catalog endpoint (для библиографического браузера)

Помимо LangGraph Server роутов, бек выставляет один кастомный HTTP-эндпоинт:

```
GET /catalog
```

Отдаёт **весь** каталог авторов и трудов одним JSON. На полном корпусе это ~85 авторов × ~25 трудов в среднем ≈ ~2K записей × ~200 байт ≈ ~400 КБ. Хорошо кешируется (`Cache-Control: public, max-age=3600`), фронт держит в `sessionStorage`.

Формат:

```json
{
  "authors": [
    {
      "slug": "avrelij_avgustin",
      "name": "Аврелий Августин, блаженный",
      "years": "354–430",
      "century": 5,
      "global_section": "Православная библиотека Святых отцов и церковных писателей",
      "works": [
        {
          "slug": "ispoved",
          "title": "Исповедь",
          "creation_date": "400",
          "section": "Автобиографические сочинения",
          "source_url": "https://azbyka.ru/otechnik/Avrelij_Avgustin/ispoved/",
          "topics": ["покаяние", "обращение", "автобиография"],
          "paragraph_count": 412
        }
      ]
    }
  ]
}
```

Реализуется одним SQL-запросом с `json_agg`, отдаётся через FastAPI-роут, который mount'ится в LangGraph Server (langgraph поддерживает custom routes в `langgraph.json` через `http.app`). Альтернативно — отдельный FastAPI на том же контейнере на другом порту, проксируется nginx.

## 5. Фронт: форк agent-chat-ui

### 5.1 База

`git clone github.com/langchain-ai/agent-chat-ui` → `apps/frontend/`. Чистый upstream (не trading-mcp форк, тот загромождён трейдинг-фичами).

Стек: Next.js 15 App Router + TypeScript + Tailwind + Radix UI + `@langchain/langgraph-sdk` + framer-motion.

### 5.2 Что подрезаем

- LangChain branding → нейтральное.
- Welcome-экран с примерами → переписываем под патристику.
- API-key auth → убираем (open access на старте).

### 5.3 Что портируем из trading-mcp/terminal/front

Точечно, БЕЗ трейдинг-логики:

- `providers/Stream.tsx` — фикс лагов SSE (throttling).
- `components/thread/markdown-text.tsx` — плавная отрисовка markdown по чанкам (RAF-батчинг).
- `components/thread/index.tsx` — thread-level перф оптимизации.
- Стили компактного коллапса tool calls (тонкий nested блок).

### 5.4 localStorage Thread Provider

Главная кастомизация. agent-chat-ui по дефолту тянет тред-историю с LangGraph Server. Заменяем на localStorage:

```ts
interface StoredThread {
  id: string;            // uuid v4
  title: string;         // первые 60 символов первого user-сообщения
  createdAt: number;
  updatedAt: number;
  messages: Message[];   // вся история включая tool calls + assistant
}
```

Подмена в `providers/Thread.tsx`:
- `useThreads()` читает массив из `localStorage["patristic:threads"]`.
- `createThread()`, `updateThread()`, `deleteThread()` — пишут туда же.
- Sidebar (`components/thread/history/`) рендерит из этого источника, сортирует по `updatedAt desc`.

На submit нового сообщения: фронт берёт `messages[]` из текущего треда + новое сообщение → POST к LangGraph `/threads/{ephemeral_uuid}/runs/stream` с этим полным массивом → стрим обновляет UI → апсертит финальное состояние обратно в localStorage.

**Trade-off:** localStorage = per-browser. Многоустройственная синхронизация требует логин/бека — это **out of MVP**.

### 5.5 Библиографический браузер

Маленькая иконка-книжка в шапке справа (`<BookOpen />` из lucide-react). Клик открывает Radix Dialog с тремя зонами:

```
┌─ Библиотека ─────────────────────────────  × ┐
│ [🔍 Поиск по авторам, трудам, темам...]      │
│                                              │
│ ▾ Августин (354–430)                         │
│     Исповедь (400) · 412 §          ↗ azbyka │
│     О граде Божием (413–426) · 1842 § ↗      │
│     ...                                      │
│ ▸ Брянчанинов (1807–1867)                    │
│ ▾ Иоанн Лествичник (~579–~649)               │
│     Лествица · 1247 §               ↗ azbyka │
│     ...                                      │
└──────────────────────────────────────────────┘
```

**Поведение:**

- На монтировании компонента — `fetch('/catalog')` с кешем в `sessionStorage["patristic:catalog"]` (TTL = 1 час). Один раз за сессию.
- Дерево collapsible по авторам, дефолтное состояние — все свёрнуты. Развёрнутое состояние **не** персистится между открытиями модалки.
- Поиск — клиент-сайд, instant. Match критерий: case-insensitive substring против:
  - `author.name`
  - `work.title`
  - элементов `work.topics` (если `enrich` отработал)
  - Если есть совпадение в труде — родительский автор автоматически разворачивается и подсвечивается матч.
- Иконка `↗` рядом с каждым трудом — `<a href={work.source_url} target="_blank" rel="noopener">`. Открывает azbyka в новой вкладке.
- Виртуализация списка — **не нужна** для 85 авторов / ~2K трудов, нативно справляется.

**Компонент:** `apps/frontend/src/components/library/LibraryBrowser.tsx`. Стейт каталога — простой `useState` (без redux/zustand). Dialog — Radix `<Dialog>` (уже в зависимостях agent-chat-ui).

**Точки расширения (не в MVP, но архитектура их поддерживает):**

- Фильтры по веку / эпохе / school.
- Сортировка по дате создания / по `views` (просмотры на azbyka, есть в metadata json'ах).
- Кнопка «спросить агента про этот труд» — preset prompt в input чата.
- Сохранение последних просмотренных трудов в `localStorage["patristic:recent_works"]`.

### 5.6 Кастомный рендеринг цитат

Когда tool message — это результат `read_passage`, рендерим `<CitationCard>`:

```
┌─ Августин, Исповедь, кн. III, §3 ────── open ↗ ┐
│ «Итак, вмещают ли Тебя небо и земля...»        │
│                          context: §2 ▾ §4 ▾    │
└────────────────────────────────────────────────┘
```

- Header: автор + труд + глава + параграф, кнопка → `source_url`.
- Body: основной текст цитаты.
- Footer: collapsible «развернуть контекст» (показывает соседние абзацы из того же tool result).

Триггер: проверка `tool_call.name === "read_passage"`. Иначе дефолтный коллапс-блок.

## 6. Data pipeline

CLI с явными командами, каждая идемпотентна.

```bash
python -m pipeline scrape            # azbyka → data/*/json
python -m pipeline download          # → data/*/<work>.epub
python -m pipeline markdown          # → output/*.md с frontmatter
python -m pipeline diagnose          # отчёт о пробелах
python -m pipeline paragraphs        # → БД (authors, works, chapters, paragraphs)
python -m pipeline enrich            # → +topics в frontmatter и works.topics
python -m pipeline concepts-bootstrap  # → glossary.json
python -m pipeline embed             # → embeddings таблица (vector + tsvector)
python -m pipeline reindex           # full re-run paragraphs+embed (если параметры поменялись)
```

### 6.1 Текущее состояние данных (что не делаем заново)

- `scrape` — сделан для 85 авторов (2246 json).
- `download` — сделан для большинства (2117 epub).
- `markdown` — сделан для патристики (72532 md) и Bible.

Эти артефакты **переносим как есть** в `packages/pipeline/data/` и `packages/pipeline/output/`.

### 6.2 `diagnose` (новое)

Сканит `output/` и `data/`, выводит таблицу пробелов:

- Авторы без `data/` директории (например, Исаак Сирин — пропущен).
- Авторы с `data/` но без `output/` (markdown не запускался).
- Труды с 0 md-файлами.
- Труды с 1 md-файлом и размером >10K токенов (одно-файловые длинные — paragraph fallback работает, но помечаем).
- Аномалии нумерации.

Json-отчёт + console summary. Не блокирует pipeline — просто информирует.

### 6.3 `paragraphs` (новое)

Для каждого `output/**/*.md`:
- Парсит frontmatter: `author`, `book_title`, `chapter_num`, `chapter_title`, `source_url`, `creation_date`, `section`.
- Разбивает body на абзацы по `\n\n+` (фолбэк на одиночные `\n` если двойных нет).
- Фильтрует мусор:
  - Абзацы < 30 символов.
  - Навигационные «—N—», номера страниц, ноты `*1)`.
- Каждый абзац → `(work_slug, chapter_num, para_num, text, char_offset_start, char_offset_end)`.
- Bulk insert в `authors`, `works`, `chapters`, `paragraphs` (transactional, с ON CONFLICT для идемпотентности).

После: обновляет `works.paragraph_count`.

Для **одно-файлового труда** (45K в одной главе) алгоритм идентичен — просто все параграфы в `chapter_num=1`. Никакого специального кейса.

### 6.4 `enrich` (опционально)

Берётся из `orthodox_rag/src/enricher.py`. Переключаем `OpenAI` client на Timeweb proxy + Haiku. Извлекает topics, пишет:
- В frontmatter md-файла (для воспроизводимости).
- В `works.topics` (для UI и для подсказок агенту).

Запускается **после** `markdown` и **до** `paragraphs` (чтобы topics попали в БД).

В MVP не блокирует — можно отгрузить пайплайн без enrich, добавить потом.

### 6.5 `concepts-bootstrap` (новое)

```python
seed_concepts = [
    "гордость", "смирение", "молитва", "молитва Иисусова", "трезвение",
    "уныние", "печаль", "осуждение", "клевета", "помысл",
    "страсть", "блуд", "целомудрие", "послушание", "пост",
    "покаяние", "исповедь", "благодать", "обожение", "прелесть",
    "тщеславие", "память смертная", "плач", "слёзы", "безмолвие",
    # ~50-100 ключевых концептов на старте
]
```

Для каждого — запрос к Haiku по структурированному промпту, parsing в Pydantic:

```python
class Concept(BaseModel):
    canonical: str
    synonyms: list[str]
    related: list[str]
    antonyms: list[str]
    greek: list[str]
```

Результат → `packages/pipeline/glossary.json` (committed). Дальше — ручная правка спорного, расширение по мере появления провалов поиска.

### 6.6 `embed`

Главная вычислительная фаза.

Для каждой главы из `paragraphs` генерим окна 1-3 смежных абзацев:

```
chapter с абзацами [p1, p2, p3, p4, p5]:
  windows = [
    (size=1, start=p1), (size=1, start=p2), ..., (size=1, start=p5),
    (size=2, start=p1), (size=2, start=p2), ..., (size=2, start=p4),
    (size=3, start=p1), (size=3, start=p2), (size=3, start=p3),
  ]
```

Концепт, разорванный между абзацами, попадёт в окно целиком (для size≥2).

bge-m3 батчами 32-64 на GPU. ~200-500 эмбеддингов/сек. На фул корпусе (~2M окон оценка) — пара часов на средней GPU.

Параллельно строим `tsvector` для лексики:

```python
def preprocess_for_lexical(text: str) -> str:
    text = strip_punctuation_aggressive(text)
    text = apply_cs_substitutions(text, CS_DICT)  # молитися→молиться и т.п.
    return text.lower()
```

CS_DICT — небольшой ручной словарь (50-200 пар) самых частых архаизмов.

Insert в `embeddings(work_slug, chapter_num, para_num, window_size, vector, text_for_lexical)`. Индексы HNSW + GIN строятся в конце (быстрее чем поэлементное).

## 7. Deployment

### 7.1 Dev (WSL2 + Docker)

```bash
# postgres
docker-compose -f infra/docker-compose.dev.yml up postgres

# бек (отдельный терминал в WSL)
cd apps/backend && langgraph dev   # :2024 с graph inspector

# фронт (отдельный терминал)
cd apps/frontend && pnpm dev       # :3000

# пайплайн (отдельный, по мере необходимости)
cd packages/pipeline
python -m pipeline embed --batch-size 64 --device cuda
```

### 7.2 .env

```
TIMEWEB_AI_KEY=
POSTGRES_DSN=postgresql://postgres:postgres@localhost:5432/patristic
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cuda           # на дев-машине; cpu на проде
LANGGRAPH_API_URL=http://localhost:2024   # для фронта
```

### 7.3 Prod (VPS, без GPU)

`infra/docker-compose.prod.yml`:

- `postgres` (pgvector/pgvector:pg16, volume).
- `backend` (langgraph build, CPU embed-сервис с micro-batching, scaled до 1 реплики на старте).
- `frontend` (Next.js build).
- `nginx` (SSL через certbot, конфиг адаптируется из текущего christian_rag).

Веса bge-m3 НЕ запекаются в образ — скачиваются `sentence-transformers` при первом старте бека в volume `model-cache`. Один раз 2 ГБ.

### 7.4 Первый деплой

1. Локально: полный пайплайн → Postgres готов.
2. `pg_dump -Fc patristic > patristic-YYYY-MM-DD.dump` (≈3-5 ГБ).
3. `scp` на VPS.
4. На VPS: `pg_restore -d patristic ...dump`.
5. `docker-compose -f infra/docker-compose.prod.yml up -d`.
6. SSL: `scripts/init-letsencrypt.sh`.

### 7.5 Обновление данных

Новый дамп локально → `pg_restore --clean` на проде. Downtime ~5 мин. Для MVP норм.

### 7.6 CI/CD

Нет в MVP. Деплой через `git pull && docker-compose up --build`.

## 8. Verification и testing

### 8.1 Goldset

`tests/eval/gold.yaml` — 20-30 типичных запросов с ожидаемыми цитатами. `pipeline eval` прогоняет, считает recall@5, recall@10. Baseline после первой индексации, регрессия при изменениях параметров.

Примеры записей:

```yaml
- query: "что Лествичник говорит о послушании"        # адресный (патристика)
  expected_citations:
    - work: "ioann_lestvichnik/lestvitsa"
      chapter: 4   # Слово 4 «О блаженном и приснопамятном послушании»
  passing: any_match

- query: "найди про осуждение ближнего"               # тематический
  expected_authors: ["ioann_lestvichnik", "isaak_sirin", "bryanchaninov"]
  passing: at_least_two_authors

- query: "что говорит Платон о справедливости"        # адресный (философия)
  expected_authors: ["platon"]
  passing: at_least_one_match

- query: "что Ницше писал о морали"                   # negative — не в корпусе
  expected_authors: []
  passing: empty_or_low_confidence
```

Философия (Платон, Аристотель и т.п.) — **в корпусе**, потому что без неё патристика теряет половину контекста (отцы постоянно опираются на или полемизируют с античной философией). Negative test = что-то вне раздела `filosofija/` azbyka: послеантичные философы (Кант, Ницше), нехристианские священные тексты (Бхагавадгита, Коран), современная наука.

### 8.2 agent_runs таблица

В БД с самого старта пишется `agent_runs(id, thread_id, messages, citations_used, created_at)`. UI для дашборда верификации **не делаем в MVP**, но данные накапливаются — миграция позже не потребуется.

### 8.3 Pipeline тесты

- `tests/pipeline/test_paragraphs.py` — парсинг md, edge cases (одно-файловый, пустые блоки, нумерация).
- `tests/pipeline/test_embed.py` — батчинг, идемпотентность.

### 8.4 Smoke-test агента

`tests/agent/test_smoke.py`:
- 3 запроса (1 адресный, 1 тематический, 1 негативный).
- Не зацикливается.
- Все цитаты в финальном ответе — substring какого-то `read_passage` result (regex проверка).
- Search subagent возвращает ≥1 кандидата на тематический запрос.

Локально через `pytest`, CI нет в MVP.

### 8.5 Что НЕ проверяем автоматически

- Стилистическое качество («звучит ли по-святоотечески») — eye-test.
- Богословскую корректность — ручной review.

## 9. Out of MVP

Явно НЕ делаем сейчас, оставляем на v2+:

- Структурирование через Haiku (sliding-window LLM-разбор главы) — используем чисто epub-структуру.
- Sparse/multi-vector от bge-m3 — только dense.
- Cross-encoder reranker второй ступени.
- Канонизация ссылок до chapter-anchor URL на azbyka.
- Дашборд верификации UI.
- Многоустройственная синхронизация истории чатов (требует auth + сервер).
- CI/CD pipeline.
- Frontend embedding (transformers.js).
- Hosted embeddings (Voyage / OpenAI).
- Аутентификация пользователей.
- Перевод английского/греческого корпуса (только русские переводы).
- Полнотекстовое чтение труда внутри UI («читалка») — пока только ссылка на azbyka.

## 10. Риски и митигации

| Риск | Митигация |
|---|---|
| Качество epub-нарезки неоднородно (одно-файловые труды, отсутствующие авторы) | `diagnose` команда + ручная доскачка + paragraph-чанкинг работает идентично для всех |
| bge-m3 на CPU слишком медленный под нагрузкой | Micro-batching worker + рейт-лимит. Фолбэк на e5-small + переиндексация. |
| Перевод main-агентом неточен для технических терминов | Всегда показываем русский оригинал + явная отметка «working translation» |
| Концептный словарь покрывает только бутстраповые 50-100 концептов | Добавляем по мере провалов поиска. Sonnet тоже может расширять запрос промптом. |
| Galleon: агент цитирует не из read_passage | Smoke-test с regex-проверкой substring; жёсткое правило в промпте; запись `citations_used` в `agent_runs` для аудита |
| pg_restore деплой = downtime | Приемлемо для MVP (~5 мин). На v2: blue-green с двумя Postgres-инстансами. |

## 11. Следующие шаги

1. Утвердить этот спек (этот документ).
2. Написать implementation план (отдельный документ через writing-plans skill).
3. Начать с пайплайна (миграции БД → paragraphs → diagnose → embed на подмножестве) — потому что без данных бек не запустишь.
4. Параллельно: scaffolding бека (LangGraph граф со stub-тулами).
5. Фронт после того как бек стрим работает.
