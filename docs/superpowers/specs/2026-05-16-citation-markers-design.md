# Citation markers + scroll-anchored panel + passage modal — design

**Date:** 2026-05-16
**Scope:** `apps/backend/src/backend/prompts.py` (one rule) + `apps/frontend/src/components/logos/**` and `apps/frontend/src/lib/**` (markdown / panel / modal)
**Status:** Approved by user, pending implementation plan

## Motivation

Currently `CitationsList` ([CitationsList.tsx:275](apps/frontend/src/components/logos/CitationsList.tsx:275)) renders one row per `read_passage` tool call, using `read_passage.text` (the full paragraph window — often hundreds of words) as the citation body. This produces a wall of source prose under every answer, regardless of what the agent actually argued for.

The fix the designer originally wanted:

- The agent's answer carries inline `[1]`-style markers.
- The marker is positioned next to the specific claim it supports.
- Below the answer, a panel lists each marker with a **short verbatim key quote** (1-2 lines) plus auto-derived metadata (author, work, chapter/§, azbyka URL).
- Hover on `[1]` highlights the panel row; click on `[1]` smooth-scrolls to it.
- Inside the row a button opens a modal showing the **full** paragraph with the short quote highlighted.

This spec defines the markup the agent emits, the parsing layer, the rewritten panel, the modal, and the hover/scroll interaction.

## Decisions (locked)

- **Quote source:** agent picks it (inline in answer markup), not auto-extracted.
- **Marker syntax:** `[[<citation_slug>|«<short verbatim quote>»]]` inline. Custom remark plugin parses it. No clash with standard markdown link syntax `[text](url)`.
- **Auto-derived rich data:** author / work / chapter / §-ref / source URL come from the matched `read_passage` tool call, not from the agent.
- **Click marker:** smooth-scroll to citation row in the panel (not modal).
- **Modal:** opened by a button **inside** the panel row ("ПОЛНЫЙ ПАРАГРАФ"). Shows the full `read_passage.text` with `«quote»` highlighted via `<mark>`. Also shows `context_before` / `context_after` if present.
- **Hover bidirectional:** marker ↔ panel row, both directions, per-turn scoped (no cross-turn leaking).
- **Old answers (without new markup):** panel stays empty. Intentional breaking change — no migration. Threads in localStorage from before this change just won't render a citation panel.

## Architecture

### Inline data flow

```
Agent writes markdown:
  Текст ... [[<slug>|«<quote>»]] ... текст.

Frontend pipeline (per turn, in AssistantTurn):
  1. answerText (string from turn.answerText)
       │
       ▼
  2. extractMarkers(answerText) → CitationMarker[] = [{n, slug, quote}, ...]
       │       (regex pass; same regex as the remark plugin uses)
       │
       ▼
  3. CitationsList({markers, toolCalls})
       │       each marker → row, slug → toolCalls.find().jsonResult → rich data
       │
       ▼
  4. <MarkdownText remarkPlugins={[remarkCitation, ...]}>
       │       inline [[...|«...»]] replaced with <CitationPill n={N}/>
       │
       ▼
  5. <CitationProvider value={{hoveredN, setHoveredN, scrollToN}}>
            wraps both <MarkdownText> and <CitationsList>
```

Numbering: N is the **1-based index of the marker in answerText, in order of appearance**. The same numbering is used in `extractMarkers` and the remark plugin (both walk the string left-to-right with the same regex).

Streaming: while answerText is mid-stream and ends with `[[slug|«сп`, the regex won't match — the unmatched prefix renders as plain text. As soon as `]]` arrives in the next chunk and React re-renders, the regex matches and the inline replacement happens.

### Marker syntax

```
[[<citation_slug>|«<short verbatim quote>»]]
```

Regex (capture groups: slug, quote):

```
\[\[([^|\]]+)\|«([^»]+)»\]\]
```

- `slug` MUST match the citation_slug shape `author/work/NNNN/pX(-Y)?` — exact value the agent passed to `read_passage`.
- `quote` MUST be a verbatim substring of `read_passage.text` for that slug. The modal does `text.indexOf(quote)` to highlight; if `-1`, soft-fall back to text without `<mark>`.

The plugin / extractor:

- Only matches inside text MDAST nodes. Code spans, code blocks, image alts, link hrefs are untouched.
- Half-tokens (no closing `]]`) are ignored (left as plain text).
- Malformed tokens (e.g., `[[slug]]` without `|«q»`) — also ignored, left as plain text. No error.

### Numbering invariant

There is exactly one source of truth for N: the **order of marker appearance in answerText**.

Both `extractMarkers` (used by CitationsList) and the remark plugin walk the same text with the same regex, so the N each assigns to a marker is identical. Implementation MUST share the regex constant between them (one module export).

## Components

### Created

#### `apps/frontend/src/lib/remark-citation.ts`

Pure unified/remark plugin. Walks MDAST `text` nodes, applies the marker regex, splits each matched text node into a sequence of `text` + `citationMarker` children. The `citationMarker` node has `data: { hName: "citation-marker", hProperties: { slug, quote, n } }` so react-markdown can dispatch it to a custom component.

Exports the **canonical regex** as a named export `CITATION_MARKER_RE` so `extractMarkers` reuses it.

#### `apps/frontend/src/lib/__tests__/remark-citation.test.ts`

Vitest cases:

1. Single marker → one citationMarker node, surrounding text preserved.
2. Multiple markers in one paragraph → correct N numbering.
3. Marker inside code span / fenced code block → **not** matched (stays as literal `[[...]]`).
4. Half-token `[[slug|«сп` (no closing) → not matched, plain text.
5. Malformed `[[slug|qwerty]]` (no `«»`) → not matched.
6. Marker with unicode quote characters at boundaries → matched correctly.

#### `apps/frontend/src/components/logos/CitationPill.tsx`

Small component:

```tsx
<CitationPill n={N} slug={slug} quote={quote} />
```

Reads `useCitationContext()` to get `setHoveredN` and `scrollToN`. Renders an inline `<sup>` with `[N]` (mono, tabular-nums, ~11px), `data-citation-n={N}`. Hover sets hoveredN; click calls scrollToN(N).

#### `apps/frontend/src/components/logos/PassageModal.tsx`

Radix Dialog wrapper. Props:

```ts
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passage: ReadPassageSuccess;
  highlightQuote: string | null;
}
```

Layout (described in spec section 4 of the brainstorm: header with author · work, ref line, optional context_before, text with highlighted quote, optional context_after, azbyka link).

Highlight: `text.split(highlightQuote)` → join with `<mark>quote</mark>`. If `text.indexOf(highlightQuote) < 0`, render text plain.

#### `apps/frontend/src/components/logos/CitationContext.tsx`

```ts
interface CitationContextValue {
  hoveredN: number | null;
  setHoveredN: (n: number | null) => void;
  scrollToN: (n: number) => void;
  turnKey: string;  // for unique row IDs across turns
}
```

`scrollToN(n)` does `document.getElementById(`${turnKey}-cite-${n}`)?.scrollIntoView({behavior: "smooth", block: "center"})` and adds a transient `data-flash="true"` attribute (removed after 800ms) so the row plays the `citation-flash` animation.

Provider scope: one provider per `AssistantTurn`. `turnKey` is the turn's stable key from `turns.ts`. Two simultaneously-rendered turns get independent hover/scroll state and namespaced row IDs.

### Modified

#### `apps/frontend/src/components/logos/CitationsList.tsx`

New signature:

```ts
interface Props {
  markers: CitationMarker[];   // from turn
  toolCalls: DesignToolCall[];  // for rich-data lookup
}
```

For each marker:

- Find `tc` where `tc.name === "read_passage" && tc.args.citation === marker.slug && tc.jsonResult?.found === true`.
- If found → `<CitationRowSuccess>` with the marker's quote + tc.jsonResult's rich data.
- If found with `{found: false}` → `<CitationRowError>` (existing) with `tc.jsonResult.error`.
- If no matching tc at all → `<CitationRowError>` synthesized: `{found: false, error: "no read_passage call for this slug", citation: marker.slug}`.

`<CitationRowSuccess>` rewritten:

- Three columns same as today (32px / 1fr / 220px).
- Quote column: `«{marker.quote}»` (italic Garamond, prominent) + author/work line under it + **button "ПОЛНЫЙ ПАРАГРАФ"** (replaces existing context_before/after toggle).
- Right column: chapter/§ ref + azbyka link (unchanged).
- Wrapper has `id={`${turnKey}-cite-${n}`}` and reads `useCitationContext()` to apply `data-active={hoveredN === n}` styling.
- Button click → local state `setPassageModalOpen(true)` → renders `<PassageModal>`.

The old `looksLikeReadPassage` fallback in `CitationsList` is **removed**. New code matches by `tc.name === "read_passage"` only — the shape-check fallback was for tool-rename safety; we don't need it once markers are the authoritative source.

#### `apps/frontend/src/components/logos/markdown/markdown-text.tsx`

Add `remarkCitation` to the `remarkPlugins` array. Map the custom node to a component.

react-markdown's `components` prop maps HTML element names. Two valid paths:

1. **Custom tag name** (`hName: "citation-marker"` in the plugin): supported in react-markdown 9+; pass `components={{ "citation-marker": CitationPill, ... }}`. If the version in use rejects unknown tag names, fall back to (2).
2. **Span with marker class** (`hName: "span"`, `hProperties: {"data-citation": "true", "data-n": n, ...}`): map `span` to a renderer that checks `data-citation` and either renders `<CitationPill>` or passes through.

Implementer picks one in plan Step 1; both produce identical user-visible output. Default to (1); fall back to (2) only if (1) breaks at runtime.

#### `apps/frontend/src/components/logos/AssistantTurn.tsx`

- Computes `markers = extractMarkers(turn.answerText)` (memoized on answerText).
- Wraps content with `<CitationProvider turnKey={turn.key}>`.
- Passes `markers` (not just toolCalls) into `<CitationsList>`.
- `<MarkdownText>` receives the answer text as-is — remark plugin handles inline pill substitution.

#### `apps/frontend/src/components/logos/turns.ts`

Add helper:

```ts
export interface CitationMarker {
  n: number;       // 1-based, by order of appearance
  slug: string;
  quote: string;
}

export function extractMarkers(answerText: string): CitationMarker[] { /* uses CITATION_MARKER_RE */ }
```

`DesignTurn` shape unchanged (markers derived from `answerText` on demand in `AssistantTurn`; we keep `turns.ts` pure and don't bloat the turn object).

#### `apps/frontend/src/components/logos/logos.css`

Add:

- `.citation-pill` — base style (mono, cream, no underline; hover underline)
- `.citation-pill[data-active="true"]` — focus state
- `.citation-row[data-active="true"]` — `box-shadow: inset 2px 0 0 #ece6d6`, slightly brighter bg
- `@keyframes citation-flash` — 800ms bg flash + fade
- `.citation-row[data-flash="true"]` — applies the animation once
- `.logos-passage-modal-overlay` / `.logos-passage-modal-content` — Radix Dialog overlay + card, mirrors `.logos-library-*`
- `.logos-passage-modal-content mark` — highlight color (`rgba(236,230,214,0.18)`, no text color change)

#### `apps/frontend/src/components/logos/i18n.ts`

Add two strings (RU/EN):

```ts
citation: {
  ...existing,
  showPassage: "Полный параграф" / "Full paragraph",
  highlightNotFound: "(цитата не найдена в параграфе дословно)" / "(quote not found verbatim in paragraph)",
}
```

Modal header text is composed from `read_passage` data directly (`{author} · {work_title}`); no separate localized title needed.

#### `apps/backend/src/backend/prompts.py`

Replace rule #4 in `MAIN_AGENT_PROMPT` with the marker-syntax rule. Add rule #5 about absence of markers being a red flag for unsourced claims.

Verbatim new rule text:

> 4. **Маркируй каждую цитату спецсинтаксисом:** в месте, где ты ссылаешься на источник, ставь
>
> `[[<citation_slug>|«<короткая ключевая фраза>»]]`
>
> где:
> - `<citation_slug>` — точный slug из `read_passage`-вызова (буква-в-букву, как в правиле 2);
> - `«<короткая фраза>»` — verbatim подстрока из `read_passage.text`, **не более одного предложения / 25 слов**. Это фраза, которая поддерживает твоё утверждение и которую читатель увидит в панели цитат под ответом.
>
> Пример (slug ниже сокращён троеточием только для читаемости — в реальном промпте полный без сокращений):
>
> `Святитель Тихон вёл аскетичный образ жизни [[sokolov_tihon_zadonskij_svjatitel/.../0217/p42|«спал на соломе, накрывшись овчинным тулупом»]] — простота быта была частью его учения.`
>
> Никаких «{Автор}, {Труд}, гл. N, §para» **в самом тексте** — фронтенд достанет автора/труд/главу/azbyka-URL из `read_passage` автоматически. В тексте — только твоя проза + спецмаркеры.
>
> **Важно:** короткая фраза в `«»` обязана быть **дословной подстрокой** ответа `read_passage`. Не перефразируй.
>
> 5. Если в твоём ответе нет ни одного `[[...|«...»]]` — это значит ты не сослался ни на один источник. Это приемлемо для negative-вопросов и общих рассуждений, но для адресных и тематических — почти всегда означает, что ты ответил «по памяти». Перепроверь себя.

`SEARCH_AGENT_PROMPT` is unchanged.

### Not touched

- `apps/frontend/src/lib/useStatelessStream.ts`
- `apps/frontend/src/providers/{Stream,Thread}.tsx`
- `apps/frontend/src/lib/chat-history-slice.ts`
- `apps/frontend/src/lib/local-thread-store.ts`
- `apps/frontend/src/components/logos/ThinkingTrace.tsx` (still consumes `toolCalls`, unchanged)
- `apps/backend/src/backend/tools/read_passage.py` (no new params)
- `apps/backend/src/backend/graph.py`

## Edge cases

| Case | Behavior |
|---|---|
| Marker slug doesn't match any read_passage call | `CitationRowError` with "no read_passage for this slug". Pill in text still renders. |
| read_passage called but no marker | Not shown in panel (panel = what was cited, not what was read). |
| Two markers with the same slug, different quotes | Two panel rows, same author/work/§, different quotes. |
| Mid-stream half-token `[[slug|«сп` | Not matched; renders as literal text until `]]` arrives. |
| Quote not a verbatim substring of `text` | Panel row OK (uses marker.quote). Modal shows text without `<mark>`. Optional UI hint: `s.citation.highlightNotFound`. |
| read_passage with `found: false` | Existing `CitationRowError` shape (uses `error`, `work_exists?` fields). |
| Old threads without markers in localStorage | Empty citation panel. No migration. |
| Regenerate / edit | Sliced messages submit → new answer with new markers → new N numbering. No state leak. |
| Marker inside code span | Not matched (regex runs only on MDAST text nodes — code spans are separate node type). |
| Two simultaneously-rendered turns each with `[1]`, `[2]`, ... | Independent: turnKey prefix in row IDs and in CitationProvider scope. |

## Testing

### Unit (vitest)

- `remark-citation.test.ts` — 6 cases listed above.
- (optional) `extractMarkers.test.ts` — same cases mirrored, since it shares the regex.

### Manual SMOKE (one pass post-implementation)

1. Submit a fresh question that should trigger 2-3 `read_passage` calls.
2. Verify each `[N]` pill renders inline at the agent's chosen position.
3. Hover `[1]` → row 1 in panel gets the active outline. Move to `[2]` → row 2.
4. Click `[1]` → smooth scroll to row 1 + flash animation.
5. Click "ПОЛНЫЙ ПАРАГРАФ" → modal opens with full text + `<mark>`-highlighted quote.
6. Esc closes modal.
7. Reload page → markers persist in answer (from localStorage), panel re-derives correctly.
8. Edit human → new answer streams with new markers → old panel disappears, new panel builds.
9. Stop mid-stream while a `[[...` is half-emitted → no crash; text shows literal until next chunk.
10. Old thread from before this change → answer renders plain, panel empty.

### Backend goldset

`tests/eval/gold.yaml` thresholds (addressed ≥80%, thematic ≥60%, cross ≥70%, negative =100%) are based on _answers_, not on marker presence. The new prompt may slightly affect answer quality. Re-run goldset manually after prompt change; bug-fix if any category drops below threshold.

## YAGNI / not in scope

- Migration of old localStorage threads.
- Branch-switcher between alternative agent citations.
- Editable quotes (user can't override agent's choice).
- Cross-turn marker navigation (marker in turn A doesn't reveal panel in turn B).
- Search inside panel.
- Export citations (.bib / .ris).
- A way for the agent to mark text without citing (no decorative `[N]`-only).

## Open questions

None.
