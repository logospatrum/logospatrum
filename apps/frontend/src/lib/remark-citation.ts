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
