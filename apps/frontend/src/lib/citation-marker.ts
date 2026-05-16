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
