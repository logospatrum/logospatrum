# Stateless chat storage — design

**Date:** 2026-05-16
**Scope:** `apps/frontend` only (backend graph unchanged)
**Status:** Approved by user, pending implementation plan

## Motivation

Сегодня state чата живёт в двух местах:

- **Бек** (`langgraph dev` in-memory checkpointer): держит messages + parent_checkpoint chain per `thread_id` пока процесс жив.
- **Фронт** (`localStorage` под `patristic:threads`): дублирует тот же messages-массив для sidebar и hydration.

Это создаёт три конкретные проблемы:

1. **Orphan threadId после рестарта.** Юзер кликает старый чат из sidebar → фронт шлёт SDK старый `thread_id` → бек не знает его → state теряется.
2. **Regenerate/Edit ломается без сервера.** В `LogosShell.tsx:156-204` обе фичи зависят от `parent_checkpoint` который существует только в чекпоинтере. После рестарта `langgraph dev` обе кнопки молча no-op.
3. **Удвоение хранения.** `Stream.tsx` сохраняет messages в localStorage на каждый `useEffect` tick, а сервер параллельно строит свой чекпоинт-граф. Один из них всегда лишний.

Целевая модель — **localStorage как единственный источник truth**. Бек stateless, чекпоинты не создаются, threadId — чисто клиентское понятие.

## Decisions (locked)

- Storage model: **полностью stateless backend**.
- LangGraph mode: **stateless runs API** (`client.runs.stream(null, ...)`).
- Regenerate/Edit: **слайс messages в localStorage**, линейная история, без веток.
- `thread_id`: **чисто клиентский id**, никогда не попадает в бекенд.

## Architecture

### Поток данных при submit

1. Юзер вводит текст в `Monolith`.
2. `LogosShell.submit(text)`:
   - читает текущий `messages` из React-state (он же — снимок localStorage для активного треда);
   - склеивает `[...messages, newHumanMessage]`;
   - зовёт `stream.submit({messages: full})`.
3. `useStatelessStream.submit`:
   - открывает SSE через `client.runs.stream(null, "agent", {input: {messages}, streamMode: ["values"], streamSubgraphs: true})`;
   - обновляет React-state по каждому `values` chunk;
   - на `finally` сохраняет финальный массив в localStorage через существующий `useThreadStore.saveCurrent(threadId, finalMessages)`.
4. Бек получает threadless run, выполняет граф, ничего не персистит.

### Поток данных при переключении треда

1. Sidebar клик → `setThreadId(id)` (nuqs URL state).
2. `useEffect` в `Stream.tsx` ловит изменение `threadId`:
   - читает `StoredThread.messages` из localStorage;
   - зовёт `stream.setMessages(stored)`;
   - **никаких запросов к беку.**
3. Если `threadId === null` (home/new chat), `stream.setMessages([])`.

### Поток данных при regenerate / edit

`handleRegenerate` (последний assistant turn):

1. Находим индекс последнего `human` message в `stream.messages`.
2. `sliced = stream.messages.slice(0, lastHumanIdx + 1)` — отрезаем всё после.
3. `stream.submit({messages: sliced})` — submit как обычно.

`handleEditHuman(humanId, newText)`:

1. Находим индекс target human по id.
2. Заменяем text у этого human, режем всё после: `[...before, editedHuman]`.
3. `stream.submit({messages: edited})`.

Обе фичи теряют функцию **branch switching** (выбор между прошлыми вариантами ответа). CLAUDE.md уже отмечает что branch switcher был намеренно убран — это согласуется с выбранным MVP-скоупом.

## Components

### Новый: `apps/frontend/src/lib/useStatelessStream.ts`

Кастомный React-хук, заменяет `useStream` из `@langchain/langgraph-sdk/react` (только потребление, не зависимость — пакет `@langchain/langgraph-sdk` остаётся).

**Публичный API** (минимальный, под текущие потребности `LogosShell` и `Stream.tsx`):

```typescript
interface UseStatelessStream {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  submit: (input: { messages: Message[] }, options?: SubmitOptions) => void;
  stop: () => void;
  setMessages: (msgs: Message[]) => void;  // for thread switching
}

interface SubmitOptions {
  streamSubgraphs?: boolean;  // default: true
  optimisticValues?: (prev: State) => State;  // optional optimistic UI hook
}
```

**Внутреннее устройство:**

- `Client` из `@langchain/langgraph-sdk` создаётся один раз через `useMemo` по `apiUrl`.
- `messages`, `isLoading`, `error` — `useState`. `AbortController` — `useRef`.
- `submit`:
  1. **Если есть активный AbortController** — abort предыдущий run, дожидаемся unmount его итератора.
  2. **Optimistic**: `setMessages(optimisticValues ? optimisticValues({messages}).messages : input.messages)` — UI сразу показывает человеческое сообщение.
  3. `setIsLoading(true)`, новый `AbortController` в ref, `setError(null)`.
  4. `for await (const chunk of client.runs.stream(null, "agent", {input: {messages: input.messages}, streamMode: ["values"], streamSubgraphs: true}))`:
     - `chunk.event === "values"` — top-level values от main agent → `setMessages(chunk.data.messages)`.
     - `chunk.event` начинается с `agent.` (subgraph events от search subagent) — **игнорируем**: их messages относятся к внутреннему scratchpad subagent'а, не к финальной истории.
     - `chunk.event === "error"` → `setError(new Error(chunk.data.message))`, break.
  5. `catch` → если `name === "AbortError"` молчим, иначе `setError`.
  6. `finally` → `setIsLoading(false)`. **localStorage save делает `Stream.tsx`** через существующий `useEffect` на изменение `messages` — хук не знает про localStorage.
- `stop` → `abortRef.current?.abort()`.
- `setMessages` → `setMessages(msgs)`, не триггерит сеть.

**Поведение `messages` при stateless run.** В graph reducer (`add_messages`) "prev" пуст в начале stateless run (нет чекпоинтера). Поэтому отправка `{messages: full_history}` приводит к state = `full_history` → агент добавляет свои messages → SSE emits values с растущим массивом. Никакого удвоения нет.

**Что НЕ переносим из `useStream`:**

- `fetchStateHistory` — серверной истории больше нет.
- `getMessagesMetadata` / `firstSeenState.parent_checkpoint` — checkpoint-логика не нужна.
- `onThreadId` callback — threadId создаёт фронт сам.
- `onCustomEvent` для UI messages (`uiMessageReducer`) — графа на бэке нет таких ивентов; если появятся, добавим.
- `streamResumable: true` — без чекпоинтера resume бессмыслен.
- Throttle на 50ms — **оставляем**, иначе re-render на каждый SSE chunk. Реализация: батчим `setMessages` через `requestAnimationFrame` (последнее значение wins). Финальный chunk форсим (без батчинга) чтобы `messages` в localStorage точно были полные.

### Изменённый: `apps/frontend/src/providers/Stream.tsx`

- `useTypedStream` заменяется на `useStatelessStream`.
- `fetchStateHistory`, `onThreadId`, `onCustomEvent` удаляются.
- Логика "сохранять messages в localStorage на изменение" остаётся (`useEffect` с `saveCurrent`).
- **Новый useEffect**: на изменение `threadId` подтягивает messages из localStorage и вызывает `stream.setMessages`.

### Изменённый: `apps/frontend/src/components/logos/LogosShell.tsx`

- `handleRegenerate`: переписан под slice (см. поток выше). `getMessagesMetadata` и `parent_checkpoint` удаляются.
- `handleEditHuman`: переписан под slice.
- `submit`: остаётся в текущем виде — он уже шлёт `[...stream.messages, newHuman]`.

### Без изменений

- `apps/frontend/src/providers/Thread.tsx` — продолжает читать/писать localStorage через store API.
- `apps/frontend/src/lib/local-thread-store.ts` — без изменений.
- `apps/frontend/src/lib/ensure-tool-responses.ts` — переиспользуется в `submit` чтобы при slice не оставались orphan `tool_calls`.
- `apps/backend/**` — backend не трогаем.

## Edge cases

### Quota `localStorage` (5–10 MB)

Уже частично обработана в `saveThreads`: на `setItem` failure режется половина старых тредов. На MVP оставляем; в комментарий добавим TODO про IndexedDB / per-message compression если упрёмся в quota раньше чем планировали.

### Orphan `tool_call` при slice

Если slice происходит посреди assistant-turn где есть `tool_call` без парного `tool` response — бек упадёт на валидации. Решение: пропускать input через существующий `ensureToolCallsHaveResponses` до submit (в regenerate, edit и обычном submit).

### Параллельные табы

`storage` event уже слушается в `Thread.tsx` для синка sidebar. Активный стрим из второго таба не синкается — это редкий кейс, осознанно игнорируем.

### Stop посреди стрима

AbortController отрубает SSE. `messages` в state остаются полугенерированными (часть assistant content / orphan tool_calls). Сохраняем что есть. Юзер увидит обрезанный ответ и может либо стереть тред, либо нажать regenerate (slice до последнего human решит проблему orphan tool_call).

### Backend restart посреди стрима

SSE рвётся → `error` поднимается → toast. Юзер давит regenerate — фронт шлёт messages из localStorage, бек жив, всё работает.

### Hydration / SSR

`StreamProvider` рендерится на клиенте (Next 15 app router, "use client"). localStorage доступен на маунте. До маунта `stream.messages = []`; mismatch с SSR не возникает потому что вся chat-зона — клиентская.

## What we explicitly DON'T do

- Не трогаем бек. `langgraph dev` продолжает создавать in-memory чекпоинтеры на каждый run если случайно прилетит `thread_id` — но фронт его никогда не шлёт, так что они никогда не создаются.
- Не делаем cross-device sync, auth, server-side persistence — это отдельный спек если/когда понадобится.
- Не делаем branch switching — линейная история, regenerate перезаписывает последний assistant turn.
- Не убираем `langgraph dev` и не переходим на голый FastAPI SSE — SDK всё равно делает удобную абстракцию над streaming, и threadless mode официально поддерживается.

## Testing

- **Unit** (vitest, новый файл `src/lib/__tests__/useStatelessStream.test.ts`, моки `Client.runs.stream` async iterator):
  - submit без активного потока: вызывает `client.runs.stream(null, ...)` с правильным `input`.
  - submit во время другого submit: abort предыдущего, начинает новый.
  - stop: AbortController отрабатывает, `isLoading` сбрасывается.
  - setMessages: меняет state без сетевого вызова.
  - error: ошибка стрима пишется в `error`, `isLoading` сбрасывается.
  - subgraph events игнорируются: messages не перезаписываются на `agent.*` events.
- **Unit** (slice logic, можно добавить в существующий `turns.test.ts` или новый):
  - `sliceForRegenerate(messages)` отрезает по последнему human.
  - `sliceForEdit(messages, humanId, newText)` заменяет target и режет хвост.
- **Smoke (manual)**: следующий PR со скоупом фронт → прогон `apps/frontend/SMOKE.md`. Ключевые сценарии: новый чат, переключение между чатами, regenerate, edit, stop посреди стрима, рестарт `langgraph dev` посреди сессии.

## Migration / rollout

Один PR. Никаких миграций данных — localStorage schema (`patristic:threads`, version `1`) не меняется. Старые чаты юзеров продолжат работать.

## Open questions

Нет.
