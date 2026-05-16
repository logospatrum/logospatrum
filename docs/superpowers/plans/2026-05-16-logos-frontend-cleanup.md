# Logos Frontend Cleanup & Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести фронт `apps/frontend/` в порядок после переноса дизайна Claude Design ([Logos.html prototype]) на реальный фронт. Удалить мёртвый код от форка `agent-chat-ui`, привести стили к одному стеку, вернуть критичные продуктовые фичи (regenerate, edit, interrupt-flow), добавить мобильную адаптацию и `prefers-reduced-motion`, написать unit-тесты на чистую логику (`turns.ts`, `i18n.ts`).

**Архитектура:** После порта дизайна (см. предыдущую серию коммитов) в репе сосуществуют две UI-вселенные: новая `src/components/logos/*` (используется `app/page.tsx`) и мёртвая `src/components/thread/*` (никто не импортит, кроме двух хелперов). Цель плана — единая вселенная `logos/*` поверх существующих `StreamProvider`/`ThreadProvider`/`local-thread-store`. Все стили — palette tokens в `tokens.ts` + общий `src/components/logos/logos.css`. Tailwind базовый остаётся (нужен для глобальных reset-ов), но shadcn-обёртки и OKLCH-palette удаляются.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind v4 (минимально) + `@langchain/langgraph-sdk`/`react` + `nuqs` (URL state) + sonner (toasts) + `@radix-ui/react-dialog` (LibraryBrowser).

**Ship-gate:** Каждая фаза заканчивается зелёным `npm run build` + ручным smoke-чек-листом (Phase 0). Между фазами можно мержить независимо.

---

## Текущее состояние (факты на момент написания)

- **Используется в новом коде:** `src/components/logos/{Background, TopChrome, BottomChrome, Logo, Quote, Monolith, Starters, Sidebar, ChatBackdrop, Chevron, ThinkingTrace, CitationsList, HumanLine, AssistantTurn, LogosShell}.tsx`, `tokens.ts`, `i18n.ts`, `turns.ts`. Плюс `src/components/citation-card.tsx` (только тип `ReadPassageResult`, render-логика не используется), `src/components/library/LibraryBrowser.tsx`.
- **Используется из старого `thread/` нового кода:** только `src/components/thread/markdown-text.tsx` (импортит `markdown-styles.css` и `syntax-highlighter.tsx`) и `src/components/thread/utils.ts::getContentString`.
- **Мёртвый код (никем не импортится из `app/page.tsx` дерева):** весь остаток `src/components/thread/*`, весь `src/components/ui/*` кроме `sonner.tsx`, `src/hooks/use-file-upload.tsx`, `src/lib/multimodal-utils.ts`.
- **Сомнительные:** `src/lib/utils.ts` (`cn()`), `src/lib/agent-inbox-interrupt.ts`, `src/lib/api-key.tsx`, `src/hooks/useMediaQuery.tsx` — после удаления старого `thread/` станут мёртвыми, кроме `useMediaQuery` если решим использовать для mobile.
- **Бэкенд (`apps/backend/src/backend/`)** не использует multimodal/interrupt (`grep` подтвердил). Значит `useFileUpload`, `ContentBlocksPreview`, `MultimodalPreview`, `agent-inbox`, `multimodal-utils`, `lib/agent-inbox-interrupt.ts` — безопасно удалить.
- **Уже мёртвые блоки CSS в `app/globals.css`**: OKLCH-палитра + `.dark` блок + `@theme inline` blok — никто не задаёт класс `.dark`, никаких `text-foreground`/`bg-background` в `logos/*` нет.
- **Известные регрессии от порта (фичи, потерянные при переносе дизайна):**
  - Regenerate (`CommandBar.handleRegenerate(parentCheckpoint)`)
  - Edit human-сообщения
  - Branch switcher (альтернативные ветки ответа)
  - "Scroll to bottom" affordance
  - Interrupt / agent-inbox UI (но бэкенд этого не использует — оставляем как deferred)
  - File upload (бэкенд не принимает — drop окончательно)
  - Artifact panel (бэкенд не эмитит — drop окончательно)

---

## Файловая структура после плана

```
apps/frontend/src/
├── app/
│   ├── globals.css                  # очищен от OKLCH/.dark/@theme; импортит logos.css
│   ├── layout.tsx                   # без изменений
│   └── page.tsx                     # без изменений (уже использует LogosShell)
├── components/
│   ├── library/
│   │   ├── LibraryBrowser.tsx       # без изменений
│   │   └── use-catalog.ts           # без изменений
│   ├── logos/
│   │   ├── tokens.ts                # без изменений
│   │   ├── i18n.ts                  # без изменений + добавлены тесты
│   │   ├── logos.css                # NEW: вынесено из globals.css
│   │   ├── Background.tsx           # + prefers-reduced-motion, + мобильный downgrade
│   │   ├── TopChrome.tsx            # + collapse-на-мобильном, hide-on-narrow логика
│   │   ├── BottomChrome.tsx         # + hide-on-narrow
│   │   ├── Logo.tsx                 # без изменений
│   │   ├── Quote.tsx                # + responsive padding
│   │   ├── Monolith.tsx             # без изменений (responsive уже OK)
│   │   ├── Starters.tsx             # без изменений
│   │   ├── Sidebar.tsx              # + touch-friendly trigger (без hover-only)
│   │   ├── ChatBackdrop.tsx         # без изменений
│   │   ├── Chevron.tsx              # без изменений
│   │   ├── ThinkingTrace.tsx        # без изменений
│   │   ├── ToolRow.tsx              # NEW: вынесен из ThinkingTrace (читаемость)
│   │   ├── CitationsList.tsx        # без изменений
│   │   ├── HumanLine.tsx            # + edit-режим (inline textarea)
│   │   ├── AssistantTurn.tsx        # + Regenerate-кнопка под последним ответом
│   │   ├── ScrollToBottom.tsx       # NEW: affordance "к концу"
│   │   ├── LogosShell.tsx           # + edit/regenerate handlers
│   │   ├── turns.ts                 # без изменений + добавлены тесты
│   │   ├── markdown/
│   │   │   ├── markdown-text.tsx    # MOVED from components/thread/
│   │   │   ├── markdown-styles.css  # MOVED from components/thread/
│   │   │   ├── syntax-highlighter.tsx # MOVED from components/thread/
│   │   │   └── content.ts           # MOVED getContentString helper
│   │   └── __tests__/
│   │       ├── turns.test.ts        # NEW
│   │       ├── i18n.test.ts         # NEW
│   │       └── humanMessageText.test.ts  # NEW (extract helper from LogosShell)
│   ├── ui/
│   │   └── sonner.tsx               # без изменений (нужен Toaster)
│   └── citation-card.tsx            # сведён к export типов
├── hooks/
│   └── useMediaQuery.tsx            # без изменений (используется в Sidebar/TopChrome)
├── lib/
│   ├── ensure-tool-responses.ts     # без изменений
│   └── local-thread-store.ts        # без изменений
└── providers/
    ├── Stream.tsx                   # без изменений
    └── Thread.tsx                   # без изменений

УДАЛЯЮТСЯ ЦЕЛИКОМ:
- src/components/thread/                              (orphan после move)
- src/components/ui/{avatar,button,card,input,label,
  password-input,separator,sheet,skeleton,switch,
  textarea,tooltip}.tsx                               (shadcn-обёртки, никем не нужны)
- src/hooks/use-file-upload.tsx
- src/lib/{multimodal-utils.ts,utils.ts,
  api-key.tsx,agent-inbox-interrupt.ts}
```

---

## Решения, требующие подтверждения от заказчика

**Каждое из этих решений я зашил в план с своим вариантом. Если не нравится — пересмотри отдельно.**

| # | Решение | План говорит | Как поменять |
|---|---------|--------------|---------------|
| D1 | File upload (PDF/image) | DROP — бэкенд не принимает multimodal | Если возвращаем, нужен отдельный план + изменения бэкенда |
| D2 | `agent-inbox` interrupt UI | DEFER — бэкенд не использует `interrupt()` | Если бэк начнёт прерывать — отдельный план |
| D3 | `ArtifactProvider` | DROP — бэкенд не эмитит UI-сообщений | Если когда-то появятся — вернуть обёртку и Artifact-панель отдельной задачей |
| D4 | Edit human-message | KEEP — возвращаем как inline-edit с `parentCheckpoint` | Drop = удалить Task 22-25 |
| D5 | Regenerate ответ | KEEP — кнопка под последним ассистент-turn | Drop = удалить Task 19-21 |
| D6 | Branch switcher | DROP — нишевая фича, мешает чистоте UI | Keep = отдельный план |
| D7 | Footnote `[N]` маркеры в ответе | DEFER — требует backend prompt-tuning | Если хочется — отдельный план: prompt → парсер → UI |
| D8 | `chatCount` прогрессия света | KEEP — но с документацией про localStorage edge-case | Drop = вырезать из `Background.tsx` константой `chatCount=20` |
| D9 | Tailwind v4 vs полный inline-only | KEEP TAILWIND — он минимально нужен для `body` reset и тостов | Перевод всего на raw CSS = отдельный план |

---

## Phase 0: Базовая инфраструктура для тестов и manual-smoke

**Цель:** Поставить vitest, написать smoke-чек-лист один раз чтобы не повторять, зафиксировать стартовую точку.

### Task 0.1: Установить vitest + jsdom

**Files:**
- Modify: `apps/frontend/package.json`

- [ ] **Step 1: Установить зависимости**

```bash
cd apps/frontend && npm install --save-dev vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @vitejs/plugin-react
```

Expected: новые записи в `devDependencies`, нет ошибок.

- [ ] **Step 2: Добавить test-скрипты**

В `apps/frontend/package.json`, секция `scripts`, добавить:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Создать `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 4: Создать `vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Smoke-тест что vitest запускается**

Создать `apps/frontend/src/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `cd apps/frontend && npm test`
Expected: `1 passed`.

- [ ] **Step 6: Удалить smoke-тест и закоммитить**

```bash
rm apps/frontend/src/__tests__/smoke.test.ts
rmdir apps/frontend/src/__tests__ 2>/dev/null || true
git add apps/frontend/package.json apps/frontend/package-lock.json \
        apps/frontend/vitest.config.ts apps/frontend/vitest.setup.ts
git commit -m "chore(frontend): wire up vitest + jsdom for unit tests"
```

### Task 0.2: Зафиксировать smoke-чеклист

**Files:**
- Create: `apps/frontend/SMOKE.md`

- [ ] **Step 1: Написать чек-лист**

```md
# Frontend smoke checklist

Запускать после любого PR, который меняет `src/components/logos/*`,
`src/app/*`, или `src/providers/*`.

Prereq:
- `wsl -e bash -c "cd ~/christian_rag/infra && docker compose -f docker-compose.dev.yml up -d postgres"` запущен
- `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/langgraph dev --port 2024 --no-browser --allow-blocking` запущен
- `cd apps/frontend && npm run dev` запущен

## Главная страница (зашли без `?threadId=...`)

- [ ] Скала-фон видна, курсор оставляет световое пятно
- [ ] ЛКМ-зажим — свет плавно тухнет, отпустил — зажигается
- [ ] Клик в инпут (Monolith) — свет тухнет; blur — зажигается
- [ ] Тоггл «СВЕТ»/«LIGHT» в правом верхнем — выключает все источники плавно
- [ ] Радио RU/EN — переключает все строки (заголовок, плейсхолдер инпута, стартеры, цитата)
- [ ] Hover слева у края (24px) — выезжает сайдбар
- [ ] Сайдбар пустой → видна курсивная подсказка "История пуста..."
- [ ] Стартер-чип под инпутом → клик отправляет вопрос, переход в chat-режим
- [ ] BottomChrome видна (Corpus · azbyka.ru) + часы тикают

## Чат (`?threadId=xxx`)

- [ ] За чатом тёмная вертикальная колонка, по бокам видна скала
- [ ] Снизу пульсируют 2 пламени пока агент думает
- [ ] Справа сверху видна тень от креста, играет с пламенами
- [ ] ThinkingTrace разворачивается, видно tool-calls в реальном времени
- [ ] Внутри tool-call видно args (JSON) и result
- [ ] После завершения стрима тень + пламена плавно гаснут
- [ ] CitationsList появляется после ответа (если tool `read_passage` отдал данные)
- [ ] Клик «развернуть контекст» в строке цитаты — раскрывается context_before/_after
- [ ] Клик "azbyka ↗" в строке цитаты — открывает source_url в новой вкладке
- [ ] Кнопка «Новый разговор» (в TopChrome) — возвращает на главную, URL без `threadId`

## Library / Корпус

- [ ] Клик «КОРПУС»/«CORPUS» в TopChrome — открывает диалог
- [ ] Список авторов прогружен, поиск работает
- [ ] Иконка-«пузырь» в строке труда — закрывает диалог, префиллит инпут текстом

## Сайдбар (история)

- [ ] После первого отправленного вопроса — появилась запись с заголовком
- [ ] Клик по записи — открывает чат с её threadId
- [ ] Активная запись подсвечена

## Невидимые ошибки
- [ ] DevTools Console — никаких React-warnings, hydration mismatch, key warnings
- [ ] Network tab — `/info` → 200, `/threads/.../stream` → 200/SSE
```

- [ ] **Step 2: Коммит**

```bash
git add apps/frontend/SMOKE.md
git commit -m "docs(frontend): smoke checklist for post-port verification"
```

### Task 0.3: Зафиксировать стартовую точку — `npm run build` зелёный

- [ ] **Step 1: Билд**

Run: `cd apps/frontend && npm run build`
Expected: `✓ Generating static pages (5/5)` + сводка размеров без `Error`.

- [ ] **Step 2: Lint**

Run: `cd apps/frontend && npm run lint`
Expected: только warnings (react-refresh/only-export-components в `providers/*`, `ui/button.tsx`, `layout.tsx`). Никаких errors.

---

## Phase 1: Извлечь markdown-стек в `logos/markdown/`

**Цель:** Перенести нужные файлы из `components/thread/` в `components/logos/markdown/` чтобы удаление `thread/` стало безопасным.

### Task 1.1: Перенести `markdown-text.tsx` + зависимости

**Files:**
- Move: `src/components/thread/markdown-text.tsx` → `src/components/logos/markdown/markdown-text.tsx`
- Move: `src/components/thread/markdown-styles.css` → `src/components/logos/markdown/markdown-styles.css`
- Move: `src/components/thread/syntax-highlighter.tsx` → `src/components/logos/markdown/syntax-highlighter.tsx`
- Move: `src/components/thread/utils.ts` → `src/components/logos/markdown/content.ts` (переименование — это уже не "thread utils", это контент-хелпер)

- [ ] **Step 1: Создать директорию**

```bash
mkdir -p apps/frontend/src/components/logos/markdown
```

- [ ] **Step 2: Move-ы через git mv**

```bash
git mv apps/frontend/src/components/thread/markdown-text.tsx \
       apps/frontend/src/components/logos/markdown/markdown-text.tsx
git mv apps/frontend/src/components/thread/markdown-styles.css \
       apps/frontend/src/components/logos/markdown/markdown-styles.css
git mv apps/frontend/src/components/thread/syntax-highlighter.tsx \
       apps/frontend/src/components/logos/markdown/syntax-highlighter.tsx
git mv apps/frontend/src/components/thread/utils.ts \
       apps/frontend/src/components/logos/markdown/content.ts
```

- [ ] **Step 3: Поправить импорты внутри перемещённых файлов**

В `apps/frontend/src/components/logos/markdown/markdown-text.tsx`:

```ts
// БЫЛО:
//   import "./markdown-styles.css";
//   import { SyntaxHighlighter } from "@/components/thread/syntax-highlighter";
//   import { TooltipIconButton } from "@/components/thread/tooltip-icon-button";
// СТАЛО:
import "./markdown-styles.css";
import { SyntaxHighlighter } from "./syntax-highlighter";
// TooltipIconButton удалим — переедет в обычный <button>
```

Затем заменить блок `<TooltipIconButton>` в `CodeHeader` на простой кнопку:

```tsx
const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => { if (!code || isCopied) return; copyToClipboard(code); };
  return (
    <div className="flex items-center justify-between gap-4 rounded-t-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
      <span className="lowercase [&>span]:text-xs">{language}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={isCopied ? "Скопировано" : "Копировать"}
        className="text-white/60 hover:text-white"
      >
        {!isCopied && <CopyIcon className="h-4 w-4" />}
        {isCopied && <CheckIcon className="h-4 w-4" />}
      </button>
    </div>
  );
};
```

(`CopyIcon`/`CheckIcon` остаются из `lucide-react`, оно ещё нужно `LibraryBrowser`.)

- [ ] **Step 4: Поправить импорты в потребителях**

В `apps/frontend/src/components/logos/AssistantTurn.tsx`:

```ts
// БЫЛО:
import { MarkdownText } from "@/components/thread/markdown-text";
// СТАЛО:
import { MarkdownText } from "./markdown/markdown-text";
```

В `apps/frontend/src/components/logos/turns.ts`:

```ts
// БЫЛО:
import { getContentString } from "@/components/thread/utils";
// СТАЛО:
import { getContentString } from "./markdown/content";
```

- [ ] **Step 5: Build + lint**

Run: `cd apps/frontend && npm run build`
Expected: `✓ Compiled successfully` + успешный type-check. Если ошибки — это пропущенный импорт где-то в потребителях, поправить.

Run: `cd apps/frontend && npm run lint`
Expected: те же warnings что и до, никаких новых errors.

- [ ] **Step 6: Коммит**

```bash
git add apps/frontend/src
git commit -m "refactor(frontend): move markdown stack from thread/ to logos/markdown/"
```

### Task 1.2: Smoke

- [ ] **Step 1: Прогнать SMOKE.md секцию "Чат"**

`npm run dev`, открыть существующий чат через сайдбар или отправить новый вопрос. Убедиться что:
- Markdown в ответе рендерится (заголовки, списки, **жирный**, *курсив*, ссылки)
- Кодовые блоки рендерятся с syntax-highlighting и copy-button
- Smooth-typewriter работает (буквы появляются плавно, не пачками)

Если что-то сломалось — фикс перед переходом к Phase 2.

---

## Phase 2: Удалить orphan-файлы `components/thread/*`

**Цель:** Убрать ~25 файлов мёртвого кода. После Phase 1 они уже никем не импортятся.

### Task 2.1: Убедиться что ничто не импортит из `thread/`

- [ ] **Step 1: Grep на остаточные импорты**

```bash
cd apps/frontend
grep -r "from \"@/components/thread" src/ || echo "OK: нет ссылок на @/components/thread"
grep -r "from \"./thread" src/ || echo "OK: нет относительных импортов"
```

Expected: обе команды печатают "OK: ...".

Если что-то нашлось — это пропущенный потребитель из Phase 1, остановиться, поправить, вернуться.

### Task 2.2: Удалить директорию

**Files:**
- Delete: `apps/frontend/src/components/thread/` (рекурсивно)

- [ ] **Step 1: git rm**

```bash
git rm -r apps/frontend/src/components/thread/
```

- [ ] **Step 2: Build + lint**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

Run: `cd apps/frontend && npm run lint`
Expected: warnings уменьшились (исчезли react-refresh warnings из удалённых файлов). Errors: 0.

- [ ] **Step 3: Коммит**

```bash
git commit -m "refactor(frontend): drop orphan Thread/agent-inbox/artifact UI after design port

The agent-chat-ui Thread shell was replaced by LogosShell in commit <PORT_COMMIT>.
All non-trivial logic (MarkdownText, syntax-highlighter, content helpers) was
moved to components/logos/markdown/ in the previous commit. The remaining files
were never imported by app/page.tsx after the port:
  - thread/index.tsx (the old Thread component)
  - thread/history/*
  - thread/messages/{ai,human,tool-calls,shared,generic-interrupt}.tsx
  - thread/agent-inbox/*
  - thread/artifact.tsx
  - thread/welcome.tsx
  - thread/ContentBlocksPreview.tsx, MultimodalPreview.tsx
  - thread/tooltip-icon-button.tsx

The backend does not currently use interrupts or emit Artifact UI messages
(grep over apps/backend/src confirmed), so dropping the corresponding UI is
safe. If those features become required, they should be added back on top of
the Logos shell as a separate plan."
```

---

## Phase 3: Удалить мёртвые `components/ui/*` обёртки и связанные библиотеки

**Цель:** Только `sonner.tsx` нужен (Toaster); остальные shadcn-обёртки никем не импортятся после Phase 2.

### Task 3.1: Подтвердить что используется только `sonner.tsx`

- [ ] **Step 1: Grep**

```bash
cd apps/frontend
grep -rE "from \"@/components/ui/(avatar|button|card|input|label|password-input|separator|sheet|skeleton|switch|textarea|tooltip)\"" src/ || echo "OK"
```

Expected: "OK".

```bash
grep -rE "from \"@/components/ui/sonner\"" src/
```

Expected: показывает `src/app/page.tsx` (импорт `Toaster`). Если есть и другие — тоже OK.

### Task 3.2: Удалить shadcn-обёртки

**Files:**
- Delete: `src/components/ui/{avatar,button,card,input,label,password-input,separator,sheet,skeleton,switch,textarea,tooltip}.tsx`

- [ ] **Step 1: git rm**

```bash
cd apps/frontend
git rm src/components/ui/avatar.tsx src/components/ui/button.tsx \
       src/components/ui/card.tsx src/components/ui/input.tsx \
       src/components/ui/label.tsx src/components/ui/password-input.tsx \
       src/components/ui/separator.tsx src/components/ui/sheet.tsx \
       src/components/ui/skeleton.tsx src/components/ui/switch.tsx \
       src/components/ui/textarea.tsx src/components/ui/tooltip.tsx
```

- [ ] **Step 2: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный. Если что-то ругается — там пропущенный импорт, который Step 1 grep не поймал. Поправить.

### Task 3.3: Удалить мёртвые `lib/` и `hooks/`

**Files:**
- Delete: `src/lib/utils.ts`, `src/lib/multimodal-utils.ts`, `src/lib/api-key.tsx`, `src/lib/agent-inbox-interrupt.ts`
- Delete: `src/hooks/use-file-upload.tsx`
- Keep: `src/lib/{ensure-tool-responses.ts,local-thread-store.ts}`, `src/hooks/useMediaQuery.tsx`

- [ ] **Step 1: Grep что они никем не нужны**

```bash
cd apps/frontend
for f in utils multimodal-utils api-key agent-inbox-interrupt; do
  matches=$(grep -rE "from \"@/lib/${f}\"" src/ | grep -v "lib/${f}\.")
  if [ -n "$matches" ]; then echo "USED: $f"; echo "$matches"; else echo "OK: $f"; fi
done
matches=$(grep -rE "from \"@/hooks/use-file-upload\"" src/)
if [ -n "$matches" ]; then echo "USED: use-file-upload"; else echo "OK: use-file-upload"; fi
```

Expected: все строки "OK: ...".

- [ ] **Step 2: git rm**

```bash
git rm src/lib/utils.ts src/lib/multimodal-utils.ts \
       src/lib/api-key.tsx src/lib/agent-inbox-interrupt.ts \
       src/hooks/use-file-upload.tsx
```

- [ ] **Step 3: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

### Task 3.4: Удалить мёртвые npm-зависимости

**Files:**
- Modify: `apps/frontend/package.json`

- [ ] **Step 1: Удалить deps**

Удаляются (никем не импортятся после Tasks 2.2 + 3.2 + 3.3):

```bash
cd apps/frontend
npm uninstall \
  @radix-ui/react-avatar \
  @radix-ui/react-label \
  @radix-ui/react-separator \
  @radix-ui/react-slot \
  @radix-ui/react-switch \
  @radix-ui/react-tooltip \
  class-variance-authority \
  clsx \
  date-fns \
  framer-motion \
  recharts \
  tailwind-merge \
  tailwindcss-animate \
  use-stick-to-bottom \
  next-themes \
  lodash \
  @types/lodash
```

Rationale (каждый dep):
- `@radix-ui/react-{avatar,label,separator,slot,switch,tooltip}` — все 6 shadcn-обёрток удалены в Task 3.2
- `@radix-ui/react-dialog` НЕ удаляется — `LibraryBrowser` его использует напрямую
- `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate` — нужны только для shadcn `cn()`/animate; удалены вместе с `lib/utils.ts`
- `framer-motion` — был только в `Thread/index.tsx` для slide-анимаций сайдбара (и `artifact.tsx`/`tool-calls.tsx`). Logos использует CSS keyframes.
- `recharts` — был для чего-то в agent-inbox / artifact-панелях. Не используется.
- `use-stick-to-bottom` — был только в `Thread/index.tsx`. Logos делает auto-scroll через `useEffect` + `scrollTo`.
- `next-themes` — был для shadcn dark mode. Logos всегда тёмный.
- `lodash` + `@types/lodash` — grep по всему src/ ничего не находит. Скорее всего тянулся transitively. Если build после uninstall сломается — вернуть.
- `date-fns` — grep ничего не находит в `src/`. Был в каком-то thread-компоненте.

- [ ] **Step 2: Build + lint**

Run: `cd apps/frontend && npm run build`
Expected: зелёный. Если что-то ругается на `Cannot find module 'date-fns'` или подобное — это transitive use, временно вернуть, разобраться отдельно.

- [ ] **Step 3: Sanity-check тосты**

`npm run dev`, на главной заглушить бэкенд (`langgraph dev` → Ctrl+C) → обновить страницу. Должен появиться toast «Не удалось подключиться к LangGraph» в правом нижнем углу. Это sonner — единственный тест что `@/components/ui/sonner` живёт нормально.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/src
git commit -m "chore(frontend): drop shadcn UI + 13 unused npm deps

After removing the agent-chat-ui Thread shell (previous commit), these files
and packages have no remaining importers:

Files (12 shadcn wrappers):
  components/ui/{avatar,button,card,input,label,password-input,
  separator,sheet,skeleton,switch,textarea,tooltip}.tsx

Lib (4):
  lib/{utils.ts,multimodal-utils.ts,api-key.tsx,agent-inbox-interrupt.ts}

Hooks (1):
  hooks/use-file-upload.tsx

NPM deps (16):
  @radix-ui/react-{avatar,label,separator,slot,switch,tooltip}
  class-variance-authority, clsx, tailwind-merge, tailwindcss-animate
  framer-motion, recharts, use-stick-to-bottom, next-themes
  date-fns, lodash, @types/lodash

Kept: components/ui/sonner.tsx (Toaster), @radix-ui/react-dialog
(LibraryBrowser), hooks/useMediaQuery.tsx (future mobile responsive use).
First Load JS for / should drop noticeably — measure with \`npm run build\`."
```

---

## Phase 4: Очистить `globals.css` и вынести `.logos-*` в отдельный файл

**Цель:** Один CSS-файл — стартовые resets + Tailwind base. Все `.logos-*` правила в `src/components/logos/logos.css`.

### Task 4.1: Создать `logos.css` с текущими правилами

**Files:**
- Create: `apps/frontend/src/components/logos/logos.css`

- [ ] **Step 1: Скопировать `.logos-*` блоки**

Из `apps/frontend/src/app/globals.css` (после строки `@keyframes logos-drift`) скопировать все блоки: keyframes + `.logos-answer` + `.logos-library-*` + base body. Конкретно — всё что добавлено мной в port-коммите.

Содержимое нового `apps/frontend/src/components/logos/logos.css`:

```css
/* ─── ΛΟΓΟΣ shell base + animations ────────────────────────────────────────
   Imported once by LogosShell. Keeps the design palette out of the
   global tailwind layer so the only "global" thing here is body reset
   and font selection. */

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}
body {
  background: #0b0c0e;
  color: #ece6d6;
  font-family: var(--font-inter), "Inter", ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}
::selection { background: rgba(236, 230, 214, 0.18); }
button:focus-visible, textarea:focus-visible, a:focus-visible {
  outline: 1px solid rgba(236, 230, 214, 0.28);
  outline-offset: 2px;
}

@keyframes logos-rise {
  0%   { opacity: 0; transform: translateY(10px); filter: blur(2px); }
  100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
}
@keyframes logos-pulse {
  0%,100% { opacity: 0.35; transform: scale(0.85); }
  50%     { opacity: 1;    transform: scale(1.05); }
}
@keyframes logos-blink {
  0%,100% { opacity: 1; }
  50%     { opacity: 0; }
}
@keyframes logos-drift {
  0%   { background-position: 0 0; }
  100% { background-position: 320px 320px; }
}

/* Reduced-motion users: kill the heavy animations. The cursor light
   still tracks (it's tied to user motion already), but the autonomous
   flame/rise/blink loops freeze on the first frame. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* (… all .logos-answer { … } rules from current globals.css …) */
/* (… all .logos-library-* { … } rules from current globals.css …) */
```

**Дословно** перенести правила из `globals.css` (Section "Logos answer body" и "Library dialog"). Не редактировать — это refactor, не редизайн.

- [ ] **Step 2: Импортить в LogosShell**

В `apps/frontend/src/components/logos/LogosShell.tsx`, в самом верху файла после `"use client";`:

```ts
import "./logos.css";
```

- [ ] **Step 3: Очистить `globals.css`**

Финальное состояние `apps/frontend/src/app/globals.css` — минимально, только Tailwind base:

```css
@import "tailwindcss";

/* Минимальный tailwind base. Палитра, шрифты, keyframes Logos живут
   в components/logos/logos.css (импортится из LogosShell). Локальная
   тёмная тема — единственная тема приложения. */
@layer base {
  body {
    @apply text-foreground;
  }
}
```

Удаляется всё:
- OKLCH `:root` и `.dark` блоки (никем не использовались — нет элементов с `class="dark"`)
- `@theme inline` блок (mapping для shadcn)
- `@plugin "tailwindcss-animate"` (плагин удалён в Task 3.4)
- `@custom-variant dark`
- `.shadow-inner-{right,left}` (никем не используются — grep подтвердит)
- Все мои перенесённые `.logos-*` правила и keyframes
- `@layer base { * { @apply border-border ... } }` (border-border переменная больше не определена)

Финальные `--color-foreground` и связанные tailwind tokens нужно или удалить совсем, или оставить минимально для `body { @apply text-foreground }`. Проще удалить `@apply text-foreground` и поставить `color: #ece6d6;` напрямую — но это уже есть в `logos.css`. Значит body-стиль в `globals.css` вообще не нужен. Финальное состояние:

```css
@import "tailwindcss";
/* All app styles live in src/components/logos/logos.css, which is
   imported by LogosShell.tsx. This file just pulls in Tailwind's
   reset layer for the rare elements outside the Logos shell. */
```

- [ ] **Step 4: Удалить tailwind config файлы которые ссылаются на удалённые tokens**

```bash
cd apps/frontend
cat tailwind.config.js
```

Если конфиг ссылается на `border`, `foreground`, и пр. shadcn tokens — заменить на пустой объект `theme.extend`:

```js
// apps/frontend/tailwind.config.js — финал:
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
};
```

- [ ] **Step 5: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный. Если Tailwind ругается на потерянный @apply target — заменить @apply на сырой CSS.

- [ ] **Step 6: Smoke**

`npm run dev`, открыть `/`. Визуально всё должно остаться идентичным предыдущему билду — это refactor, не редизайн.

- [ ] **Step 7: Коммит**

```bash
git add apps/frontend/src apps/frontend/tailwind.config.js
git commit -m "refactor(frontend): extract .logos-* into logos.css, prune dead tailwind tokens

globals.css became a tiny tailwind base import. All Logos-shell styling
(palette colors, keyframes, library dialog, markdown overrides) moved to
components/logos/logos.css, imported once by LogosShell.tsx.

Removed OKLCH shadcn token blocks, the .dark class palette, the @theme
inline mapping, the tailwindcss-animate plugin import, and the
.shadow-inner-{left,right} utilities — none were referenced anywhere in
the new shell. The single-theme app stays visually identical."
```

---

## Phase 5: Unit-тесты для чистой логики

**Цель:** Зафиксировать поведение `turns.ts::groupMessagesIntoTurns` (главный сложный кусок логики) и `i18n.ts::detectLang` тестами, чтобы будущие правки не сломали трактовку tool-calls / language detection.

### Task 5.1: Тест на `turns.ts`

**Files:**
- Create: `apps/frontend/src/components/logos/__tests__/turns.test.ts`

- [ ] **Step 1: Написать failing tests**

```ts
import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { groupMessagesIntoTurns } from "../turns";

const human = (id: string, text: string): Message => ({
  id, type: "human", content: [{ type: "text", text }],
} as Message);

const ai = (id: string, text: string, toolCalls: Array<{name: string; id: string; args: Record<string, unknown>}> = []): Message => ({
  id, type: "ai", content: text,
  tool_calls: toolCalls.map((tc) => ({ ...tc, type: "tool_call" as const })),
} as Message);

const tool = (id: string, name: string, callId: string, result: unknown): Message => ({
  id, type: "tool", name, tool_call_id: callId,
  content: typeof result === "string" ? result : JSON.stringify(result),
} as Message);

describe("groupMessagesIntoTurns", () => {
  it("returns empty array for empty messages", () => {
    expect(groupMessagesIntoTurns([], false)).toEqual([]);
  });

  it("groups one human + one ai answer into one turn with no tool calls", () => {
    const turns = groupMessagesIntoTurns(
      [human("h1", "Что говорит Дамаскин?"), ai("a1", "Учение о латрии…")],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].human?.id).toBe("h1");
    expect(turns[0].ais).toHaveLength(1);
    expect(turns[0].toolCalls).toEqual([]);
    expect(turns[0].answerText).toBe("Учение о латрии…");
    expect(turns[0].inProgress).toBe(false);
  });

  it("pairs tool calls with their tool results by tool_call_id", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "найди про иконы"),
        ai("a1", "", [{ name: "search", id: "tc1", args: { q: "иконы" } }]),
        tool("t1", "search", "tc1", { hits: 3 }),
        ai("a2", "Найдено 3 фрагмента…"),
      ],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].toolCalls).toHaveLength(1);
    const tc = turns[0].toolCalls[0];
    expect(tc.id).toBe("tc1");
    expect(tc.name).toBe("search");
    expect(tc.args).toEqual({ q: "иконы" });
    expect(tc.pending).toBe(false);
    expect(tc.jsonResult).toEqual({ hits: 3 });
    expect(turns[0].answerText).toBe("Найдено 3 фрагмента…");
  });

  it("marks a tool call as pending if no matching tool message yet", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "?"),
        ai("a1", "", [{ name: "search", id: "tc1", args: {} }]),
      ],
      true,
    );
    expect(turns[0].toolCalls[0].pending).toBe(true);
    expect(turns[0].toolCalls[0].jsonResult).toBeNull();
    expect(turns[0].toolCalls[0].rawResult).toBeNull();
  });

  it("flags the latest turn as inProgress when isLoading=true", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "first"), ai("a1", "answered"),
        human("h2", "second"), ai("a2", "..."),
      ],
      true,
    );
    expect(turns[0].inProgress).toBe(false);
    expect(turns[1].inProgress).toBe(true);
  });

  it("uses the latest non-empty AI content as answerText (skips empty shells)", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "?"),
        // Empty AI shell (only contained tool_calls)
        ai("a1", "", [{ name: "search", id: "tc1", args: {} }]),
        tool("t1", "search", "tc1", "ok"),
        ai("a2", "финальный ответ"),
      ],
      false,
    );
    expect(turns[0].answerText).toBe("финальный ответ");
  });

  it("falls back to a synthesized key when the human message has no id", () => {
    const turns = groupMessagesIntoTurns(
      [{ type: "human", content: "?" } as Message],
      false,
    );
    expect(turns[0].key).toBeDefined();
    expect(turns[0].key.length).toBeGreaterThan(0);
  });

  it("handles a leading tool/ai message before any human (interrupt resume)", () => {
    const turns = groupMessagesIntoTurns(
      [ai("a1", "продолжаю с чекпойнта")],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].human).toBeNull();
    expect(turns[0].answerText).toBe("продолжаю с чекпойнта");
  });

  it("parses Anthropic-streamed tool_use blocks inside AI content array", () => {
    const aiAnthropic: Message = {
      id: "a1", type: "ai",
      content: [
        { type: "text", text: "ищу…" },
        { type: "tool_use", id: "tc1", name: "search", input: '{"q":"палама"}' },
      ],
    } as Message;
    const turns = groupMessagesIntoTurns(
      [human("h1", "?"), aiAnthropic],
      true,
    );
    expect(turns[0].toolCalls).toHaveLength(1);
    expect(turns[0].toolCalls[0].id).toBe("tc1");
    expect(turns[0].toolCalls[0].name).toBe("search");
    expect(turns[0].toolCalls[0].args).toEqual({ q: "палама" });
  });
});
```

- [ ] **Step 2: Run tests — they should already PASS**

Run: `cd apps/frontend && npm test -- turns.test`
Expected: 9 passing. (Это reverse-TDD — мы пишем тесты пост-фактум на уже работающий код, чтобы зафиксировать инвариант.)

Если какой-то fail — это баг в `turns.ts`, который мы случайно поймали. Зафиксировать каждый, разбираться отдельно.

- [ ] **Step 3: Коммит**

```bash
git add apps/frontend/src/components/logos/__tests__/turns.test.ts
git commit -m "test(frontend): pin behavior of groupMessagesIntoTurns

9 cases cover empty/normal/multi-turn, in-progress flag, Anthropic
tool_use block parsing, leading-AI without human, and the empty-AI-shell
→ next-AI-as-answer pattern produced by tool-calling agents."
```

### Task 5.2: Тест на `i18n.ts::detectLang`

**Files:**
- Create: `apps/frontend/src/components/logos/__tests__/i18n.test.ts`
- Modify: `apps/frontend/src/components/logos/i18n.ts` (export `detectLang`)

- [ ] **Step 1: Сделать `detectLang` экспортируемой**

В `apps/frontend/src/components/logos/i18n.ts`, найти строку:

```ts
function detectLang(): Lang {
```

Заменить на:

```ts
// Exported for unit tests. In runtime code go through `useLangState` instead.
export function detectLang(): Lang {
```

- [ ] **Step 2: Написать тесты**

```ts
// apps/frontend/src/components/logos/__tests__/i18n.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectLang } from "../i18n";

const originalNavigator = globalThis.navigator;

function setNavigatorLang(lang: string | undefined) {
  Object.defineProperty(globalThis, "navigator", {
    value: { language: lang ?? "" },
    configurable: true,
  });
}

describe("detectLang", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  it("returns 'ru' for ru-RU", () => {
    setNavigatorLang("ru-RU");
    expect(detectLang()).toBe("ru");
  });

  it("returns 'ru' for plain 'ru'", () => {
    setNavigatorLang("ru");
    expect(detectLang()).toBe("ru");
  });

  it("returns 'en' for en-US", () => {
    setNavigatorLang("en-US");
    expect(detectLang()).toBe("en");
  });

  it("returns 'en' for any non-russian tag (uk-UA, kk, etc.)", () => {
    setNavigatorLang("uk-UA");
    expect(detectLang()).toBe("en");
    setNavigatorLang("kk");
    expect(detectLang()).toBe("en");
    setNavigatorLang("zh-CN");
    expect(detectLang()).toBe("en");
  });

  it("returns 'en' when navigator.language is empty", () => {
    setNavigatorLang("");
    expect(detectLang()).toBe("en");
  });

  it("does not match 'rus' (only ^ru\\b)", () => {
    setNavigatorLang("rus-RU");
    expect(detectLang()).toBe("en");
  });

  it("case-insensitive: 'RU' → 'ru'", () => {
    setNavigatorLang("RU");
    expect(detectLang()).toBe("ru");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/frontend && npm test -- i18n.test`
Expected: 7 passing.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/logos
git commit -m "test(frontend): pin detectLang regex behavior

Covers ru-RU, plain ru, en-US, other-locale fallback, empty navigator,
and case-insensitivity. Catches accidental \"ru.*\" loosening that
would mis-detect rus-RU as Russian."
```

### Task 5.3: Извлечь `humanMessageText` helper и протестировать

**Files:**
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`
- Create: `apps/frontend/src/components/logos/markdown/content.ts` уже создан в Task 1.1; добавить туда `humanMessageText`
- Create: `apps/frontend/src/components/logos/__tests__/humanMessageText.test.ts`

- [ ] **Step 1: Перенести helper из LogosShell в `markdown/content.ts`**

Из `apps/frontend/src/components/logos/LogosShell.tsx` удалить:

```ts
function humanMessageText(m: Message): string {
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}
```

Добавить в `apps/frontend/src/components/logos/markdown/content.ts`:

```ts
import type { Message } from "@langchain/langgraph-sdk";

// (… existing getContentString …)

/** Extracts plain text from a human Message content (string or content blocks). */
export function humanMessageText(m: Message): string {
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}
```

В `LogosShell.tsx` заменить ссылку:

```ts
import { humanMessageText } from "./markdown/content";
```

- [ ] **Step 2: Тесты**

```ts
// apps/frontend/src/components/logos/__tests__/humanMessageText.test.ts
import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { humanMessageText } from "../markdown/content";

describe("humanMessageText", () => {
  it("returns string content as-is", () => {
    const m = { type: "human", content: "вопрос" } as Message;
    expect(humanMessageText(m)).toBe("вопрос");
  });

  it("joins text blocks with newline", () => {
    const m = {
      type: "human",
      content: [
        { type: "text", text: "первая строка" },
        { type: "text", text: "вторая строка" },
      ],
    } as Message;
    expect(humanMessageText(m)).toBe("первая строка\nвторая строка");
  });

  it("skips non-text blocks (images, files)", () => {
    const m = {
      type: "human",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
        { type: "text", text: "только текст" },
      ],
    } as unknown as Message;
    expect(humanMessageText(m)).toBe("только текст");
  });

  it("returns empty string for empty array", () => {
    const m = { type: "human", content: [] } as Message;
    expect(humanMessageText(m)).toBe("");
  });

  it("returns empty string for unexpected content shape", () => {
    const m = { type: "human", content: undefined } as unknown as Message;
    expect(humanMessageText(m)).toBe("");
  });
});
```

- [ ] **Step 3: Run**

Run: `cd apps/frontend && npm test`
Expected: всё (turns + i18n + humanMessageText) — 21 passing.

- [ ] **Step 4: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный (мы переместили helper).

- [ ] **Step 5: Коммит**

```bash
git add apps/frontend/src
git commit -m "refactor(frontend): extract humanMessageText, pin with tests"
```

---

## Phase 6: Вернуть Regenerate-кнопку под последним ответом

**Цель:** На последнем assistant-turn показывать кнопку «Перегенерировать» / «Regenerate», которая через `stream.submit(undefined, { checkpoint: parentCheckpoint, ... })` запускает альтернативный ответ.

### Task 6.1: Расширить `useStreamContext` API

LogosShell уже использует `useStreamContext`. Метод `getMessagesMetadata(message)` уже возвращает `firstSeenState.parent_checkpoint`. Берём оттуда.

### Task 6.2: Добавить i18n строки

**Files:**
- Modify: `apps/frontend/src/components/logos/i18n.ts`

- [ ] **Step 1: Добавить ключи в обе локали**

В `STRINGS.ru.chat`, после `you`:

```ts
    regenerate: "Перегенерировать",
    regenerateAria: "Перегенерировать ответ",
```

В `STRINGS.en.chat`:

```ts
    regenerate: "Regenerate",
    regenerateAria: "Regenerate the answer",
```

### Task 6.3: Дописать обработчик в `LogosShell`

**Files:**
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`

- [ ] **Step 1: Добавить `handleRegenerate`**

В компоненте `LogosInner`, после определения `submit`:

```ts
// Regenerate the last assistant turn. Uses the parent checkpoint from
// the last *human* message in the stream so the new generation forks
// off the same input.
const handleRegenerate = useCallback(() => {
  // Find the last human message to fork from
  const lastHumanIdx = [...stream.messages].reverse().findIndex((m) => m.type === "human");
  if (lastHumanIdx < 0) return;
  const lastHuman = stream.messages[stream.messages.length - 1 - lastHumanIdx];
  const meta = stream.getMessagesMetadata(lastHuman);
  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
  if (!parentCheckpoint) return;
  stream.submit(undefined, {
    checkpoint: parentCheckpoint,
    streamMode: ["values"],
    streamSubgraphs: true,
    streamResumable: true,
  });
}, [stream]);
```

- [ ] **Step 2: Пробросить handler в `ChatTurn` → `AssistantTurn`**

Изменить рендер чата:

```tsx
{turns.map((turn, i) => (
  <ChatTurn
    key={turn.key}
    turn={turn}
    isLastTurn={i === turns.length - 1}
    onRegenerate={handleRegenerate}
  />
))}
```

И обновить `ChatTurn`:

```tsx
function ChatTurn({
  turn, isLastTurn, onRegenerate,
}: {
  turn: ReturnType<typeof groupMessagesIntoTurns>[number];
  isLastTurn: boolean;
  onRegenerate: () => void;
}) {
  const humanText = turn.human ? humanMessageText(turn.human) : "";
  const showAssistant =
    turn.toolCalls.length > 0 ||
    turn.answerText.trim().length > 0 ||
    turn.inProgress;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {humanText && <HumanLine text={humanText} />}
      {showAssistant && (
        <AssistantTurn
          turn={turn}
          showRegenerate={isLastTurn && !turn.inProgress}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}
```

### Task 6.4: Кнопка в `AssistantTurn`

**Files:**
- Modify: `apps/frontend/src/components/logos/AssistantTurn.tsx`

- [ ] **Step 1: Принять props**

```tsx
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { MarkdownText } from "./markdown/markdown-text";
import { ThinkingTrace } from "./ThinkingTrace";
import { CitationsList } from "./CitationsList";
import type { DesignTurn } from "./turns";

interface Props {
  turn: DesignTurn;
  showRegenerate?: boolean;
  onRegenerate?: () => void;
}

export function AssistantTurn({ turn, showRegenerate, onRegenerate }: Props) {
  const { s } = useStrings();
  const showTrace = turn.toolCalls.length > 0;
  const showAnswer = turn.answerText.trim().length > 0;
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 22,
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
      }}
    >
      {showTrace && (
        <ThinkingTrace toolCalls={turn.toolCalls} inProgress={turn.inProgress} />
      )}
      {showAnswer && (
        <div className="logos-answer">
          <MarkdownText>{turn.answerText}</MarkdownText>
        </div>
      )}
      <CitationsList toolCalls={turn.toolCalls} />
      {showRegenerate && onRegenerate && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onRegenerate}
            aria-label={s.chat.regenerateAria}
            style={{
              appearance: "none",
              border: `0.5px solid ${palette.hairline}`,
              background: "transparent",
              color: palette.muted,
              fontFamily: type.mono,
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              padding: "8px 14px",
              borderRadius: 999,
              cursor: "default",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              transition: "color 240ms ease, border-color 240ms ease, background 240ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = palette.text;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = palette.muted;
              e.currentTarget.style.borderColor = palette.hairline;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
              <path
                d="M2 6 A4 4 0 0 1 10 6 M10 3 V6 H7 M10 6 A4 4 0 0 1 2 6 M2 9 V6 H5"
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span>{s.chat.regenerate}</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

- [ ] **Step 3: Smoke**

`npm run dev`, отправить вопрос, дождаться ответа, увидеть кнопку «Перегенерировать» справа снизу под ответом. Клик → пошёл новый стрим, появилась новая попытка.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/logos
git commit -m "feat(frontend): bring back Regenerate button under last assistant turn

Restores the regenerate flow lost during the design port. Uses the last
human message's parent_checkpoint from getMessagesMetadata to fork a new
generation off the same input. Pill matches Library/Light buttons; only
visible on the latest non-streaming turn."
```

---

## Phase 7: Вернуть Edit-режим для human-сообщений

**Цель:** Клик на human-сообщение в чате — превращает его в редактируемое поле. Submit → новый стрим с этого checkpoint.

### Task 7.1: i18n строки

**Files:**
- Modify: `apps/frontend/src/components/logos/i18n.ts`

- [ ] **Step 1: Добавить ключи**

В `STRINGS.ru.chat`:

```ts
    edit: "Изменить",
    editAria: "Изменить и переотправить",
    cancelEdit: "Отмена",
    saveEdit: "Сохранить",
```

В `STRINGS.en.chat`:

```ts
    edit: "Edit",
    editAria: "Edit and resubmit",
    cancelEdit: "Cancel",
    saveEdit: "Save",
```

### Task 7.2: Расширить `HumanLine`

**Files:**
- Modify: `apps/frontend/src/components/logos/HumanLine.tsx`

- [ ] **Step 1: Перейти на editable state**

Текущий `HumanLine` — статический. Нужно:
- держать `isEditing` локально
- при клике на pencil-icon → переключать в textarea
- onSave → вызвать prop `onEdit(newText)`

```tsx
"use client";

import { useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

interface Props {
  text: string;
  /** Editing is only enabled if this prop is provided. */
  onEdit?: (newText: string) => void;
}

export function HumanLine({ text, onEdit }: Props) {
  const { s } = useStrings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (editing) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          fontFamily: type.ui, fontSize: 14.5, lineHeight: 1.6,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            border: `0.5px solid ${palette.hairline}`,
            outline: 0,
            background: palette.surface,
            color: palette.text,
            fontFamily: type.ui,
            fontSize: 14.5,
            lineHeight: 1.5,
            padding: "10px 12px",
            borderRadius: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => { setDraft(text); setEditing(false); }}
            style={pillStyle(palette, type, false)}
          >
            {s.chat.cancelEdit}
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed || trimmed === text) {
                setEditing(false);
                return;
              }
              onEdit?.(trimmed);
              setEditing(false);
            }}
            style={pillStyle(palette, type, true)}
          >
            {s.chat.saveEdit}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 14,
        fontFamily: type.ui, fontSize: 14.5, lineHeight: 1.6,
        color: palette.muted,
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
      }}
      className="logos-human"
    >
      <div
        style={{
          flexShrink: 0, marginTop: 2,
          fontFamily: type.mono, fontSize: 10, letterSpacing: "0.18em",
          textTransform: "uppercase", color: palette.faint,
        }}
      >
        {s.chat.you}
      </div>
      <div style={{ color: palette.text, whiteSpace: "pre-wrap", flex: 1 }}>{text}</div>
      {onEdit && (
        <button
          type="button"
          onClick={() => { setDraft(text); setEditing(true); }}
          aria-label={s.chat.editAria}
          className="logos-human-edit"
          style={{
            appearance: "none",
            border: 0, background: "transparent",
            color: palette.faint,
            cursor: "default",
            padding: "2px 6px",
            fontFamily: type.mono, fontSize: 10,
            letterSpacing: "0.18em", textTransform: "uppercase",
            opacity: 0,
            transition: "opacity 200ms ease, color 200ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = palette.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = palette.faint; }}
        >
          {s.chat.edit}
        </button>
      )}
    </div>
  );
}

function pillStyle(p: typeof palette, t: typeof type, primary: boolean) {
  return {
    appearance: "none" as const,
    border: `0.5px solid ${p.hairline}`,
    background: primary ? "rgba(255,255,255,0.06)" : "transparent",
    color: primary ? p.text : p.muted,
    fontFamily: t.mono, fontSize: 10,
    letterSpacing: "0.22em", textTransform: "uppercase" as const,
    padding: "8px 14px",
    borderRadius: 999,
    cursor: "default" as const,
  };
}
```

- [ ] **Step 2: Добавить CSS для hover-показа Edit-кнопки**

В `apps/frontend/src/components/logos/logos.css` дописать:

```css
.logos-human .logos-human-edit { opacity: 0; }
.logos-human:hover .logos-human-edit,
.logos-human:focus-within .logos-human-edit { opacity: 1; }
```

### Task 7.3: Подключить `onEdit` через LogosShell → ChatTurn → HumanLine

**Files:**
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`

- [ ] **Step 1: Добавить `handleEditHuman`**

В `LogosInner`, после `handleRegenerate`:

```ts
// Edit a previous human message: forks the conversation at the parent
// checkpoint of that human and submits a new content.
const handleEditHuman = useCallback(
  (humanId: string | undefined, newText: string) => {
    if (!humanId) return;
    const target = stream.messages.find((m) => m.id === humanId);
    if (!target) return;
    const meta = stream.getMessagesMetadata(target);
    const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
    if (!parentCheckpoint) return;
    const newMessage: Message = {
      type: "human",
      content: [{ type: "text", text: newText }] as Message["content"],
    };
    stream.submit(
      { messages: [newMessage] },
      {
        checkpoint: parentCheckpoint,
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (prev) => ({
          ...prev,
          messages: [...(prev.messages ?? []), newMessage],
        }),
      },
    );
  },
  [stream],
);
```

- [ ] **Step 2: Пробросить в `ChatTurn` → `HumanLine`**

```tsx
{turns.map((turn, i) => (
  <ChatTurn
    key={turn.key}
    turn={turn}
    isLastTurn={i === turns.length - 1}
    onRegenerate={handleRegenerate}
    onEditHuman={(newText) => handleEditHuman(turn.human?.id, newText)}
  />
))}

// ...

function ChatTurn({
  turn, isLastTurn, onRegenerate, onEditHuman,
}: {
  turn: ReturnType<typeof groupMessagesIntoTurns>[number];
  isLastTurn: boolean;
  onRegenerate: () => void;
  onEditHuman: (newText: string) => void;
}) {
  // ...
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {humanText && <HumanLine text={humanText} onEdit={onEditHuman} />}
      {/* ... */}
    </div>
  );
}
```

- [ ] **Step 3: Build + smoke**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

`npm run dev`, в чате на ховере по human-сообщению должна появляться кнопка «Изменить». Клик → textarea + кнопки Cancel/Save. Save с новым текстом → новый стрим уходит с checkpoint предыдущего сообщения.

- [ ] **Step 4: Коммит**

```bash
git add apps/frontend/src/components/logos
git commit -m "feat(frontend): bring back edit-and-resubmit for human messages

Hover on a human line shows an 'Изменить' / 'Edit' pill. Click → inline
textarea with Cancel/Save. Save forks the conversation at that human's
parent_checkpoint and submits the new text, matching the upstream
agent-chat-ui behavior."
```

---

## Phase 8: Mobile + accessibility

**Цель:** Сделать главную и чат пригодными к использованию на 360px ширине; уважить `prefers-reduced-motion`.

### Task 8.1: Reduced-motion в `Background.tsx`

**Files:**
- Modify: `apps/frontend/src/components/logos/Background.tsx`

- [ ] **Step 1: Замёрзнуть анимации при reduced-motion**

В начале компонента `Background`:

```ts
// Honour user's motion preference: skip the flame/cursor rAF loops and
// the lighting modulation. The static rock still renders; only the
// breathing/pulsing/flicker goes away.
const reducedMotion = useReducedMotion();
```

Добавить хук в файл (или в отдельный `hooks/use-reduced-motion.ts`):

```ts
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
```

В обоих `useEffect` где запускается `requestAnimationFrame`:

```ts
useEffect(() => {
  if (lightSource !== "cursor") return undefined;
  if (reducedMotion) return undefined;          // ← добавить
  // ...
}, [lightSource, reducedMotion]);

useEffect(() => {
  if (reducedMotion) return undefined;          // ← добавить
  // ...
}, [lightSource, cursorIntensity, specConstant, reducedMotion]);
```

(Уже есть глобальный `@media (prefers-reduced-motion: reduce)` в `logos.css` от Task 4.1 — он убивает CSS keyframes. JS rAF нужно убить отдельно.)

- [ ] **Step 2: Build + manual reduced-motion test**

В Chrome DevTools → ⋮ → More tools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`. Открыть `/`. Курсор больше не подсвечивает скалу (фон статичен), но cube/quote/monolith видны.

### Task 8.2: Mobile-адаптация TopChrome

**Files:**
- Modify: `apps/frontend/src/components/logos/TopChrome.tsx`

- [ ] **Step 1: На узком экране — скрыть `brand` и `librarySlot`**

Использовать `useMediaQuery("(max-width: 640px)")`:

```ts
import { useMediaQuery } from "@/hooks/useMediaQuery";

// ...

export function TopChrome({...}: Props) {
  const isNarrow = useMediaQuery("(max-width: 640px)");
  return (
    <header
      style={{
        // ...
        padding: isNarrow ? "16px 16px 16px 60px" : "26px 36px 26px 76px",
        gap: 8,
      }}
    >
      {!isNarrow && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, pointerEvents: "auto" }}>
          {/* … brand dot + label … */}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto", marginLeft: isNarrow ? "auto" : 0 }}>
        {!isNarrow && librarySlot}
        {/* … home/lang/light pills … */}
      </div>
    </header>
  );
}
```

### Task 8.3: Mobile-адаптация Quote

**Files:**
- Modify: `apps/frontend/src/components/logos/Quote.tsx`

- [ ] **Step 1: Сжать padding**

```ts
const isNarrow = useMediaQuery("(max-width: 640px)");
// ...
padding: isNarrow ? "32px 20px" : "72px 140px",
```

(Импорт `useMediaQuery` сверху.)

### Task 8.4: Mobile-адаптация Sidebar

**Files:**
- Modify: `apps/frontend/src/components/logos/Sidebar.tsx`

- [ ] **Step 1: На touch — отключить hover-on-edge logic**

```ts
const isTouch = useMediaQuery("(hover: none)");
useEffect(() => {
  if (isTouch) return undefined;  // ← skip pointer tracking on touch
  const onMove = (e: PointerEvent) => {
    if (e.clientX <= 24) setHover(true);
  };
  window.addEventListener("pointermove", onMove);
  return () => window.removeEventListener("pointermove", onMove);
}, [isTouch]);
```

(При touch юзер открывает сайдбар тапом по иконке-burger — это уже работает через `onClick={() => setHover((v) => !v)}`.)

### Task 8.5: ChatBackdrop на узком экране

**Files:**
- Modify: `apps/frontend/src/components/logos/ChatBackdrop.tsx`

- [ ] **Step 1: На узком — full-width without horizontal mask**

```tsx
"use client";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export function ChatBackdrop() {
  const isNarrow = useMediaQuery("(max-width: 720px)");
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0, bottom: 0, left: "50%",
        transform: "translateX(-50%)",
        width: isNarrow ? "100vw" : "min(1140px, 100vw)",
        zIndex: 4, pointerEvents: "none",
        background: "rgba(0,0,0,0.94)",
        WebkitMaskImage: isNarrow
          ? "none"
          : "linear-gradient(to right, transparent 0, rgba(0,0,0,1) 80px, rgba(0,0,0,1) calc(100% - 80px), transparent 100%)",
        maskImage: isNarrow
          ? "none"
          : "linear-gradient(to right, transparent 0, rgba(0,0,0,1) 80px, rgba(0,0,0,1) calc(100% - 80px), transparent 100%)",
      }}
    />
  );
}
```

### Task 8.6: Build + manual mobile test

- [ ] **Step 1: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

- [ ] **Step 2: Smoke в Chrome DevTools mobile mode**

DevTools → Toggle device toolbar (Ctrl+Shift+M) → iPhone SE (375×667). Прогнать:
- Главная читается, brand скрыт, лого + цитата + инпут + стартеры влезают
- Чат: ChatBackdrop full-width, сообщения читаются
- Сайдбар: tap по burger открывает, ещё tap закрывает; hover-on-edge не срабатывает

### Task 8.7: Коммит

- [ ] **Step 1: git add + commit**

```bash
git add apps/frontend/src/components/logos apps/frontend/src/hooks
git commit -m "feat(frontend): mobile responsiveness + prefers-reduced-motion

- Background.tsx skips its rAF loops when prefers-reduced-motion: reduce
  is set; the rock stays still, cursor light frozen.
- TopChrome collapses (hides brand + Corpus pill) under 640px.
- Quote shrinks padding under 640px.
- Sidebar disables hover-on-edge on touch devices; users open via the
  burger icon tap.
- ChatBackdrop goes full-width without horizontal mask under 720px so
  text doesn't push under faded edges.
- A global @media (prefers-reduced-motion: reduce) rule in logos.css
  freezes the CSS keyframes (rise/pulse/blink/drift) too."
```

---

## Phase 9: ScrollToBottom affordance

**Цель:** В чате при автоскролле, если юзер прокрутил вверх — показать кнопку «к концу».

### Task 9.1: i18n

**Files:**
- Modify: `apps/frontend/src/components/logos/i18n.ts`

- [ ] **Step 1: Добавить ключи**

В `STRINGS.ru.chat`: `toBottom: "К концу"`, `toBottomAria: "Прокрутить к последнему сообщению"`.
В `STRINGS.en.chat`: `toBottom: "To end"`, `toBottomAria: "Scroll to the latest message"`.

### Task 9.2: Компонент

**Files:**
- Create: `apps/frontend/src/components/logos/ScrollToBottom.tsx`

```tsx
"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottom({ visible, onClick }: Props) {
  const { s } = useStrings();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={s.chat.toBottomAria}
      style={{
        position: "absolute",
        bottom: 100,
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? 0 : 10}px)`,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 240ms ease, transform 240ms ease",
        zIndex: 6,
        appearance: "none",
        border: `0.5px solid ${palette.hairline}`,
        background: "rgba(0,0,0,0.6)",
        color: palette.muted,
        fontFamily: type.mono, fontSize: 10,
        letterSpacing: "0.22em", textTransform: "uppercase",
        padding: "8px 14px 8px 10px",
        borderRadius: 999,
        cursor: "default",
        display: "inline-flex", alignItems: "center", gap: 8,
        backdropFilter: "blur(8px)",
      }}
    >
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
        <path d="M2 5l4 4 4-4" stroke="currentColor" strokeWidth={1.2}
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{s.chat.toBottom}</span>
    </button>
  );
}
```

### Task 9.3: Wire в `LogosShell`

**Files:**
- Modify: `apps/frontend/src/components/logos/LogosShell.tsx`

- [ ] **Step 1: Состояние видимости + обработчик скролла**

В `LogosInner`, после `scrollerRef`:

```ts
const [atBottom, setAtBottom] = useState(true);
useEffect(() => {
  const el = scrollerRef.current; if (!el) return undefined;
  const onScroll = () => {
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(slack < 24);
  };
  el.addEventListener("scroll", onScroll);
  onScroll();
  return () => el.removeEventListener("scroll", onScroll);
}, [scrollerRef.current, turns.length]);

const scrollToBottom = useCallback(() => {
  scrollerRef.current?.scrollTo({
    top: scrollerRef.current.scrollHeight,
    behavior: "smooth",
  });
}, []);
```

Изменить auto-scroll эффект — не дёргать вниз если юзер прокрутил вверх:

```ts
useEffect(() => {
  const el = scrollerRef.current;
  if (!el || !atBottom) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}, [stream.messages.length, stream.isLoading, atBottom]);
```

В JSX чата над `<Monolith>`:

```tsx
<ScrollToBottom visible={!atBottom} onClick={scrollToBottom} />
```

(Импортить `ScrollToBottom` сверху.)

### Task 9.4: Build + smoke + commit

- [ ] **Step 1: Build**

Run: `cd apps/frontend && npm run build`

- [ ] **Step 2: Smoke**

Открыть длинный чат, прокрутить вверх → видна кнопка «К концу» по центру над инпутом. Клик → smooth-scroll вниз, кнопка исчезает.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/logos
git commit -m "feat(frontend): bring back scroll-to-bottom affordance

The auto-scroll on new content now respects the user's scroll position:
if they've scrolled up, we stop auto-following the stream and show a
pill 'К концу' / 'To end' above the input. Click → smooth scroll.
Once they're back at the bottom the pill fades out."
```

---

## Phase 10: Документировать chatCount-progression + почистить мёртвый `dimCursor` баг

**Цель:** Зафиксировать поведение фичи «свет растёт от числа чатов в localStorage» и проверить пограничные сценарии.

### Task 10.1: Документация в `Background.tsx`

**Files:**
- Modify: `apps/frontend/src/components/logos/Background.tsx`

- [ ] **Step 1: Добавить doc-comment над `progress`/`torchness`**

Над блоком где определяется `const N = Math.max(0, chatCount);` дописать:

```ts
// ── Progressive illumination ─────────────────────────────────────────
// Cursor light strength scales with how many past conversations the
// user has had (passed in as chatCount, which comes from useThreads()).
//
//   N = 0   → very tight torch, ~15% of peak intensity.
//   N = 5   → torch peaks; starts crossfading to lamp.
//   N = 10  → full lamp shape; intensity ramping up.
//   N = 20+ → full lamp at 100% (capped by tweaks.light).
//
// KNOWN LIMITATION: chatCount is read from localStorage threads, which
// means clearing browser storage (or using incognito) resets the user
// to a "new visitor" cave. This is intentional — the metaphor is "your
// own accumulated conversations light up your space", not a global
// counter. If you need a server-backed counter, it would need to be
// fetched from the backend and merged here.
const N = Math.max(0, chatCount);
```

### Task 10.2: Проверить что `dimCursor` корректно работает в чате

В `LogosShell.tsx`, `dimCursor` передаётся как `inputFocused && !inChat`. То есть в чате фокус инпута больше не дёргает свет. Это правильно (в чате источника света от курсора нет — там пламя). Но `inputFocused` всё ещё обновляется в чате (Monolith вызывает `onFocusChange` если задан). Лишняя работа, но не баг. Проверить:

- [ ] **Step 1: Не передавать `onFocusChange` в чат-Monolith**

В `LogosShell.tsx`, чат-render Monolith:

```tsx
<Monolith
  onSubmit={submit}
  busy={stream.isLoading}
  onStop={() => stream.stop()}
  prefill={prefill}
  // Не передаём onFocusChange — в чате источник света не курсор
/>
```

(Сейчас это уже так — главный Monolith передаёт, чат-Monolith нет. Перепроверить ещё раз и убедиться.)

### Task 10.3: Commit

- [ ] **Step 1: Commit**

```bash
git add apps/frontend/src/components/logos/Background.tsx
git commit -m "docs(frontend): document chatCount → light progression behavior

The 0..20 chat ramp from torch to lamp is intentional 'sense of place'
poetry, but the localStorage edge-case (incognito = always cave) is now
spelled out in the source so future maintainers don't try to 'fix' it."
```

---

## Phase 11: Финальная верификация

### Task 11.1: Полный smoke + build + lint + tests

- [ ] **Step 1: Tests**

```bash
cd apps/frontend && npm test
```

Expected: 21+ passing, 0 failing.

- [ ] **Step 2: Lint**

```bash
cd apps/frontend && npm run lint
```

Expected: 0 errors. Warnings — только `react-refresh/only-export-components` в `providers/Stream.tsx` и `providers/Thread.tsx` (нормально, эти файлы exporto hooks + components).

- [ ] **Step 3: Build**

```bash
cd apps/frontend && npm run build
```

Expected: зелёный, `First Load JS` для `/` должен заметно упасть относительно стартовой точки (Phase 0 Task 0.3 baseline 408 kB). Записать новое число в коммит-сообщение.

- [ ] **Step 4: Прогнать `SMOKE.md` полностью**

Открыть `apps/frontend/SMOKE.md`, пройти каждый пункт. Зафиксировать что прошло, что не прошло (любые failing — стоп, фиксить отдельно).

### Task 11.2: Финальный commit-сообщение / PR summary

- [ ] **Step 1: Сводный коммит с метриками**

(Если все 11 фаз делались в одной ветке — пушим. Если разными PR — каждая фаза была отдельным.) Метрики:

```bash
echo "After-cleanup bundle:"
ls -lh apps/frontend/.next/static/chunks/ | head -5
```

Записать в PR/коммит-описание:
- Files removed: ~25 in `thread/`, 12 in `ui/`, 5 in `lib/`+`hooks/`
- NPM deps removed: 16
- `First Load JS` для `/`: 408 kB → ??? kB
- New tests: 21
- Features restored: Regenerate, Edit human, ScrollToBottom
- Features dropped intentionally: file upload, agent-inbox, artifacts, branch switcher
- Features deferred: footnote `[N]` markers (needs backend prompt change)

---

## Self-review checklist

Когда план выполнен:

1. **Spec coverage**: все 11 фаз ⊆ перечня в исходном анализе. Проверить:
   - ✅ Удаление orphan thread/* — Phase 2
   - ✅ Drop ArtifactProvider — Phase 3 implicit (через удаление ui/, теперь ничего из artifact не нужно — но `page.tsx` всё ещё может содержать `ArtifactProvider`. Сейчас он там, я его не удалил.) **→ ДОПОЛНИТЬ: Task 2.3 ниже.**
   - ✅ Drop dead deps — Phase 3.4
   - ✅ CSS hygiene — Phase 4
   - ✅ Tests for turns + i18n — Phase 5
   - ✅ Regenerate — Phase 6
   - ✅ Edit human — Phase 7
   - ✅ Mobile + a11y — Phase 8
   - ✅ ScrollToBottom — Phase 9
   - ✅ chatCount docs — Phase 10
   - ⏸ Footnote markers — отложено, требует бэкенд-изменений (D7)
   - ⏸ agent-inbox interrupt UI — отложено, бэк не использует (D2)
   - ❌ Branch switcher — drop (D6)

### Task 2.3 (вставка): Удалить `ArtifactProvider` из `page.tsx`

**Files:**
- Modify: `apps/frontend/src/app/page.tsx`

- [ ] **Step 1: Удалить обёртку и импорт**

Заменить содержимое `page.tsx` на:

```tsx
"use client";

import { LogosShell } from "@/components/logos/LogosShell";
import { StreamProvider } from "@/providers/Stream";
import { ThreadProvider } from "@/providers/Thread";
import { Toaster } from "@/components/ui/sonner";
import React from "react";

export default function HomePage(): React.ReactNode {
  return (
    <React.Suspense fallback={null}>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <LogosShell />
        </StreamProvider>
      </ThreadProvider>
    </React.Suspense>
  );
}
```

`ArtifactProvider` импорт удалён. Сам файл `components/thread/artifact.tsx` уже удалён в Task 2.2 — если Phase 2 уже прошла, этот Task должен идти ДО неё либо ArtifactProvider импорт упадёт. **Сдвинуть Task 2.3 в позицию Task 2.1.5 (между Task 2.1 и Task 2.2).**

- [ ] **Step 2: Build**

Run: `cd apps/frontend && npm run build`
Expected: зелёный.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/page.tsx
git commit -m "refactor(frontend): drop ArtifactProvider wrapper

The backend doesn't currently emit UI/Artifact messages (grep over
apps/backend/src). The provider was wrapping LogosShell from the design
port but nothing inside the shell calls useArtifact(). Removing it
unblocks the deletion of components/thread/artifact.tsx in the next
task."
```

---

2. **Placeholder scan**: каждый Step содержит конкретный код или конкретную команду. Никаких "TODO", "implement later".

3. **Type consistency**: `DesignTurn`, `DesignToolCall`, `Lang`, `Strings` — определены однажды, всё использование консистентно.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-logos-frontend-cleanup.md`. Two execution options:

**1. Subagent-Driven (recommended)** — я диспетчерю свежий subagent на каждую задачу из Phase, ревью между задачами, быстрая итерация. Хорошо подходит для рефакторинга с многими commits.

**2. Inline Execution** — выполнить задачи в этой сессии через executing-plans, батч-выполнение с checkpoint'ами для ревью. Подходит если хочешь видеть каждый коммит в реальном времени.

Какой подход?
