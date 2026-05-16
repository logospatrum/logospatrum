"use client";

import type { AIMessage, Message, ToolMessage } from "@langchain/langgraph-sdk";
import type { MessageContentComplex } from "@langchain/core/messages";
import { parsePartialJson } from "@langchain/core/output_parsers";
import { getContentString } from "./markdown/content";

export interface DesignToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Raw string content from the tool message, if it arrived. */
  rawResult: string | null;
  /** Parsed JSON if the result deserialized cleanly. */
  jsonResult: unknown | null;
  /** True iff this tool call has no matching tool message yet (still in flight). */
  pending: boolean;
}

export interface DesignTurn {
  /** A stable key derived from the human message id (or its index fallback). */
  key: string;
  /** Human prompt (may be null if the conversation starts with an interrupt). */
  human: Message | null;
  /** All AI messages produced inside this turn, in order. */
  ais: AIMessage[];
  /** All tool messages produced inside this turn, in order. */
  tools: ToolMessage[];
  /** Flattened tool-call list pairing each call to its result by tool_call_id. */
  toolCalls: DesignToolCall[];
  /** Final, user-facing answer text (the latest non-empty content among the AI
   *  messages — earlier AIs are typically tool-call shells). */
  answerText: string;
  /** True if this turn is the latest one and the stream is still running. */
  inProgress: boolean;
}

function getRawContent(content: ToolMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object" && "text" in b && typeof (b as { text?: unknown }).text === "string") {
          return (b as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function tryParse(raw: string | null): unknown | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Parse Anthropic-streamed tool_use blocks out of an AI message's content
// array. Mirrors the upstream logic in components/thread/messages/ai.tsx.
function parseAnthropicStreamedToolCalls(
  content: MessageContentComplex[],
): NonNullable<AIMessage["tool_calls"]> {
  const blocks = content.filter((c) => c.type === "tool_use" && c.id);
  return blocks.map((tc) => {
    const raw = tc as Record<string, unknown>;
    let parsed: Record<string, unknown> = {};
    if (raw.input != null) {
      try {
        // parsePartialJson handles half-streamed JSON gracefully.
        parsed = (parsePartialJson(raw.input as string) as Record<string, unknown>) ?? {};
      } catch {
        /* leave parsed empty */
      }
    }
    return {
      name: (raw.name as string) ?? "",
      id: (raw.id as string) ?? "",
      args: parsed,
      type: "tool_call",
    };
  });
}

function extractToolCalls(ai: AIMessage): NonNullable<AIMessage["tool_calls"]> {
  if (ai.tool_calls && ai.tool_calls.length > 0) return ai.tool_calls;
  if (Array.isArray(ai.content)) return parseAnthropicStreamedToolCalls(ai.content);
  return [];
}

/**
 * Group a flat `Message[]` array into design-shaped turns.
 *
 * A turn is `human → (one or more ai/tool messages) → next human`. Tool
 * results are matched to their AI's tool calls by `tool_call_id` so the
 * ThinkingTrace can render `args` and `result` together as one row.
 *
 * The latest turn is marked `inProgress` iff the SDK is currently streaming.
 */
export function groupMessagesIntoTurns(
  messages: Message[],
  isLoading: boolean,
): DesignTurn[] {
  const turns: DesignTurn[] = [];
  let current: DesignTurn | null = null;

  const startTurn = (human: Message | null, key: string) => {
    if (current) turns.push(current);
    current = {
      key,
      human,
      ais: [],
      tools: [],
      toolCalls: [],
      answerText: "",
      inProgress: false,
    };
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.type === "human") {
      startTurn(m, m.id ?? `h-${i}`);
    } else {
      // Make sure there's a turn to attach to (handles "leading interrupt"
      // case where an AI message can arrive before any human).
      if (!current) startTurn(null, `t-${i}`);
      if (m.type === "ai") {
        current!.ais.push(m as AIMessage);
      } else if (m.type === "tool") {
        current!.tools.push(m as ToolMessage);
      }
    }
  }
  if (current) turns.push(current);

  // Resolve tool calls and answer text for each turn.
  for (const turn of turns) {
    // Index tool messages by their referenced tool_call_id.
    const toolByCallId = new Map<string, ToolMessage>();
    for (const t of turn.tools) {
      if (t.tool_call_id) toolByCallId.set(t.tool_call_id, t);
    }
    // Flatten all tool calls across all AI messages in this turn.
    const calls: DesignToolCall[] = [];
    for (const ai of turn.ais) {
      for (const tc of extractToolCalls(ai)) {
        if (!tc.id) continue;
        const t = toolByCallId.get(tc.id);
        const raw = t ? getRawContent(t.content) : null;
        const parsed = raw != null ? tryParse(raw) : null;
        calls.push({
          id: tc.id,
          name: tc.name ?? "",
          args: (tc.args as Record<string, unknown>) ?? {},
          rawResult: raw,
          jsonResult: parsed,
          pending: t == null,
        });
      }
    }
    turn.toolCalls = calls;

    // Answer text: the latest non-empty content string from an AI message.
    // While streaming, only the final AI message carries the user-facing
    // answer text — earlier AI shells just announce their tool calls.
    for (let i = turn.ais.length - 1; i >= 0; i--) {
      const candidate = getContentString(turn.ais[i].content);
      if (candidate.trim().length > 0) {
        turn.answerText = candidate;
        break;
      }
    }
  }

  if (turns.length > 0 && isLoading) {
    turns[turns.length - 1].inProgress = true;
  }
  return turns;
}
