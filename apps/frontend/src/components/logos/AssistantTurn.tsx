"use client";

import { MarkdownText } from "@/components/thread/markdown-text";
import { ThinkingTrace } from "./ThinkingTrace";
import { CitationsList } from "./CitationsList";
import type { DesignTurn } from "./turns";

// Styles for `.logos-answer` (markdown body palette overrides) live in
// `app/globals.css`. We attach the class here so the upstream
// `MarkdownText`'s tailwind defaults don't fight the dark theme.

interface Props {
  turn: DesignTurn;
}

export function AssistantTurn({ turn }: Props) {
  const showTrace = turn.toolCalls.length > 0;
  const showAnswer = turn.answerText.trim().length > 0;
  return (
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
          <MarkdownText>{turn.answerText}</MarkdownText>
        </div>
      )}

      <CitationsList toolCalls={turn.toolCalls} />
    </div>
  );
}
