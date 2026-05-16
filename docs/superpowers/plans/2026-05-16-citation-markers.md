# Citation markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "dump full `read_passage.text` into the citation panel" UX with an agent-marked-up answer (inline `[[slug|«quote»]]`) that renders as `[N]` anchor pills bound to a panel of short agent-picked quotes plus a modal showing the full passage with the quote highlighted.

**Architecture:** Agent emits `[[slug|«quote»]]` inline in answers. The frontend pre-numbers markers (`numberMarkers`) so the per-block ReactMarkdown calls share a single 1-based N counter, then runs a remark plugin (`remarkCitation`) that turns markers into custom MDAST nodes mapped to `<CitationPill>`. A `<CitationProvider>` per `AssistantTurn` carries hover/scroll state; `<CitationsList>` consumes `markers` (from agent) + `toolCalls` (for rich data lookup by slug); a `<PassageModal>` opens from each row to show the full paragraph.

**Tech Stack:** TypeScript, React 19, Next.js 15 app router ("use client"), `react-markdown` 10 + `remark-gfm` + custom `remark-citation` (no new deps), `@radix-ui/react-dialog` 1.1.15, vitest + jsdom, FastAPI / LangGraph backend (prompt-only change).

**Spec:** [docs/superpowers/specs/2026-05-16-citation-markers-design.md](../specs/2026-05-16-citation-markers-design.md)

---

## File Structure

**Created:**

- `apps/frontend/src/lib/citation-marker.ts` — `CitationMarker` type, `AGENT_MARKER_RE` / `INTERNAL_MARKER_RE` regex constants, `extractMarkers(text)`, `numberMarkers(text)`.
- `apps/frontend/src/lib/__tests__/citation-marker.test.ts` — vitest cases for the two helpers.
- `apps/frontend/src/lib/remark-citation.ts` — unified plugin: replaces `[[#N|slug|«quote»]]` in MDAST text nodes with `citationMarker` nodes.
- `apps/frontend/src/lib/__tests__/remark-citation.test.ts` — vitest, MDAST-level transforms.
- `apps/frontend/src/components/logos/CitationContext.tsx` — `{hoveredN, setHoveredN, scrollToN, turnKey}` context + `<CitationProvider>` + `useCitationContext()` hook.
- `apps/frontend/src/components/logos/CitationPill.tsx` — inline `[N]` rendered by react-markdown for the `citationMarker` node.
- `apps/frontend/src/components/logos/PassageModal.tsx` — Radix Dialog with full passage + highlighted quote.

**Modified:**

- `apps/frontend/src/components/logos/CitationsList.tsx` — full rewrite of public shape (`markers` + `toolCalls` props), new `CitationRowSuccess`, drops `looksLikeReadPassage` fallback, modal trigger.
- `apps/frontend/src/components/logos/markdown/markdown-text.tsx` — add `remarkCitation` to plugin chain and map `"citation-marker"` element to `<CitationPill>`.
- `apps/frontend/src/components/logos/AssistantTurn.tsx` — compute markers via `extractMarkers`, pre-number the answer text via `numberMarkers` before passing to MarkdownText, wrap content in `<CitationProvider>`, hand markers to `<CitationsList>`.
- `apps/frontend/src/components/logos/logos.css` — `.citation-pill`, `.citation-row[data-active]`, `@keyframes citation-flash`, `.logos-passage-modal-*` rules.
- `apps/frontend/src/components/logos/i18n.ts` — two new keys (`showPassage`, `highlightNotFound`).
- `apps/backend/src/backend/prompts.py` — replace rule #4 in `MAIN_AGENT_PROMPT` with the marker-syntax rule and add new rule #5 about absence-of-markers.

**Not touched:**

- `apps/frontend/src/lib/useStatelessStream.ts`, `apps/frontend/src/lib/chat-history-slice.ts`, `apps/frontend/src/lib/local-thread-store.ts`, `apps/frontend/src/providers/{Stream,Thread}.tsx`
- `apps/frontend/src/components/logos/{ThinkingTrace,turns}.tsx` (turns.ts only re-exports through; it stays pure)
- `apps/frontend/src/components/citation-card.tsx` (type definitions reused as-is)
- `apps/backend/src/backend/tools/read_passage.py`, `apps/backend/src/backend/graph.py`, anywhere else in backend

---

### Task 1: Citation marker helpers — failing tests

**Files:**

- Create: `apps/frontend/src/lib/__tests__/citation-marker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/frontend/src/lib/__tests__/citation-marker.test.ts
import { describe, it, expect } from "vitest";
import { extractMarkers, numberMarkers } from "../citation-marker";

describe("extractMarkers", () => {
  it("returns empty for plain text", () => {
    expect(extractMarkers("hello world")).toEqual([]);
  });

  it("extracts single marker with 1-based n", () => {
    expect(extractMarkers("hello [[a/b/0001/p1|«spal»]] world")).toEqual([
      { n: 1, slug: "a/b/0001/p1", quote: "spal" },
    ]);
  });

  it("numbers multiple markers in order of appearance", () => {
    expect(
      extractMarkers("a [[x/y/0001/p1|«q1»]] b [[x/y/0002/p3|«q2»]] c"),
    ).toEqual([
      { n: 1, slug: "x/y/0001/p1", quote: "q1" },
      { n: 2, slug: "x/y/0002/p3", quote: "q2" },
    ]);
  });

  it("ignores half-tokens (no closing ]])", () => {
    expect(extractMarkers("text [[x/y/0001/p1|«сп")).toEqual([]);
  });

  it("ignores malformed (no «»)", () => {
    expect(extractMarkers("text [[x/y/0001/p1|noQuote]] more")).toEqual([]);
  });
});

describe("numberMarkers", () => {
  it("rewrites single agent marker to internal form", () => {
    expect(numberMarkers("hello [[a/b/0001/p1|«q»]] world")).toBe(
      "hello [[#1|a/b/0001/p1|«q»]] world",
    );
  });

  it("numbers multiple markers in order", () => {
    expect(
      numberMarkers("a [[x/y/0001/p1|«q1»]] b [[x/y/0002/p3|«q2»]] c"),
    ).toBe("a [[#1|x/y/0001/p1|«q1»]] b [[#2|x/y/0002/p3|«q2»]] c");
  });

  it("leaves plain text untouched", () => {
    expect(numberMarkers("hello world")).toBe("hello world");
  });

  it("leaves half-tokens untouched", () => {
    expect(numberMarkers("text [[x/y/0001/p1|«сп")).toBe(
      "text [[x/y/0001/p1|«сп",
    );
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/frontend && npm test -- citation-marker`
Expected: FAIL — `Cannot find module '../citation-marker'`.

---

### Task 2: Citation marker helpers — implementation

**Files:**

- Create: `apps/frontend/src/lib/citation-marker.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// apps/frontend/src/lib/citation-marker.ts

export interface CitationMarker {
  n: number;
  slug: string;
  quote: string;
}

/**
 * What the agent emits inline. The pipe and «»-pair are required.
 * Used by extractMarkers and numberMarkers.
 */
export const AGENT_MARKER_RE = /\[\[([^|\]]+)\|«([^»]+)»\]\]/g;

/**
 * Internal form produced by numberMarkers. The remark plugin parses this in
 * MDAST text nodes after pre-numbering. The `#N` prefix lets the plugin emit
 * stable N values even when MarkdownText splits the answer into per-block
 * ReactMarkdown calls.
 */
export const INTERNAL_MARKER_RE =
  /\[\[#(\d+)\|([^|\]]+)\|«([^»]+)»\]\]/g;

/**
 * Walk text left-to-right, return one marker per [[slug|«quote»]] in order.
 * N is 1-based by order of appearance.
 */
export function extractMarkers(answerText: string): CitationMarker[] {
  const re = new RegExp(AGENT_MARKER_RE.source, "g");
  const out: CitationMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answerText)) !== null) {
    out.push({ n: out.length + 1, slug: m[1], quote: m[2] });
  }
  return out;
}

/**
 * Rewrite [[slug|«quote»]] to [[#N|slug|«quote»]] threading the same N as
 * extractMarkers. Pre-numbering is needed because MarkdownText calls
 * ReactMarkdown once per markdown block (see splitMarkdownBlocks) and the
 * remark plugin's counter would reset per call without this.
 */
export function numberMarkers(answerText: string): string {
  let n = 0;
  return answerText.replace(AGENT_MARKER_RE, (_match, slug, quote) => {
    n += 1;
    return `[[#${n}|${slug}|«${quote}»]]`;
  });
}
```

- [ ] **Step 2: Verify tests pass**

Run: `cd apps/frontend && npm test -- citation-marker`
Expected: PASS — all 9 cases green.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/citation-marker.ts apps/frontend/src/lib/__tests__/citation-marker.test.ts
git commit -m "feat(frontend): add citation marker extract + pre-numbering helpers"
```

---

### Task 3: remarkCitation plugin — failing tests

**Files:**

- Create: `apps/frontend/src/lib/__tests__/remark-citation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/frontend/src/lib/__tests__/remark-citation.test.ts
import { describe, it, expect } from "vitest";
import type { Root, Paragraph } from "mdast";
import { remarkCitation } from "../remark-citation";

function transform(tree: Root): Root {
  // unified plugins return a transformer function; call it directly.
  const transformer = (remarkCitation as unknown as () => (t: Root) => void)();
  transformer(tree);
  return tree;
}

function paragraphTree(text: string): Root {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", value: text }],
      } as Paragraph,
    ],
  };
}

describe("remarkCitation", () => {
  it("replaces single marker with citationMarker node", () => {
    const t = paragraphTree("hello [[#1|a/b/0001/p1|«q»]] world");
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toEqual([
      { type: "text", value: "hello " },
      {
        type: "citationMarker",
        data: {
          hName: "citation-marker",
          hProperties: { n: "1", slug: "a/b/0001/p1", quote: "q" },
        },
      },
      { type: "text", value: " world" },
    ]);
  });

  it("handles multiple markers with N from the literal", () => {
    const t = paragraphTree(
      "a [[#1|s1/w1/0001/p1|«q1»]] b [[#2|s2/w2/0002/p2|«q2»]] c",
    );
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toHaveLength(5);
    type CM = { data: { hProperties: { n: string } } };
    expect((para.children[1] as unknown as CM).data.hProperties.n).toBe("1");
    expect((para.children[3] as unknown as CM).data.hProperties.n).toBe("2");
  });

  it("does not match the agent form (must be pre-numbered)", () => {
    const t = paragraphTree("a [[s1/w1/0001/p1|«q1»]] b");
    transform(t);
    const para = t.children[0] as Paragraph;
    expect(para.children).toEqual([
      { type: "text", value: "a [[s1/w1/0001/p1|«q1»]] b" },
    ]);
  });

  it("does not descend into code blocks (no children)", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "code",
          lang: null,
          meta: null,
          value: "[[#1|x/y/0001/p1|«q»]]",
        } as unknown as Root["children"][number],
      ],
    };
    transform(tree);
    type CodeNode = { value: string };
    expect((tree.children[0] as unknown as CodeNode).value).toBe(
      "[[#1|x/y/0001/p1|«q»]]",
    );
  });

  it("walks into nested children (e.g., emphasis)", () => {
    const t: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "emphasis",
              children: [
                { type: "text", value: "look [[#1|a/b/0001/p1|«q»]] here" },
              ],
            } as unknown as Paragraph["children"][number],
          ],
        } as Paragraph,
      ],
    };
    transform(t);
    type EmNode = { children: Array<{ type: string }> };
    const em = (t.children[0] as Paragraph).children[0] as unknown as EmNode;
    expect(em.children).toHaveLength(3);
    expect(em.children[1].type).toBe("citationMarker");
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd apps/frontend && npm test -- remark-citation`
Expected: FAIL — `Cannot find module '../remark-citation'`.

---

### Task 4: remarkCitation plugin — implementation

**Files:**

- Create: `apps/frontend/src/lib/remark-citation.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// apps/frontend/src/lib/remark-citation.ts
import type { Plugin } from "unified";
import type { Root, Parent, Text, RootContent } from "mdast";
import { INTERNAL_MARKER_RE } from "./citation-marker";

/**
 * MDAST plugin: replace [[#N|slug|«quote»]] in text nodes with a custom
 * `citationMarker` node that react-markdown maps to <CitationPill/>.
 *
 * Numbers in the marker are produced upstream by numberMarkers(answerText)
 * so plugin invocations across split blocks share a single N counter.
 *
 * Walks parent.children manually rather than via unist-util-visit to avoid
 * adding a direct dependency for one ~30-line traversal.
 */
export const remarkCitation: Plugin<[], Root> = () => {
  return (tree) => {
    const walk = (parent: Parent) => {
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (child.type === "text") {
          const value = (child as Text).value;
          const re = new RegExp(INTERNAL_MARKER_RE.source, "g");
          const parts: RootContent[] = [];
          let lastIdx = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(value)) !== null) {
            if (m.index > lastIdx) {
              parts.push({
                type: "text",
                value: value.slice(lastIdx, m.index),
              });
            }
            parts.push({
              type: "citationMarker",
              data: {
                hName: "citation-marker",
                hProperties: { n: m[1], slug: m[2], quote: m[3] },
              },
            } as unknown as RootContent);
            lastIdx = m.index + m[0].length;
          }
          if (parts.length > 0) {
            if (lastIdx < value.length) {
              parts.push({ type: "text", value: value.slice(lastIdx) });
            }
            parent.children.splice(i, 1, ...parts);
            i += parts.length - 1;
          }
        } else if ("children" in child) {
          walk(child as Parent);
        }
      }
    };
    walk(tree as Parent);
  };
};
```

- [ ] **Step 2: Verify tests pass**

Run: `cd apps/frontend && npm test -- remark-citation`
Expected: PASS — all 5 cases green.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/remark-citation.ts apps/frontend/src/lib/__tests__/remark-citation.test.ts
git commit -m "feat(frontend): add remarkCitation plugin replacing inline markers with MDAST nodes"
```

---

### Task 5: i18n strings + logos.css additions

**Files:**

- Modify: `apps/frontend/src/components/logos/i18n.ts`
- Modify: `apps/frontend/src/components/logos/logos.css`

- [ ] **Step 1: Read existing i18n.ts to locate the `citation` block**

Run: `cat apps/frontend/src/components/logos/i18n.ts | sed -n '/citation/,/^[^ ]/p' | head -30`
Look for the RU and EN `citation: { ... }` objects.

- [ ] **Step 2: Add two keys to both RU and EN citation blocks**

Locate each `citation:` object (one in `ru`, one in `en`) and add the two entries inside it. Example for RU (the EN values follow the same pattern):

```ts
citation: {
  // ...existing keys (notFound, contextHide, contextShow, sourceLabel)
  showPassage: "Полный параграф",
  highlightNotFound: "(цитата не найдена в параграфе дословно)",
}
```

For EN:

```ts
citation: {
  // ...existing keys
  showPassage: "Full paragraph",
  highlightNotFound: "(quote not found verbatim in paragraph)",
}
```

If the existing `citation` block already uses a different shape (e.g., separate object literals), match its style — just add the two keys.

- [ ] **Step 3: Append CSS rules to logos.css**

Append at the end of `apps/frontend/src/components/logos/logos.css`:

```css
/* ─── Citation markers + panel rows + passage modal ─────────────────── */
.citation-pill {
  display: inline-block;
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #ece6d6;
  background: rgba(255, 255, 255, 0.04);
  border: 0.5px solid rgba(238, 232, 218, 0.16);
  border-radius: 4px;
  padding: 1px 6px;
  margin: 0 2px;
  vertical-align: 0.18em;
  cursor: pointer;
  user-select: none;
  text-decoration: none;
  transition: background 160ms ease, border-color 160ms ease;
  font-variant-numeric: tabular-nums;
}
.citation-pill:hover,
.citation-pill[data-active="true"] {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(238, 232, 218, 0.36);
}
.citation-row {
  transition: background 240ms ease, box-shadow 240ms ease;
}
.citation-row[data-active="true"] {
  background: rgba(255, 255, 255, 0.025);
  box-shadow: inset 2px 0 0 #ece6d6;
}
@keyframes citation-flash {
  0%   { background: rgba(255, 255, 255, 0.12); }
  100% { background: transparent; }
}
.citation-row[data-flash="true"] {
  animation: citation-flash 800ms ease-out;
}

.logos-passage-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 7, 10, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 50;
  animation: logos-rise 240ms ease-out;
}
.logos-passage-modal-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, 92vw);
  max-height: 84vh;
  overflow-y: auto;
  background: #0b0c0e;
  border: 0.5px solid rgba(238, 232, 218, 0.12);
  border-radius: 8px;
  padding: 28px 32px;
  z-index: 51;
  animation: logos-rise 320ms cubic-bezier(.22,.61,.36,1) both;
  font-family: var(--font-eb-garamond), "EB Garamond", Georgia, serif;
  font-size: clamp(15px, 1.2vw, 17px);
  line-height: 1.65;
  color: #ece6d6;
}
.logos-passage-modal-content mark {
  background: rgba(236, 230, 214, 0.18);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}
.logos-passage-modal-content :focus-visible {
  outline: 1px solid rgba(238, 232, 218, 0.36);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Verify the dev server still builds**

The frontend preview is already running. Watch the output briefly to make sure HMR didn't choke. If you're running this task headless, verify with:

Run: `cd apps/frontend && npm run lint`
Expected: PASS — 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/logos/i18n.ts apps/frontend/src/components/logos/logos.css
git commit -m "feat(frontend): add citation pill + row active + passage modal CSS and i18n keys"
```

---

### Task 6: CitationContext + CitationPill

**Files:**

- Create: `apps/frontend/src/components/logos/CitationContext.tsx`
- Create: `apps/frontend/src/components/logos/CitationPill.tsx`

- [ ] **Step 1: Write CitationContext**

```tsx
// apps/frontend/src/components/logos/CitationContext.tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface CitationContextValue {
  hoveredN: number | null;
  setHoveredN: (n: number | null) => void;
  scrollToN: (n: number) => void;
  turnKey: string;
}

const CitationCtx = createContext<CitationContextValue | undefined>(undefined);

/**
 * Per-turn provider. Owns hover + scroll-target wiring between inline
 * <CitationPill> and the rows in <CitationsList>. Each turn gets an
 * isolated namespace via `turnKey`, so row IDs never collide across turns.
 */
export function CitationProvider({
  turnKey,
  children,
}: {
  turnKey: string;
  children: ReactNode;
}) {
  const [hoveredN, setHoveredN] = useState<number | null>(null);

  const scrollToN = useCallback(
    (n: number) => {
      const el = document.getElementById(`${turnKey}-cite-${n}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.setAttribute("data-flash", "true");
      window.setTimeout(() => el.removeAttribute("data-flash"), 800);
    },
    [turnKey],
  );

  const value = useMemo<CitationContextValue>(
    () => ({ hoveredN, setHoveredN, scrollToN, turnKey }),
    [hoveredN, scrollToN, turnKey],
  );
  return <CitationCtx.Provider value={value}>{children}</CitationCtx.Provider>;
}

export function useCitationContext(): CitationContextValue {
  const ctx = useContext(CitationCtx);
  if (!ctx)
    throw new Error("useCitationContext must be used inside <CitationProvider>");
  return ctx;
}
```

- [ ] **Step 2: Write CitationPill**

```tsx
// apps/frontend/src/components/logos/CitationPill.tsx
"use client";

import { useCitationContext } from "./CitationContext";

interface Props {
  n: string;        // arrives as string from react-markdown hProperties
  slug?: string;
  quote?: string;
}

/**
 * Inline [N] pill rendered for each `citationMarker` MDAST node. Click
 * scrolls the matching panel row into view; hover paints both this pill
 * and the matching row via the shared CitationContext.
 */
export function CitationPill({ n }: Props) {
  const num = Number(n);
  const { hoveredN, setHoveredN, scrollToN } = useCitationContext();
  const active = hoveredN === num;
  return (
    <sup>
      <a
        href={`#cite-${num}`}
        className="citation-pill"
        data-citation-n={num}
        data-active={active ? "true" : undefined}
        onMouseEnter={() => setHoveredN(num)}
        onMouseLeave={() => setHoveredN(null)}
        onClick={(e) => {
          e.preventDefault();
          scrollToN(num);
        }}
      >
        [{num}]
      </a>
    </sup>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/frontend && npm run lint`
Expected: PASS — 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/logos/CitationContext.tsx apps/frontend/src/components/logos/CitationPill.tsx
git commit -m "feat(frontend): add CitationContext + CitationPill"
```

---

### Task 7: PassageModal

**Files:**

- Create: `apps/frontend/src/components/logos/PassageModal.tsx`

- [ ] **Step 1: Write PassageModal**

```tsx
// apps/frontend/src/components/logos/PassageModal.tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import type { ReadPassageSuccess } from "@/components/citation-card";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passage: ReadPassageSuccess;
  highlightQuote: string;
}

/**
 * Modal with the full read_passage text and the agent's short quote
 * highlighted via <mark>. If the quote is not a verbatim substring of the
 * text, render text plain (soft fail — see spec edge cases).
 */
export function PassageModal({
  open,
  onOpenChange,
  passage,
  highlightQuote,
}: Props) {
  const { s } = useStrings();
  const idx = highlightQuote ? passage.text.indexOf(highlightQuote) : -1;
  const found = idx >= 0;

  const refLine = [
    passage.chapter_title
      ? passage.chapter_title
      : passage.chapter_num
        ? `гл. ${passage.chapter_num}`
        : null,
    passage.window_size === 1
      ? `§${passage.para_start}`
      : `§${passage.para_start}-${passage.para_start + passage.window_size - 1}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="logos-passage-modal-overlay" />
        <Dialog.Content className="logos-passage-modal-content">
          <Dialog.Title
            style={{
              fontFamily: type.logo,
              fontSize: 22,
              fontWeight: 400,
              color: palette.text,
              marginBottom: 4,
            }}
          >
            {passage.author}
          </Dialog.Title>
          <div
            style={{
              fontFamily: type.ui,
              fontSize: 14,
              color: palette.muted,
              marginBottom: 4,
            }}
          >
            {passage.work_title}
          </div>
          {refLine && (
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 18,
              }}
            >
              {refLine}
            </div>
          )}

          {passage.context_before && (
            <div
              style={{
                color: palette.muted,
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
                marginBottom: 14,
              }}
            >
              {passage.context_before}
            </div>
          )}

          <div style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>
            {found ? (
              <>
                {passage.text.slice(0, idx)}
                <mark>{highlightQuote}</mark>
                {passage.text.slice(idx + highlightQuote.length)}
              </>
            ) : (
              passage.text
            )}
          </div>

          {!found && highlightQuote && (
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 14,
              }}
            >
              {s.citation.highlightNotFound}
            </div>
          )}

          {passage.context_after && (
            <div
              style={{
                color: palette.muted,
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
                marginBottom: 14,
              }}
            >
              {passage.context_after}
            </div>
          )}

          {passage.source_url && (
            <div style={{ marginTop: 20 }}>
              <a
                href={passage.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: palette.muted,
                  textDecoration: "none",
                  borderBottom: `0.5px solid ${palette.hairline}`,
                  fontFamily: type.mono,
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {s.citation.sourceLabel} ↗
              </a>
            </div>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close"
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                appearance: "none",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                color: palette.muted,
                fontSize: 18,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/frontend && npm run lint`
Expected: PASS — 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/logos/PassageModal.tsx
git commit -m "feat(frontend): add PassageModal with highlighted quote inside full text"
```

---

### Task 8: Rewrite CitationsList

**Files:**

- Modify: `apps/frontend/src/components/logos/CitationsList.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

```tsx
// apps/frontend/src/components/logos/CitationsList.tsx
"use client";

import { useMemo, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { useCitationContext } from "./CitationContext";
import { PassageModal } from "./PassageModal";
import type {
  ReadPassageFailure,
  ReadPassageSuccess,
} from "@/components/citation-card";
import type { DesignToolCall } from "./turns";
import type { CitationMarker } from "@/lib/citation-marker";

type RowKind =
  | { kind: "success"; marker: CitationMarker; rich: ReadPassageSuccess }
  | { kind: "error"; marker: CitationMarker; err: ReadPassageFailure };

function paraLabel(d: ReadPassageSuccess): string {
  return d.window_size === 1
    ? `§${d.para_start}`
    : `§${d.para_start}-${d.para_start + d.window_size - 1}`;
}

function chapterLabel(d: ReadPassageSuccess): string | null {
  if (d.chapter_title) return d.chapter_title;
  if (d.chapter_num) return `гл. ${d.chapter_num}`;
  return null;
}

function matchToolCall(
  toolCalls: DesignToolCall[],
  slug: string,
): DesignToolCall | undefined {
  return toolCalls.find(
    (tc) =>
      tc.name === "read_passage" &&
      typeof tc.args.citation === "string" &&
      tc.args.citation === slug,
  );
}

function buildRows(
  markers: CitationMarker[],
  toolCalls: DesignToolCall[],
): RowKind[] {
  return markers.map((m) => {
    const tc = matchToolCall(toolCalls, m.slug);
    if (!tc || tc.jsonResult == null) {
      return {
        kind: "error",
        marker: m,
        err: {
          found: false,
          error: "no matching read_passage call for this slug",
          citation: m.slug,
        } as ReadPassageFailure,
      };
    }
    const r = tc.jsonResult as ReadPassageSuccess | ReadPassageFailure;
    if (r.found === false) {
      return { kind: "error", marker: m, err: r };
    }
    return { kind: "success", marker: m, rich: r };
  });
}

function CitationRowSuccess({ row }: { row: Extract<RowKind, { kind: "success" }> }) {
  const { s } = useStrings();
  const { hoveredN, setHoveredN, turnKey } = useCitationContext();
  const [modalOpen, setModalOpen] = useState(false);
  const { marker, rich } = row;
  const ref = [chapterLabel(rich), paraLabel(rich)].filter(Boolean).join(" · ");
  const active = hoveredN === marker.n;

  return (
    <div
      id={`${turnKey}-cite-${marker.n}`}
      className="citation-row"
      data-active={active ? "true" : undefined}
      onMouseEnter={() => setHoveredN(marker.n)}
      onMouseLeave={() => setHoveredN(null)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${(marker.n - 1) * 80}ms`,
      }}
    >
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: palette.accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        [{marker.n}]
      </div>
      <div>
        <div
          style={{
            fontFamily: type.quote,
            fontStyle: "italic",
            fontSize: "clamp(15px, 1.2vw, 17px)",
            lineHeight: 1.55,
            color: palette.text,
            marginBottom: 6,
            textWrap: "pretty",
            whiteSpace: "pre-wrap",
          }}
        >
          «{marker.quote}»
        </div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: palette.muted,
          }}
        >
          {rich.author && (
            <span style={{ color: palette.text }}>{rich.author}</span>
          )}
          {rich.author && rich.work_title && " · "}
          {rich.work_title}
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            padding: "8px 0 0",
            color: palette.faint,
            fontFamily: type.mono,
            fontSize: 9.5,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            transition: "color 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.faint;
          }}
        >
          <span>▾ {s.citation.showPassage}</span>
        </button>
      </div>
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
          textAlign: "right",
          lineHeight: 1.6,
        }}
      >
        {ref && <div>{ref}</div>}
        {rich.source_url && (
          <div style={{ marginTop: 6 }}>
            <a
              href={rich.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: palette.muted,
                textDecoration: "none",
                borderBottom: `0.5px solid ${palette.hairline}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = palette.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = palette.muted;
              }}
            >
              {s.citation.sourceLabel} ↗
            </a>
          </div>
        )}
      </div>
      <PassageModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        passage={rich}
        highlightQuote={marker.quote}
      />
    </div>
  );
}

function CitationRowError({ row }: { row: Extract<RowKind, { kind: "error" }> }) {
  const { s } = useStrings();
  const { hoveredN, setHoveredN, turnKey } = useCitationContext();
  const { marker, err } = row;
  const active = hoveredN === marker.n;
  const explain =
    err.work_exists === false
      ? "Похоже, агент сократил slug. Попроси: «возьми citation из результатов поиска буква-в-букву»."
      : err.work_exists === true
        ? "Труд найден, но такого параграфа нет — глава/номер ошибочны."
        : "Citation не разобрался — нужен формат author_slug/work_slug/NNNN/pX.";
  return (
    <div
      id={`${turnKey}-cite-${marker.n}`}
      className="citation-row"
      data-active={active ? "true" : undefined}
      onMouseEnter={() => setHoveredN(marker.n)}
      onMouseLeave={() => setHoveredN(null)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${(marker.n - 1) * 80}ms`,
        opacity: 0.85,
      }}
    >
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: palette.faint,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        [{marker.n}]
      </div>
      <div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 13,
            lineHeight: 1.55,
            color: palette.text,
            marginBottom: 6,
          }}
        >
          {s.citation.notFound}
        </div>
        <div
          style={{
            fontFamily: type.mono,
            fontSize: 11,
            color: palette.muted,
            wordBreak: "break-all",
            marginBottom: 6,
          }}
        >
          {err.citation}
        </div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 12,
            color: palette.muted,
            lineHeight: 1.55,
          }}
        >
          {explain}
        </div>
      </div>
      <div />
    </div>
  );
}

export function CitationsList({
  markers,
  toolCalls,
}: {
  markers: CitationMarker[];
  toolCalls: DesignToolCall[];
}) {
  const rows = useMemo(() => buildRows(markers, toolCalls), [markers, toolCalls]);
  if (rows.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop: `0.5px solid ${palette.hairline}`,
        animation: "logos-rise 900ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: "120ms",
      }}
    >
      {rows.map((row) =>
        row.kind === "success" ? (
          <CitationRowSuccess key={`c-${row.marker.n}`} row={row} />
        ) : (
          <CitationRowError key={`c-${row.marker.n}`} row={row} />
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/frontend && npm run lint`
Expected: PASS — 0 new errors. Existing pre-existing warnings (react-refresh, require-yield, unused-disable) unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/logos/CitationsList.tsx
git commit -m "$(cat <<'EOF'
refactor(frontend): rewrite CitationsList to consume markers + toolCalls

Panel rows are now derived from agent-emitted [[slug|«quote»]] markers,
matched to read_passage results by slug for rich data. Quote in the row
is the agent's short pick; "ПОЛНЫЙ ПАРАГРАФ" button opens a modal with
the full text and quote highlighted.
EOF
)"
```

---

### Task 9: Wire markdown-text + AssistantTurn

**Files:**

- Modify: `apps/frontend/src/components/logos/markdown/markdown-text.tsx` (plugin chain + components)
- Modify: `apps/frontend/src/components/logos/AssistantTurn.tsx` (numberMarkers + CitationProvider)

- [ ] **Step 1: Wire remarkCitation into markdown-text.tsx**

Replace this block at `markdown-text.tsx:254-257`:

```ts
// Stable plugin refs — inline arrays would create new identities every render
// and defeat memoization downstream.
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
```

With:

```ts
import { remarkCitation } from "@/lib/remark-citation";
import { CitationPill } from "@/components/logos/CitationPill";

// ...keep existing remarkGfm/remarkMath/rehypeKatex imports

// Stable plugin refs — inline arrays would create new identities every render
// and defeat memoization downstream.
const remarkPlugins = [remarkGfm, remarkMath, remarkCitation];
const rehypePlugins = [rehypeKatex];
```

(Add the two new imports near the top of the file alongside the other plugin imports.)

Then extend `defaultComponents` to map the custom element. Find the existing `defaultComponents` object literal (lines 71-252) and add this entry at the top of the object:

```ts
const defaultComponents: any = {
  "citation-marker": ({
    n,
    slug,
    quote,
  }: {
    n?: string;
    slug?: string;
    quote?: string;
  }) => (
    <CitationPill n={n ?? "0"} slug={slug} quote={quote} />
  ),
  // ...existing h1, h2, ... unchanged
```

- [ ] **Step 2: Read AssistantTurn.tsx to find the integration point**

Run: `cat apps/frontend/src/components/logos/AssistantTurn.tsx`
Locate where `MarkdownText` is rendered and where the citations panel is rendered. Note the current props passed to `CitationsList` — they must change.

- [ ] **Step 3: Update AssistantTurn.tsx**

Apply these specific changes:

1. **Imports.** At the top, add:

```ts
import { CitationProvider } from "./CitationContext";
import { extractMarkers, numberMarkers } from "@/lib/citation-marker";
import { useMemo } from "react";
```

(Skip imports already present.)

2. **Inside the component body**, compute markers and numbered text from `turn.answerText`. Place these near the top, before the return:

```tsx
const markers = useMemo(() => extractMarkers(turn.answerText), [turn.answerText]);
const numberedAnswer = useMemo(
  () => numberMarkers(turn.answerText),
  [turn.answerText],
);
```

3. **Wrap the returned JSX with `<CitationProvider turnKey={turn.key}>`.** Find the outermost JSX wrapper of the assistant turn render and wrap it. If the current return is `<div style={...}>{...stuff with MarkdownText and CitationsList...}</div>`, change to:

```tsx
<CitationProvider turnKey={turn.key}>
  <div style={...}>{...stuff...}</div>
</CitationProvider>
```

4. **Replace the `MarkdownText` child argument** with `numberedAnswer` instead of `turn.answerText` (or whatever the current source is). It used to be:

```tsx
<MarkdownText>{turn.answerText}</MarkdownText>
```

becomes:

```tsx
<MarkdownText>{numberedAnswer}</MarkdownText>
```

5. **Update the `CitationsList` invocation** to pass `markers` + `toolCalls`:

```tsx
<CitationsList markers={markers} toolCalls={turn.toolCalls} />
```

(Old call was `<CitationsList toolCalls={turn.toolCalls} />`.)

- [ ] **Step 4: Run all unit tests + lint**

Run: `cd apps/frontend && npm test && npm run lint`
Expected: PASS — all tests green, lint 0 new errors.

- [ ] **Step 5: Production build**

Run: `cd apps/frontend && npm run build`
Expected: PASS — Next.js build completes without type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/logos/markdown/markdown-text.tsx apps/frontend/src/components/logos/AssistantTurn.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): wire citation markers through MarkdownText + AssistantTurn

remarkCitation joins the plugin chain; the `citation-marker` element
maps to CitationPill. AssistantTurn pre-numbers markers in answerText
via numberMarkers (so per-block ReactMarkdown calls share a stable N
counter) and provides CitationContext to inline pills and panel rows.
EOF
)"
```

---

### Task 10: Backend prompt change

**Files:**

- Modify: `apps/backend/src/backend/prompts.py` (rule #4 in `MAIN_AGENT_PROMPT`)

- [ ] **Step 1: Replace rule #4 and append rule #5**

Locate the existing rule #4 in `MAIN_AGENT_PROMPT` (around line 21):

```python
4. Каждую цитату оформляй с явной ссылкой в формате «{Автор}, {Труд}, гл. {N}, §{para}» и указанием azbyka-URL (из `source_url` в результате `read_passage`).
```

Replace it with:

```python
4. **Маркируй каждую цитату спецсинтаксисом:** в месте, где ты ссылаешься на источник, ставь

   `[[<citation_slug>|«<короткая ключевая фраза>»]]`

   где:
   - `<citation_slug>` — точный slug из `read_passage`-вызова (буква-в-букву, как в правиле 2);
   - `«<короткая фраза>»` — verbatim подстрока из `read_passage.text`, **не более одного предложения / 25 слов**. Это фраза, которая поддерживает твоё утверждение и которую читатель увидит в панели цитат под ответом.

   Пример:

   `Святитель Тихон вёл аскетичный образ жизни [[sokolov_tihon_zadonskij_svjatitel/sokolov_tihon_zadonskij_svjatitel_simfonija_po_tvorenijam_svjatitelja_tihona_zadonskogo/0217/p42|«спал на соломе, накрывшись овчинным тулупом»]] — простота быта была частью его учения.`

   Никаких «{Автор}, {Труд}, гл. N, §para» **в самом тексте** — фронтенд достанет автора/труд/главу/azbyka-URL из `read_passage` автоматически. В тексте — только твоя проза + спецмаркеры.

   **Важно:** короткая фраза в `«»` обязана быть **дословной подстрокой** ответа `read_passage`. Не перефразируй.

5. Если в твоём ответе нет ни одного `[[...|«...»]]` — это значит ты не сослался ни на один источник. Это приемлемо для negative-вопросов и общих рассуждений, но для адресных и тематических — почти всегда означает, что ты ответил «по памяти». Перепроверь себя.
```

- [ ] **Step 2: Verify unit tests still pass**

Run: `cd apps/backend && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/unit -v`
Expected: PASS — prompt changes don't break any unit test (none test prompts).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/backend/prompts.py
git commit -m "$(cat <<'EOF'
feat(backend): switch main agent to [[slug|«quote»]] citation markers

Rule #4 in MAIN_AGENT_PROMPT replaced: the agent now marks each citation
inline with [[citation_slug|«short verbatim quote»]] instead of writing
the «{Author}, {Work}, ch. N, §para» reference in prose. The frontend
resolves author/work/§/azbyka URL from read_passage by slug automatically.

Rule #5 added: an answer with zero markers signals an unsourced response
to the agent and asks it to re-check.
EOF
)"
```

---

### Task 11: Manual SMOKE

**Files:** none — manual verification via Claude Preview.

- [ ] **Step 1: Restart backend so the new prompt is loaded**

The langgraph dev server reloads code on save, but be explicit:

```powershell
# Stop the running preview
mcp__Claude_Preview__preview_stop <backend-server-id>
mcp__Claude_Preview__preview_start backend
```

Wait for `/info` to return 200:

```bash
until curl -sf http://localhost:2050/info >/dev/null 2>&1; do sleep 2; done
echo BACKEND READY
```

- [ ] **Step 2: Walk through the smoke scenarios**

Open http://localhost:3001. Clear localStorage to start fresh:

```js
localStorage.clear(); location.replace("/");
```

Submit a question that should trigger several `read_passage` calls (3+). Example: «Расскажи о подвиге Тихона Задонского с цитатами».

Verify:

1. **Markers render inline.** As the answer streams in, `[1]`, `[2]`, `[3]` pills appear at the agent's chosen positions. They're small, mono, with a faint border, vertically aligned slightly above the baseline.
2. **No leftover marker syntax.** No `[[...|«...»]]` literal text anywhere in the rendered answer.
3. **Panel rows match.** Below the answer, one row per marker, in the same order. Each row shows the agent-picked short `«quote»`, author · work, `гл./§` ref, azbyka link.
4. **Hover bidirectional.** Mouse over `[1]` in the answer → row 1 in the panel gets the left-edge accent + slightly brighter background. Move to `[2]` → highlight follows. Hover row 1 in the panel → pill `[1]` in the answer gets the active style. Move mouse off → highlight clears.
5. **Click scroll.** Click `[2]` in the answer (assuming the panel is below the viewport when you start) → smooth scroll lands row 2 in the center of the viewport. A faint background flash plays once and fades.
6. **Modal opens.** Click "▾ ПОЛНЫЙ ПАРАГРАФ" inside a panel row → modal opens, header shows author + work + ref line, full passage text renders with the agent's short quote wrapped in a subtle `<mark>` highlight. `context_before` / `context_after` (if present) render above/below in muted italic.
7. **Highlight soft-fail.** If you can find or trigger a case where the agent's quote is not a verbatim substring of the passage (e.g., paraphrased), the modal still opens, text renders plain, and `s.citation.highlightNotFound` line appears under the text.
8. **Esc / click outside closes modal.**
9. **Edit human still works.** Hover a previous human message → click Edit → modify text → Save → answer regenerates with new markers; old panel disappears, new panel builds.
10. **Reload.** Reload the page → answer stays (from localStorage), markers and panel re-derive from the persisted answer text. No re-fetch from server.
11. **Old thread compat.** If you still have a thread in localStorage from before this change (no `[[...|«...»]]` markers in its answers), open it from the sidebar → answer renders, panel is empty. No crash, no console errors.
12. **DevTools network sanity.** During submit, POST `http://localhost:2050/runs/stream` returns 200 and the request body has no `thread_id` (stateless flow unchanged).

- [ ] **Step 3: Goldset re-run (optional but recommended)**

The new prompt may shift answer quality. If you want a quantitative check:

```bash
cd apps/backend
PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/integration/test_goldset.py -v -s
```

Watch the four category percentages against the thresholds in CLAUDE.md (addressed ≥80%, thematic ≥60%, cross ≥70%, negative =100%). If any drops below threshold, return to Task 10 and refine the prompt before merging.

- [ ] **Step 4: Decide whether to add a docs touch-up**

If you discovered any UX detail worth recording, update `apps/frontend/CLAUDE.md` ("Citation panel uses agent-emitted `[[slug|«quote»]]` markers; rendered through `remarkCitation` plugin + `CitationPill` component; `CitationProvider` wires hover/scroll per turn.") and commit. Otherwise no commit.

---

## Self-Review

**Spec coverage:**

- ✅ Marker syntax `[[slug|«quote»]]` — Tasks 1, 2 (regex), 10 (agent emits).
- ✅ Pre-numbering for stable N across split blocks — Task 1 (`numberMarkers`), Task 9 (used in AssistantTurn).
- ✅ remark plugin replaces inline markers with custom nodes — Tasks 3, 4.
- ✅ CitationContext per-turn hover + scroll — Task 6.
- ✅ Inline `[N]` pill with hover/click — Task 6.
- ✅ Panel rewritten to consume markers + toolCalls — Task 8.
- ✅ Modal with highlighted quote inside full text — Task 7.
- ✅ Bidirectional hover (pill ↔ row) — Tasks 6 (pill side), 8 (row side).
- ✅ Click marker → smooth scroll + flash — Task 6 (`scrollToN`), Task 5 (`@keyframes citation-flash`), Task 8 (row IDs).
- ✅ Error rows for unmatched slug / found=false — Task 8.
- ✅ CSS + i18n additions — Task 5.
- ✅ Backend prompt change — Task 10.
- ✅ Manual SMOKE — Task 11.
- ✅ Code blocks isolated from marker substitution — Task 4 (walk skips code/inlineCode by not recursing into non-Parent nodes; tests pin this).
- ✅ Half-tokens during stream don't break — Task 1 (regex requires `]]`), Task 4 (same).

No gaps.

**Placeholder scan:** No TBD/TODO/"similar to". Every code step shows the actual code. Step 3 of Task 9 has narrative-style edits ("find the outermost JSX wrapper") rather than literal old/new diff blocks because `AssistantTurn.tsx` was not read in this plan-writing pass — the implementer reads it in Step 2 of Task 9 first. The narrative is precise enough (specific imports, specific component renames, specific prop changes).

**Type consistency:**

- `CitationMarker = {n: number, slug: string, quote: string}` — same shape in Task 1, 8, 9.
- `numberMarkers` / `extractMarkers` signatures and call sites match.
- `INTERNAL_MARKER_RE` (3 capture groups: N, slug, quote) — consistent in Task 1 def, Task 2 use, Task 4 plugin use.
- `CitationProvider` props `{turnKey: string, children: ReactNode}` — same in Task 6 def and Task 9 use.
- `CitationPill` props `{n: string, slug?, quote?}` — same in Task 6 def and Task 9 mapping.
- `CitationsList` props `{markers: CitationMarker[], toolCalls: DesignToolCall[]}` — same in Task 8 def and Task 9 use.
- Row id format `${turnKey}-cite-${n}` — same in CitationContext.scrollToN (Task 6), CitationsList rows (Task 8), and CitationPill href (Task 6 uses `#cite-${num}` href which is decorative; navigation is JS-driven via scrollToN).

No mismatches.
