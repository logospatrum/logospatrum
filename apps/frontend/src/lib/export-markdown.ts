// Serialize a chat into a self-contained Markdown document.
//
// - Tool calls (ThinkingTrace) are intentionally dropped — the export shows
//   only the user-visible conversation surface.
// - Inline `[[slug|«quote»]]` markers are rewritten to plain `[N]` text and
//   a "**Цитаты:**" / "**Citations:**" block is appended after each
//   assistant turn, with markdown links pointing to azbyka.

import type { Message } from "@langchain/langgraph-sdk";
import {
  groupMessagesIntoTurns,
  type DesignToolCall,
  type DesignTurn,
} from "@/components/logos/turns";
import { humanMessageText } from "@/components/logos/markdown/content";
import {
  AGENT_MARKER_RE,
  extractMarkers,
  stripTrailingPartialMarker,
  type CitationMarker,
} from "@/lib/citation-marker";
import {
  bibleAzbykaUrl,
  bibleShortRef,
  workSlugFromCitation,
} from "@/lib/bible-books";
import type {
  ReadPassageFailure,
  ReadPassageSuccess,
} from "@/components/citation-card";
import type { Lang } from "@/components/logos/i18n";

interface ExportLabels {
  question: string;
  answer: string;
  citations: string;
  notFound: string;
  exportedAt: string;
}

const LABELS: Record<Lang, ExportLabels> = {
  ru: {
    question: "Вопрос",
    answer: "Ответ",
    citations: "Цитаты",
    notFound: "цитата не найдена",
    exportedAt: "Экспорт",
  },
  en: {
    question: "Question",
    answer: "Answer",
    citations: "Citations",
    notFound: "citation not found",
    exportedAt: "Exported",
  },
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** YYYY-MM-DD in local time. */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Replace `[[slug|«quote»]]` with `[N]` in left-to-right order. The same N
 *  numbering as `extractMarkers` is used so the inline pills match the
 *  citation block below. */
function rewriteMarkersInline(answer: string): string {
  let n = 0;
  return answer.replace(AGENT_MARKER_RE, () => {
    n += 1;
    return `[${n}]`;
  });
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

/** Build the right-column reference snippet for a citation line. */
function refLabel(d: ReadPassageSuccess, lang: Lang): string {
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
  const para =
    d.window_size === 1
      ? `§${d.para_start}`
      : `§${d.para_start}-${d.para_start + d.window_size - 1}`;
  const chapter = d.chapter_title || (d.chapter_num ? `гл. ${d.chapter_num}` : null);
  return [chapter, para].filter(Boolean).join(" · ");
}

function azbykaHref(d: ReadPassageSuccess): string | null {
  if (d.source_url) return d.source_url;
  const workSlug = workSlugFromCitation(d.citation);
  if (!workSlug) return null;
  return bibleAzbykaUrl(workSlug, d.chapter_num, d.para_start, d.window_size);
}

function citationLineSuccess(
  n: number,
  marker: CitationMarker,
  rich: ReadPassageSuccess,
  lang: Lang,
): string {
  const ref = refLabel(rich, lang);
  const meta = [rich.author, rich.work_title].filter(Boolean).join(". ");
  const href = azbykaHref(rich);
  const trailing = meta && ref ? `${meta} (${ref})` : meta || ref;
  const link = href ? ` [azbyka](${href})` : "";
  return `${n}. *«${marker.quote}»* — ${trailing}.${link}`;
}

function citationLineError(
  n: number,
  marker: CitationMarker,
  err: ReadPassageFailure,
  labels: ExportLabels,
): string {
  return `${n}. *«${marker.quote}»* — \`${err.citation}\` _(${labels.notFound})_`;
}

function turnToMarkdown(turn: DesignTurn, lang: Lang, labels: ExportLabels): string {
  const out: string[] = [];
  const humanText = turn.human ? humanMessageText(turn.human).trim() : "";
  if (humanText) {
    out.push(`## ${labels.question}`);
    out.push("");
    out.push(humanText);
    out.push("");
  }

  const cleanAnswer = stripTrailingPartialMarker(turn.answerText).trim();
  if (cleanAnswer) {
    out.push(`## ${labels.answer}`);
    out.push("");
    out.push(rewriteMarkersInline(cleanAnswer));
    out.push("");

    const markers = extractMarkers(cleanAnswer);
    if (markers.length > 0) {
      out.push(`**${labels.citations}:**`);
      out.push("");
      for (const marker of markers) {
        const tc = matchToolCall(turn.toolCalls, marker.slug);
        const result = tc?.jsonResult as
          | ReadPassageSuccess
          | ReadPassageFailure
          | undefined;
        if (result && result.found) {
          out.push(citationLineSuccess(marker.n, marker, result, lang));
        } else {
          const err: ReadPassageFailure =
            result && result.found === false
              ? result
              : {
                  found: false,
                  error: "no matching read_passage call for this slug",
                  citation: marker.slug,
                };
          out.push(citationLineError(marker.n, marker, err, labels));
        }
      }
      out.push("");
    }
  }
  return out.join("\n");
}

/** Render the full chat as markdown. */
export function messagesToMarkdown(
  messages: Message[],
  opts: { lang: Lang; title?: string; now?: Date },
): string {
  const labels = LABELS[opts.lang];
  const turns = groupMessagesIntoTurns(messages, false);
  const now = opts.now ?? new Date();
  const title = (opts.title ?? "ΛΟΓΟΣ").trim() || "ΛΟΓΟΣ";

  const head = [
    `# ${title}`,
    "",
    `_${labels.exportedAt}: ${fmtTimestamp(now)} · ΛΟΓΟΣ_`,
    "",
    "---",
    "",
  ].join("\n");

  const body = turns.map((t) => turnToMarkdown(t, opts.lang, labels)).filter(Boolean).join("\n");
  return head + body;
}

/** Cyrillic transliteration table (lowercase). Matches the patristic pipeline's
 *  slugify output well enough for filenames. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
  ч: "ch", ш: "sh", щ: "shh", ъ: "", ы: "y", ь: "", э: "e", ю: "ju",
  я: "ja",
};

function transliterate(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
}

/** Builds a safe ASCII slug from a title, capped at 40 chars. */
export function slugifyTitle(title: string): string {
  const t = transliterate(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t.slice(0, 40) || "chat";
}

/** Default export filename: `logos-<slug>-<YYYY-MM-DD>.md`. */
export function exportFilename(title: string, now?: Date): string {
  return `logos-${slugifyTitle(title)}-${fmtDate(now ?? new Date())}.md`;
}

/** Trigger a browser download for the given markdown blob. Best-effort —
 *  silently no-ops in non-browser environments. */
export function downloadMarkdown(filename: string, content: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari/Firefox finish kicking off the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
