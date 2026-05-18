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
- `CitationsList.tsx` — citations panel below the answer. Driven by agent-emitted markers (`CitationMarker[]` from `extractMarkers(turn.answerText)`), joined to `read_passage` tool calls by exact slug for rich metadata. One row per marker; shows the agent's short `«quote»` + author/work + chapter §-ref + azbyka link + "ПОЛНЫЙ ПАРАГРАФ" button that opens `PassageModal`. Returns null when no markers.
- `CitationPill.tsx` — inline `[N]` rendered by react-markdown for each `citation-marker` MDAST node (emitted by `remarkCitation`). Click → smooth scroll to the matching panel row via `CitationContext.scrollToN`; hover toggles `data-active` on both the pill and the row through `CitationContext.hoveredN`. Href is `#${turnKey}-cite-${n}` so middle-click also lands correctly.
- `CitationContext.tsx` — per-turn `<CitationProvider turnKey={turn.key}>` carrying `{hoveredN, setHoveredN, scrollToN, turnKey}`. Row IDs are namespaced (`${turnKey}-cite-${n}`), so multiple turns in the page don't collide. `useCitationContext()` throws if used outside the provider.
- `PassageModal.tsx` — Radix Dialog. Shows full `read_passage.text` with the agent's short quote highlighted via `<mark>` (soft-fails to plain text + `s.citation.highlightNotFound` if `text.indexOf(quote) < 0`). Renders `context_before`/`context_after` if present plus the source URL link.
- `HumanLine.tsx` — human message with hover-revealed inline Edit (textarea + Cancel/Save).
- `AssistantTurn.tsx` — wraps `ThinkingTrace` + `MarkdownText` (`.logos-answer` palette overrides) + `CitationsList` + optional Regenerate pill. Pre-numbers markers in `turn.answerText` via `numberMarkers(text)` before handing to `MarkdownText` (so the per-block ReactMarkdown calls share a stable N counter), extracts `CitationMarker[]` via `extractMarkers(text)` to feed `CitationsList`, and wraps everything in `<CitationProvider turnKey={turn.key}>`.
- `turns.ts` — `groupMessagesIntoTurns(Message[], isLoading)` → `DesignTurn[]`. Pairs `tool_call.id` to its matching tool result; handles Anthropic-streamed `tool_use` blocks inside content arrays.
- `markdown/markdown-text.tsx`, `markdown-styles.css`, `syntax-highlighter.tsx`, `content.ts` — relocated from `components/thread/` (commit `f15e08f`). `MarkdownText` has smooth-typewriter + react-markdown + react-syntax-highlighter + katex. The plugin chain is `[remarkGfm, remarkMath, remarkCitation]`; the `citation-marker` element maps to `<CitationPill>`.
- `__tests__/{turns,i18n,humanMessageText}.test.ts` — 21 vitest cases pinning pure-logic behavior.

The agent-marker pipeline lives in `src/lib/`:

- `citation-marker.ts` — `AGENT_MARKER_RE` (matches `[[slug|«quote»]]`), `INTERNAL_MARKER_RE` (post-numbering `[[#N|slug|«quote»]]`), `extractMarkers(text)` → `{n, slug, quote}[]`, `numberMarkers(text)` → text with `[[#N|…]]` substituted in left-to-right order.
- `remark-citation.ts` — unified/remark plugin. Walks `parent.children` manually (no `unist-util-visit` dep), replaces matched text spans with `citationMarker` MDAST nodes mapped to the custom `citation-marker` element. Consumes pre-numbered markers (so per-block ReactMarkdown calls keep a coherent N sequence).

## Backend integration touchpoints

- `useStreamContext()` (from `providers/Stream.tsx`) — `messages`, `isLoading`, `error`, `submit({messages}, {checkpoint?, …})`, `stop()`, `getMessagesMetadata(msg)` for fork-from-checkpoint flows.
- `useThreads()` (from `providers/Thread.tsx`) — localStorage thread list, `useThreadStore.saveCurrent` writes on every message change. Sidebar reads `threads.map(t => ({id: t.thread_id, title: t.metadata.title}))`.
- `LibraryBrowser` — fetches `${NEXT_PUBLIC_CATALOG_API_URL}/catalog`. "Ask about this work" dispatches a `patristic:prefill-input` custom event; `LogosShell` listens and pushes the text into `Monolith.prefill`.
- Agent citations — main agent emits `[[<citation_slug>|«<short quote>»]]` inline in answers (see `apps/backend/src/backend/prompts.py` rule 4). Frontend `extractMarkers` pulls them out for the panel; `remarkCitation` turns them into inline `[N]` pills. The panel matches each marker's slug to a `read_passage` tool call's `args.citation` for rich data (author, work, chapter, §, source URL). No marker → no panel row; no matching `read_passage` → error row with diagnostic.

## Environment

Two layers of env vars:

- `apps/frontend/.env.local` — **browser-visible** (`NEXT_PUBLIC_*` only) and server-side defaults for `next dev`. Auto-loaded.
- Process env at runtime — Next.js SSR proxy at `src/app/api/[..._path]/route.ts` reads `BACKEND_URL` (defaults to `http://localhost:8000`) to know where to forward.

Typical `.env.local` for local dev (frontend on :3001 → Next proxy → backend on :8000):

```
NEXT_PUBLIC_API_URL=/api          # browser hits /api, the proxy forwards
NEXT_PUBLIC_ASSISTANT_ID=patristic
NEXT_PUBLIC_AUTH_SCHEME=
BACKEND_URL=http://localhost:8000  # Next.js SSR proxy target
```

To bypass the proxy and hit the backend directly from the browser (no HMAC, no budget guard), set `NEXT_PUBLIC_API_URL=http://localhost:8000`.

`StreamProvider` reads `NEXT_PUBLIC_API_URL`, defaults to `/api`. Assistant id defaults to `patristic`.

Smoke-checks against a running backend:
```
curl http://localhost:8000/info       # FastAPI /info endpoint
curl http://localhost:8000/catalog    # authors+works dump
```

## Running locally

```
cd apps/frontend
npm install        # npm wins; pnpm-lock.yaml is committed but unused
PORT=3001 npm run dev   # http://localhost:3001
```

**Port 3001, not 3000.** 3000 is reserved by other tooling on this machine — DO NOT use it. Always start the frontend with `PORT=3001`. The default Next.js port (3000) is hands-off.

Prereqs: backend running (`uvicorn backend.server:app --port 8000 --reload` from `apps/backend/`), Postgres up (catalog hits `authors` + `works` tables).

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
- Clearing browser storage drops all chat history. The backend is stateless (no thread persistence), so there's nothing to recover from server-side either.
- `LibraryBrowser` filter is pure client-side over the full catalog. Fine at current scale; reconsider past ~10K works.
- `read_passage` tool-result shape is consumed by `CitationsList` (via slug-matching) and by `PassageModal` (via the `ReadPassageSuccess` type). Backend changes to the return shape must keep `text`, `para_start`, `window_size`, `author`, `work_title`, `source_url`, `chapter_num`/`chapter_title`, `context_before`/`context_after` (success) or `{found:false, error, citation, work_exists?}` (failure) — or update `src/components/logos/CitationsList.tsx` and `PassageModal.tsx` in lockstep.
- The agent's `[[slug|«quote»]]` marker syntax is a load-bearing contract between `prompts.py` rule 4 and `src/lib/citation-marker.ts` (`AGENT_MARKER_RE`). Don't change the regex on one side without the other.

## Intentionally NOT shipped

These were in the upstream `agent-chat-ui` Thread shell, deleted during the Logos cleanup (commits `b0ddad7`, `e1b1f6c`, `5b0440f`):

- File upload (PDF/image) UI — backend doesn't accept multimodal
- `ArtifactProvider` + artifact panel — backend doesn't emit artifacts
- Branch switcher (alternative response trees)
- agent-inbox interrupt UI — backend doesn't currently use `interrupt()`. If it does, this needs to be rebuilt on top of the Logos shell.
- The hide-tool-calls toggle — ThinkingTrace is always present and individually collapsible.

If any of those become required, add them on top of `LogosShell` in a focused plan rather than re-importing the old Thread tree.
