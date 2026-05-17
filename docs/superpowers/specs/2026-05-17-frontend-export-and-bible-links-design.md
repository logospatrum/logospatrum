# Frontend export + Bible links + favicon — design

**Date:** 2026-05-17
**Scope:** `apps/frontend/`. No backend changes.

## Goals

1. Export a chat to a self-contained Markdown file (sidebar per-thread + in-chat).
2. Render Scripture citations correctly in the citation panel (use `Мф 1:2`, not `гл. 1 · §2`).
3. Build clickable azbyka.ru/biblia links for Scripture rows that currently have `source_url=NULL`.
4. Replace the default Next.js favicon with a themed Λ glyph.

## Non-goals

- Backend changes (Bible `source_url` stays NULL — frontend builds the URL).
- Exporting `ThinkingTrace` / tool-call details.
- Branching or fork-aware exports — the export is a flat human→assistant transcript of `stream.messages` (or `StoredThread.messages` for non-active threads).

## Architecture

### A. `src/lib/bible-books.ts` (new)

Static module with:

```ts
export interface BibleBook {
  /** azbyka.ru/biblia/?<code>.X:Y query code, e.g. "Mt" */
  azbykaCode: string;
  /** Short Russian display, e.g. "Мф" */
  ruShort: string;
  /** Short English display, e.g. "Mt" */
  enShort: string;
}

/** Lookup table: work_slug (db) → BibleBook. */
export const BIBLE_BOOKS: Record<string, BibleBook>;

/** Returns null if the slug is not a Bible work. */
export function bibleBookFor(workSlug: string): BibleBook | null;

/** Builds azbyka URL for a Bible reference range.
 *  Returns null for non-Bible slugs. */
export function bibleAzbykaUrl(
  workSlug: string,
  chapter: number,
  paraStart: number,
  windowSize: number,
): string | null;

/** Short ref like "Мф 1:2" or "Мф 1:2–4". `lang` chooses ru/en. */
export function bibleShortRef(
  workSlug: string,
  lang: "ru" | "en",
  chapter: number,
  paraStart: number,
  windowSize: number,
): string | null;
```

The map covers all 77 `bible_*` slugs currently in the DB. New canonicals (Tolkovanie-named slugs like `bible_tolkovanie_na_1_ju_knigu_makkavejskuju`) map to `1Mac/2Mac/3Mac` codes.

Format choice: range uses an en-dash `–`, single verse uses just `:N`. Matches typical Russian biblical citation typography (e.g. `Мф 1:2–4`).

### B. Citation list fix (`CitationsList.tsx`)

`chapterLabel`/`paraLabel` are replaced (for Bible rows only) by:

```ts
const bibleRef = bibleShortRef(work_slug_from_citation, lang, chapter_num, para_start, window_size);
const ref = bibleRef ?? [chapterLabel(rich), paraLabel(rich)].filter(Boolean).join(" · ");
```

The `work_slug_from_citation` is parsed from `rich.citation` (the canonical citation string). For Scripture, `chapter_title` and `chapter_num` from `read_passage` are noise — we ignore them.

For the azbyka link in the right column: if `rich.source_url` is null but `bibleAzbykaUrl(slug, ...)` returns a URL, use it. Existing patristic rows still use `rich.source_url`.

The middle column ("author · work_title") stays unchanged — for Bible the work title is the full book name (e.g. "Евангелие от Матфея"), which is informative.

### C. `src/lib/export-markdown.ts` (new)

Pure functions, no React, vitest-coverable.

```ts
export function messagesToMarkdown(
  messages: Message[],
  opts: { lang: "ru" | "en"; title?: string },
): string;

export function downloadMarkdown(filename: string, content: string): void;
```

Algorithm for `messagesToMarkdown`:

1. Group with the existing `groupMessagesIntoTurns(messages, false)`. **Drop `toolCalls` entirely** (don't read or render them).
2. Use a per-turn marker counter, resetting at every turn (so `[1]` starts fresh per assistant message — matches the in-UI panel behavior).
3. For each turn, emit:
   ```markdown
   ## Вопрос
   <human text>

   ## Ответ
   <answerText with [[slug|«q»]] replaced by [N]>

   **Цитаты:**

   1. *«quote»* — Автор. Труд (ref). [azbyka](url)
   2. *«quote»* — Мф 1:2. [azbyka](url)
   3. *«quote»* — `slug-as-given` _(цитата не найдена)_
   ```
4. Document header:
   ```markdown
   # <title or derived title>

   _Экспорт: <YYYY-MM-DD HH:mm> · ΛΟΓΟΣ_

   ---
   ```
5. EN labels: `## Question` / `## Answer` / `**Citations:**` / `_Exported: …_` / `_(citation not found)_`.

The match between marker (slug-only) and tool-call result re-uses the same logic that lives in `CitationsList.buildRows`. To avoid duplicating that logic, the export pulls `toolCalls` from `turn` for the join step only — we use `turn.toolCalls` to look up `read_passage` metadata, but we **do not render** the tool-call list in the output. This keeps the contract "no tool calls in export" while still being able to attach rich metadata to citations.

Filename builder: `logos-<slug>-<YYYY-MM-DD>.md` where `<slug>` is the title lowercased, transliterated to ASCII (best-effort for Cyrillic via a small inline map), `[^a-z0-9]+` collapsed to `-`, trimmed, capped at 40 chars.

### D. UI buttons

**In-chat (`AssistantTurn.tsx`):**

The existing flex-end pill row gets a second pill `Экспорт` next to `Перегенерировать`. Same visual treatment (border, mono uppercase, hover lift). Only shown on the last non-streaming turn (same gate as Regenerate). Calls a new prop `onExport: () => void` wired from `LogosShell` → builds md from `stream.messages` and triggers download.

**Sidebar (`Sidebar.tsx`):**

Each thread row becomes a 2-column grid: title (truncated) + tiny ⬇ button on the right. Opacity 0 → 1 on hover of the row. Click stops propagation (does not select the thread) and calls `onExport(threadId)` from `LogosShell`. `LogosShell` reads `loadThreads()` to get the messages of any thread (the active thread also lives there, persisted by `Stream.tsx`).

### E. i18n additions

Added keys in `STRINGS.{ru,en}`:

```
chat.export, chat.exportAria
sidebar.exportAria
export.question, export.answer, export.citations
export.notFound, export.exportedAt
```

### F. Favicon

Create `src/app/icon.svg` (Next.js 15 metadata file convention; auto-served as `/icon` and registered in `<head>`). 32x32 viewBox, a Λ in `palette.accent` (`#C8A86B`-ish) centered on `palette.bg` (`#0B0A09`-ish, near-black). Slight 1px stroke matching the brand pairing.

Delete the default `src/app/favicon.ico` so Next.js picks up `icon.svg` exclusively (otherwise the .ico wins for the legacy `/favicon.ico` slot).

## Data flow

```
Sidebar row click → LogosShell.onExportThread(id)
                  → loadThreads().find(id) → messages
                  → messagesToMarkdown(messages, {lang, title})
                  → downloadMarkdown(filename, md)

AssistantTurn pill click → LogosShell.handleExport()
                         → messagesToMarkdown(stream.messages, {lang})
                         → downloadMarkdown(filename, md)
```

Both paths share the same `messagesToMarkdown` impl.

## Edge cases

- **Streaming turn:** in-chat export is hidden until the stream finishes (`!turn.inProgress`). Sidebar export of the *active* thread while streaming is allowed and includes whatever has streamed so far (the user opted in by clicking).
- **No assistant answer / human-only:** still emit the `## Вопрос` block, no `## Ответ`.
- **Marker without matching `read_passage`:** emit row 3 above with `_(цитата не найдена)_` and the raw slug — same diagnostic spirit as `CitationRowError`.
- **`turn.toolCalls` empty (no tools ran):** answer prints as-is; if it has no markers, the `**Цитаты:**` block is omitted entirely.
- **Empty `stream.messages`:** export pill never appears (no last turn).
- **Markdown injection:** human messages and tool quotes are kept as-is (they may contain markdown). This matches what the UI already renders — users export what they see. No escaping.
- **NBSP in i18n labels:** keep as-is; markdown renders them fine.

## Tests

`apps/frontend/src/lib/__tests__/`:

- `bible-books.test.ts` — `bibleBookFor` for {Mt, Lk, James, 1Cor, Genesis, Maccabees-tolkovanie, non-Bible slug}; `bibleAzbykaUrl` for single + range; `bibleShortRef` for ru + en, single + range.
- `export-markdown.test.ts` — golden test on a synthetic 2-turn conversation containing: one patristic citation, one Bible citation, one error-citation. Validates header, marker → `[N]` substitution, `**Цитаты:**` section ordering, en-dash range formatting, en/ru variant.

No new component tests — UI wiring is mechanical and exercised by the SMOKE.md manual pass.

## Risks

- **`groupMessagesIntoTurns` is `"use client"`-only** (imports `parsePartialJson`). The export module imports it, so the export module is also client-side. Fine — both call sites are inside React components.
- **localStorage quota with embedded export blob:** the export creates an in-memory string, but Blob URL is revoked after `click()`. No persistent footprint.
- **Bible slug coverage:** the 77-entry map is hand-built from a DB snapshot. If a new Bible book gets ingested under a new slug, the lookup returns null and we fall back to the legacy `гл. X · §Y` label. A test enforces the current 77 are all mapped; new slugs will only need a single map entry.

## Out of scope (intentionally)

- Re-doing `CitationCard` (`src/components/citation-card.tsx`) — it's an unused legacy component per CLAUDE.md; the export goes through the Logos pipeline.
- Server-side Bible source_url backfill — keeps backend untouched.
- PDF / HTML export — markdown only.
