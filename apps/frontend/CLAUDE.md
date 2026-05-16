# apps/frontend — patristic chat UI

Next.js 15 chat UI (React 19) for the patristic chat agent. Forked from `langchain-ai/agent-chat-ui` and then rebuilt on top of the **ΛΟΓΟΣ Logos shell** ([docs/superpowers/plans/2026-05-16-logos-frontend-cleanup.md](../../docs/superpowers/plans/2026-05-16-logos-frontend-cleanup.md)). Streams from a running LangGraph Server via `@langchain/langgraph-sdk`. Chat history is **client-side localStorage** — no `/threads` list endpoint on the backend.

## Shape

- `src/app/{layout,page,globals}.{tsx,css}` — Next entrypoint. `page.tsx` mounts `<ThreadProvider><StreamProvider><LogosShell/></StreamProvider></ThreadProvider>`; `layout.tsx` wires next/font/google for Cormorant + EB Garamond + Inter + Geist Mono (CSS variables exposed); `globals.css` is a tiny `@import "tailwindcss";` stub.
- `src/components/logos/` — the design shell (see "Logos shell" below).
- `src/components/library/` — `LibraryBrowser` Radix dialog + `use-catalog` hook for the `/catalog` endpoint.
- `src/components/citation-card.tsx` — types only (`ReadPassageSuccess`, `ReadPassageFailure`, `ReadPassageResult`). The Logos `CitationsList` consumes the type; the legacy `CitationCard` component itself is unused.
- `src/components/icons/` — small SVG components (`github`, `langgraph`).
- `src/components/ui/sonner.tsx` — Toaster wrapper. The other shadcn wrappers (`button`, `card`, `dialog`, etc.) were deleted with the Thread shell — see commit `e1b1f6c`.
- `src/providers/Stream.tsx`, `src/providers/Thread.tsx`, `src/lib/local-thread-store.ts` — unchanged from the upstream design but kept for streaming + localStorage history.
- `src/lib/ensure-tool-responses.ts` — helper used by `LogosShell.submit`.
- `src/hooks/useMediaQuery.tsx` — used by mobile-responsive Logos components.

## Logos shell (`src/components/logos/`)

The Claude Design "ΛΟΓΟΣ — Theological Research Assistant" prototype (`Logos.html`) was ported here and re-wired to the real `useStreamContext()` and `useThreads()`. Layout:

- `LogosShell.tsx` — orchestrator. Owns the home/chat split, `lightOn` toggle (persisted in `localStorage:logos:lightOn`), prefill prop chain, `handleRegenerate`, `handleEditHuman`, auto-scroll + `ScrollToBottom`. Mounts the LangContext provider.
- `tokens.ts` — frozen "Graphite Vespers" palette + Cormorant/EB Garamond/Inter/Geist Mono pairing. Hardcoded — the Tweaks panel from the design was a design-tool artifact and isn't shipped.
- `i18n.ts` — RU/EN string dict, `LangContext`, `useLangState`, `useStrings`, `detectLang` (browser-language auto-detect; persisted in `localStorage:logos:lang`).
- `logos.css` — base body reset, four keyframes (`logos-rise`, `logos-pulse`, `logos-blink`, `logos-drift`), `prefers-reduced-motion` block, `.logos-answer` markdown overrides, `.logos-library-*` dialog rules.
- `Background.tsx` — heavy SVG: `feTurbulence` × `feDisplacementMap` rock height-field, ambient + cursor `feDiffuseLighting`, cursor `feSpecularLighting`, flame primitives for chat-mode pulsing, cross-shadow overlay, torch cone overlay. Two rAF loops modulate `diffuseConstant`/`specularConstant` via `setAttribute` (NOT React) so the bundle doesn't re-render 60×/sec. Honours `prefers-reduced-motion`.
- `TopChrome.tsx`, `BottomChrome.tsx` — header / footer chrome. RU/EN segmented radio + Light toggle + Library pill + brand. Collapses on `(max-width: 640px)`.
- `Sidebar.tsx` — left-edge peek-out chat history. Hover-on-edge desktop, tap-toggle touch via `useMediaQuery("(hover: none)")`.
- `Logo.tsx`, `Quote.tsx`, `Monolith.tsx`, `Starters.tsx` — home composition.
- `ChatBackdrop.tsx` — vertical dark column behind chat. Full-width under `(max-width: 720px)`.
- `Chevron.tsx`, `ScrollToBottom.tsx` — leaf UI primitives.
- `ThinkingTrace.tsx` — two-level collapse over `DesignToolCall[]`.
- `CitationsList.tsx` — compact rendering of `read_passage` tool results in the design's column grid. Handles both `ReadPassageSuccess` and `ReadPassageFailure` shapes.
- `HumanLine.tsx` — human message with hover-revealed inline Edit (textarea + Cancel/Save).
- `AssistantTurn.tsx` — wraps `ThinkingTrace` + `MarkdownText` (`.logos-answer` palette overrides) + `CitationsList` + optional Regenerate pill.
- `turns.ts` — `groupMessagesIntoTurns(Message[], isLoading)` → `DesignTurn[]`. Pairs `tool_call.id` to its matching tool result; handles Anthropic-streamed `tool_use` blocks inside content arrays.
- `markdown/markdown-text.tsx`, `markdown-styles.css`, `syntax-highlighter.tsx`, `content.ts` — relocated from `components/thread/` (commit `f15e08f`). `MarkdownText` has smooth-typewriter + react-markdown + react-syntax-highlighter + katex.
- `__tests__/{turns,i18n,humanMessageText}.test.ts` — 21 vitest cases pinning pure-logic behavior.

## Backend integration touchpoints

- `useStreamContext()` (from `providers/Stream.tsx`) — `messages`, `isLoading`, `error`, `submit({messages}, {checkpoint?, …})`, `stop()`, `getMessagesMetadata(msg)` for fork-from-checkpoint flows.
- `useThreads()` (from `providers/Thread.tsx`) — localStorage thread list, `useThreadStore.saveCurrent` writes on every message change. Sidebar reads `threads.map(t => ({id: t.thread_id, title: t.metadata.title}))`.
- `LibraryBrowser` — fetches `${NEXT_PUBLIC_CATALOG_API_URL}/catalog`. "Ask about this work" dispatches a `patristic:prefill-input` custom event; `LogosShell` listens and pushes the text into `Monolith.prefill`.
- `read_passage` tool results — surfaced into `CitationsList` if they match `looksLikeReadPassage` (`text` + `para_start` + `window_size` + `author` + `work_title`, OR the `{found:false,error,citation}` failure shape).

## Environment

`.env.local` is auto-loaded. Only `NEXT_PUBLIC_*` variables reach the browser.

```
NEXT_PUBLIC_API_URL=http://localhost:2024
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_ASSISTANT_ID=agent
NEXT_PUBLIC_CATALOG_API_URL=http://localhost:8001
NEXT_PUBLIC_AUTH_SCHEME=
```

`StreamProvider` reads `NEXT_PUBLIC_API_URL || NEXT_PUBLIC_LANGGRAPH_API_URL`, defaults to `http://localhost:2024`. Assistant id defaults to `agent`. **Verify the `langgraph dev` port** — it cycles when an old port hangs in `TIME_WAIT`.

**Catalog URL mismatch (real):** `.env.local` says `:8001` but `apps/backend/langgraph.json` mounts `backend.catalog:app` on the same port as `langgraph dev` (`:2024`). Pick one and align `apps/frontend/.env.local` with `apps/backend/`.

Smoke-checks against a running `langgraph dev`:
```
curl http://localhost:2024/info       # langgraph status (used by Stream.tsx)
curl http://localhost:2024/catalog    # FastAPI catalog mount
```

## Running locally

```
cd apps/frontend
npm install        # npm wins; pnpm-lock.yaml is committed but unused
npm run dev        # http://localhost:3000
```

Prereqs: `langgraph dev` running at the configured URL, Postgres up (catalog hits `authors` + `works` tables).

## Tests + build

```
npm test           # 21 vitest cases (turns.ts, i18n.ts, humanMessageText)
npm run lint       # 0 errors expected; 4 pre-existing react-refresh warnings
npm run build      # production build
```

Manual QA — run `SMOKE.md` after any PR touching `src/components/logos/*`, `src/app/*`, or `src/providers/*`.

## Gotchas

- **Two lockfiles committed** (`package-lock.json` AND `pnpm-lock.yaml`). Pick one before touching deps. The repo uses npm.
- **Logos shell uses inline-style objects + raw CSS classes**, not Tailwind. The `@import "tailwindcss"` in `globals.css` only exists for the few non-Logos surfaces (Sonner Toaster, Radix Dialog backdrop). If you find yourself reaching for `cn()` or `class-variance-authority`, you're probably writing in the wrong style — match the surrounding component.
- **NBSP characters** appear in some i18n strings ("Вы —" / "You —"). The Edit tool occasionally can't anchor on Cyrillic lines that contain them — fall back to `Write` to rewrite the block, or use Powershell/sed with explicit code points.
- TS strict mode is on. Run `npm run lint` (and ideally `npm run format`) before committing.
- Clearing browser storage drops all chat history. `langgraph dev` is in-memory in dev too — no recovery.
- `LibraryBrowser` filter is pure client-side over the full catalog. Fine at current scale; reconsider past ~10K works.
- `read_passage` tool-result shape is consumed by `CitationsList` via the `looksLikeReadPassage` guard. Backend changes to the return shape must keep `text`, `para_start`, `window_size`, `author`, `work_title` (success) or `{found:false, error, citation, work_exists?}` (failure) — or update `src/components/logos/CitationsList.tsx` in lockstep.

## Intentionally NOT shipped

These were in the upstream `agent-chat-ui` Thread shell, deleted during the Logos cleanup (commits `b0ddad7`, `e1b1f6c`, `5b0440f`):

- File upload (PDF/image) UI — backend doesn't accept multimodal
- `ArtifactProvider` + artifact panel — backend doesn't emit artifacts
- Branch switcher (alternative response trees)
- agent-inbox interrupt UI — backend doesn't currently use `interrupt()`. If it does, this needs to be rebuilt on top of the Logos shell.
- The hide-tool-calls toggle — ThinkingTrace is always present and individually collapsible.
- "Hide" footnote markers `[1][2][3]` — would require a backend prompt-tuning step that emits markers in the answer text.

If any of those become required, add them on top of `LogosShell` in a focused plan rather than re-importing the old Thread tree.
