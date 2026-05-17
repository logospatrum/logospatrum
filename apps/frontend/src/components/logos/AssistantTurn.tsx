"use client";

import * as React from "react";
import { MarkdownText } from "./markdown/markdown-text";
import { ThinkingTrace } from "./ThinkingTrace";
import { CitationsList } from "./CitationsList";
import { CitationProvider } from "./CitationContext";
import {
  extractMarkers,
  numberMarkers,
  stripTrailingPartialMarker,
} from "@/lib/citation-marker";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { useMemo } from "react";
import type { DesignTurn } from "./turns";

// Styles for `.logos-answer` (markdown body palette overrides) live in
// `app/globals.css`. We attach the class here so the upstream
// `MarkdownText`'s tailwind defaults don't fight the dark theme.

const pillStyle: React.CSSProperties = {
  appearance: "none",
  border: `0.5px solid ${palette.hairline}`,
  background: "transparent",
  color: palette.muted,
  fontFamily: type.mono,
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  padding: "8px 14px",
  borderRadius: 999,
  cursor: "default",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  transition:
    "color 240ms ease, border-color 240ms ease, background 240ms ease",
};

const pillHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.color = palette.text;
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
};

const pillHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.color = palette.muted;
  e.currentTarget.style.borderColor = palette.hairline;
  e.currentTarget.style.background = "transparent";
};

interface Props {
  turn: DesignTurn;
  /** True only for the latest non-streaming assistant turn — shows
   *  the Regenerate and Export pills. */
  showRegenerate?: boolean;
  onRegenerate?: () => void;
  onExport?: () => void;
}

export function AssistantTurn({ turn, showRegenerate, onRegenerate, onExport }: Props) {
  const { s } = useStrings();
  const showTrace = turn.toolCalls.length > 0;
  const showAnswer = turn.answerText.trim().length > 0;
  // Hide any half-typed [[… that's still streaming so the raw marker
  // syntax doesn't leak into the rendered markdown.
  const cleanAnswer = useMemo(
    () => stripTrailingPartialMarker(turn.answerText),
    [turn.answerText],
  );
  const markers = useMemo(() => extractMarkers(cleanAnswer), [cleanAnswer]);
  const numberedAnswer = useMemo(
    () => numberMarkers(cleanAnswer),
    [cleanAnswer],
  );
  return (
    <CitationProvider turnKey={turn.key}>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
      }}
    >
      {showTrace && (
        <ThinkingTrace
          toolCalls={turn.toolCalls}
          inProgress={turn.inProgress}
        />
      )}

      {showAnswer && (
        <div className="logos-answer">
          <MarkdownText>{numberedAnswer}</MarkdownText>
        </div>
      )}

      <CitationsList markers={markers} toolCalls={turn.toolCalls} />

      {showRegenerate && (onRegenerate || onExport) && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              aria-label={s.chat.exportAria}
              style={pillStyle}
              onMouseEnter={pillHoverIn}
              onMouseLeave={pillHoverOut}
            >
              <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1v7M3 5l3 3 3-3M2 10h8"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{s.chat.export}</span>
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label={s.chat.regenerateAria}
              style={pillStyle}
              onMouseEnter={pillHoverIn}
              onMouseLeave={pillHoverOut}
            >
              <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6 A4 4 0 0 1 10 6 M10 3 V6 H7 M10 6 A4 4 0 0 1 2 6 M2 9 V6 H5"
                  stroke="currentColor"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span>{s.chat.regenerate}</span>
            </button>
          )}
        </div>
      )}
    </div>
    </CitationProvider>
  );
}
