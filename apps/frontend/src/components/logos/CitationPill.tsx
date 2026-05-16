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
  const { hoveredN, setHoveredN, scrollToN, turnKey } = useCitationContext();
  const active = hoveredN === num;
  return (
    <sup>
      <a
        href={`#${turnKey}-cite-${num}`}
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
