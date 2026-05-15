# apps/frontend — patristic chat UI

Next.js 15 chat UI (React 19) for the patristic chat agent. Fork of `langchain-ai/agent-chat-ui`. Streams from a running LangGraph Server via `@langchain/langgraph-sdk`. Chat history is **client-side localStorage** — no `/threads` list endpoint on the backend.

Upstream structure preserved: `src/app/`, `src/components/thread/`, `src/components/ui/`, `src/components/icons/`, `src/components/thread/agent-inbox/`. Keep diffs against those minimal so upstream merges stay sane. Patristic-specific additions live in `src/components/citation-card.tsx`, `src/components/library/`, `src/components/thread/welcome.tsx`, and the localStorage thread store in `src/providers/Thread.tsx` + `src/lib/local-thread-store.ts`.

## Custom code (paths verified)

- `src/components/citation-card.tsx` — `CitationCard` renders `read_passage` tool results. **Currently handles only the success shape** (`text`, `context_before`, `context_after`, `author`, `work_title`, `source_url`, `chapter_title`, `chapter_num`, `para_start`, `window_size`, `citation`). Failure payloads like `{found: false, error, work_exists, citation}` do NOT match `looksLikeReadPassage` in `src/components/thread/messages/tool-calls.tsx` (it requires `text: string`), so they fall through to the generic JSON tool-result renderer rather than crashing — but the UX is raw JSON. Open item: add a fail-case render branch.
- `src/components/thread/messages/tool-calls.tsx` — `ToolResult` dispatches `read_passage` to `CitationCard`. The `looksLikeReadPassage` guard (lines ~69–79) is the type narrowing gate.
- `src/components/library/LibraryBrowser.tsx` — Radix `Dialog` with author tree + client-side search over `name`, `work.title`, `work.topics`. Per-work buttons: speech-bubble `MessageSquare` → `onAskAboutWork(author.name, work.title)`, external `ExternalLink` → `work.source_url` (azbyka). Auto-expands matching authors while searching.
- `src/components/library/use-catalog.ts` — fetches `${NEXT_PUBLIC_CATALOG_API_URL || "http://localhost:8001"}/catalog`. Caches in `sessionStorage` under `patristic:catalog` for 1h. Types: `Catalog`, `CatalogAuthor`, `CatalogWork`. Response shape produced by `apps/backend/src/backend/catalog.py` → `{authors: [{slug, name, years, century, global_section, works: [{slug, title, creation_date, section, source_url, topics, paragraph_count}]}]}`.
- `src/components/thread/welcome.tsx` — `PatristicWelcome` with 4 hardcoded Russian example chips in the `EXAMPLES` const. Rendered by `src/components/thread/index.tsx` (line ~444) when there are no messages. Chip click calls `submitText`.
- `src/providers/Stream.tsx` — wraps `useStream` from `@langchain/langgraph-sdk/react`. Sets `throttle: 50` to batch SSE notify calls (without it, every token re-renders the subtree). Also `fetchStateHistory: { limit: 25 }`. Persists every message change to localStorage via `useThreadStore().saveCurrent`. Pings `${apiUrl}/info` on mount; on failure shows a sonner toast pointing at the configured URL. **No manual `requestAnimationFrame` or `useDeferredValue` is present** — perf comes solely from the SDK's built-in `throttle`.
- `src/providers/Thread.tsx` + `src/lib/local-thread-store.ts` — localStorage thread store, sorted by `updatedAt` desc, cross-tab sync via the `storage` window event (filters keys starting with `patristic:threads`). `useThreads` exposes the SDK-shaped list; `useThreadStore` exposes `saveCurrent` / `removeThread` / `refresh`. `deriveTitle(messages)` produces the sidebar label.

## Environment

`.env.local` (auto-loaded by Next.js). Only `NEXT_PUBLIC_*` vars reach the browser. Current `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:2024
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_ASSISTANT_ID=agent
NEXT_PUBLIC_CATALOG_API_URL=http://localhost:8001
NEXT_PUBLIC_AUTH_SCHEME=
```

`StreamProvider` reads `NEXT_PUBLIC_API_URL || NEXT_PUBLIC_LANGGRAPH_API_URL` (in that order), defaulting to `http://localhost:2024`. Assistant id defaults to `agent`. **Verify the langgraph dev port** — it cycles when an old port hangs in `TIME_WAIT`.

**Catalog URL mismatch (real, present-tense):** `.env.local` has the catalog on `:8001`, but `apps/backend/langgraph.json` mounts `backend.catalog:app` via `"http": { "app": "backend.catalog:app" }`, meaning the catalog is served on the same port as `langgraph dev` (2024). So `:8001` works only if someone is also running the FastAPI app standalone there. Pick one and align both `apps/frontend/.env.local` and the repo-root `.env` (which has `NEXT_PUBLIC_CATALOG_API_URL=http://localhost:8001`).

Smoke-checks against a running `langgraph dev`:
```
curl http://localhost:2024/info       # langgraph status (used by Stream.tsx)
curl http://localhost:2024/catalog    # FastAPI catalog mount
curl http://localhost:2024/health     # catalog FastAPI health (not /ok)
```

## Running locally

```
cd apps/frontend
npm install        # both package-lock.json and pnpm-lock.yaml are committed; npm wins for upstream parity
npm run dev        # localhost:3000
```

Prereqs: `langgraph dev` running at the configured URL, Postgres up (catalog hits the `authors` + `works` tables).

Production build:
```
npm run build      # last green at commit 8d6087e per STATUS.md
```

## Gotchas

- **Two lockfiles committed** (`package-lock.json` AND `pnpm-lock.yaml`). Pick one before committing changes that touch deps. `package.json` declares `"packageManager": "pnpm@10.5.1"` but the rest of the repo and STATUS use npm.
- Clearing browser storage drops all chat history. `langgraph dev` is in-memory too, so there's no recovery in dev.
- `LibraryBrowser` filter is pure client-side over the full catalog (`a.name`, `w.title`, `w.topics`). Fine at current scale; reconsider past ~10K works.
- TS strict mode is on. Run `npm run lint:fix` and `npm run format` before committing.
- The `CitationCard` interface does NOT have a `found` field; `looksLikeReadPassage` keys on `text` + `para_start` + `window_size` + presence of `author` and `work_title`. Backend changes to the `read_passage` return shape must keep those fields (or update both files in lockstep).

## Not done / situational

- No manual UI walkthrough verified in this session (Task 38). Submit a query, click a `CitationCard`, open Library, click the speech-bubble chip — each path still wants eyes.
- Frontend hasn't been touched since 8d6087e. After backend tool-output shape changes (citations, `read_passage`, catalog endpoint), re-run `npm run build` before claiming green.
- Failure-case render for `read_passage` is the known open item — see `citation-card.tsx` + `looksLikeReadPassage` above.
