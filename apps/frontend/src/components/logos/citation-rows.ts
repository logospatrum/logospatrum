// apps/frontend/src/components/logos/citation-rows.ts
//
// Shared logic that builds the per-marker view-model (RowKind) consumed by
// both the inline tooltip (CitationTooltip) and the panel below the answer
// (CitationsList). Lives in its own module so the two components stay
// independent — neither imports the other.

import type {
  ReadPassageFailure,
  ReadPassageSuccess,
} from "@/components/citation-card";
import type { CitationMarker } from "@/lib/citation-marker";
import {
  bibleAzbykaUrl,
  bibleShortRef,
  workSlugFromCitation,
} from "@/lib/bible-books";
import type { Lang } from "./i18n";
import type { DesignToolCall } from "./turns";

export type RowKind =
  | { kind: "success"; marker: CitationMarker; rich: ReadPassageSuccess }
  | { kind: "error"; marker: CitationMarker; err: ReadPassageFailure };

export function paraLabel(d: ReadPassageSuccess): string {
  return d.window_size === 1
    ? `§${d.para_start}`
    : `§${d.para_start}-${d.para_start + d.window_size - 1}`;
}

export function chapterLabel(d: ReadPassageSuccess): string | null {
  if (d.chapter_title) return d.chapter_title;
  if (d.chapter_num) return `гл. ${d.chapter_num}`;
  return null;
}

/** Build the right-column ref string. Scripture gets `Мф 1:2`; patristic
 *  keeps the chapter/§ form. */
export function refLabel(d: ReadPassageSuccess, lang: Lang): string {
  const workSlug = workSlugFromCitation(d.citation);
  if (workSlug) {
    const bibleRef = bibleShortRef(
      workSlug,
      lang,
      d.chapter_num,
      d.para_start,
      d.window_size,
    );
    if (bibleRef) return bibleRef;
  }
  return [chapterLabel(d), paraLabel(d)].filter(Boolean).join(" · ");
}

/** Resolve the azbyka link. Patristic works carry `source_url`; Bible works
 *  have it NULL, so build it from the static book map. */
export function azbykaHref(d: ReadPassageSuccess): string | null {
  if (d.source_url) return d.source_url;
  const workSlug = workSlugFromCitation(d.citation);
  if (!workSlug) return null;
  return bibleAzbykaUrl(workSlug, d.chapter_num, d.para_start, d.window_size);
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

export function buildRows(
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
