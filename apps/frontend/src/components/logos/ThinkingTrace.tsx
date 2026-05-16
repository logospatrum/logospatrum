"use client";

import { useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { Chevron } from "./Chevron";
import { MarkdownText } from "./markdown/markdown-text";
import type { DesignToolCall } from "./turns";

function ToolRow({ call }: { call: DesignToolCall }) {
  const { s } = useStrings();
  const [open, setOpen] = useState(false);
  const summary = summarizeArgs(call);
  const isTask = call.name === "task";
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: "none",
          border: 0,
          background: "transparent",
          cursor: "default",
          padding: "8px 0",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: palette.muted,
          textAlign: "left",
          fontFamily: type.mono,
          fontSize: 10.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          transition: "color 200ms ease",
          minWidth: 0,
          width: "100%",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = palette.text;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = palette.muted;
        }}
      >
        <Chevron open={open} color="currentColor" />
        <span style={{ color: palette.accent, flexShrink: 0 }}>
          {call.name || "tool"}
        </span>
        <span
          style={{
            letterSpacing: "0.01em",
            textTransform: "none",
            fontFamily: type.ui,
            fontSize: 12,
            color: palette.muted,
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        <span
          style={{
            color: call.pending ? palette.accent : palette.faint,
            fontSize: 9.5,
            letterSpacing: "0.18em",
            flexShrink: 0,
          }}
        >
          {call.pending ? "…" : "✓"}
        </span>
      </button>
      {open && (
        <div
          style={{
            paddingLeft: 20,
            paddingBottom: 14,
            paddingTop: 2,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
            animation: "logos-rise 320ms cubic-bezier(.22,.61,.36,1) both",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 9,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 6,
              }}
            >
              {s.tool.args}
            </div>
            <ToolArgsBody call={call} isTask={isTask} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 9,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 6,
              }}
            >
              {s.tool.result}
            </div>
            <ToolResultBody call={call} isTask={isTask} />
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeArgs(call: DesignToolCall): string {
  // Best-effort one-line description so the collapsed row carries some
  // information without forcing the user to expand each tool. Picks the
  // most "queryish" arg if present, else falls back to a key list.
  const a = call.args;
  if (typeof a.subagent_type === "string") return a.subagent_type;
  if (typeof a.query === "string") return a.query;
  if (typeof a.q === "string") return a.q;
  if (typeof a.citation === "string") return a.citation;
  if (typeof a.author === "string") return a.author;
  if (typeof a.work === "string") return a.work;
  if (typeof a.name === "string") return a.name;
  const keys = Object.keys(a);
  if (keys.length === 0) return "—";
  return keys.slice(0, 3).join(" · ");
}

function ToolArgsBody({ call, isTask }: { call: DesignToolCall; isTask: boolean }) {
  if (isTask) {
    const desc = typeof call.args.description === "string" ? call.args.description : "";
    const target =
      typeof call.args.subagent_type === "string" ? call.args.subagent_type : "—";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <div
          style={{
            fontFamily: type.mono,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: palette.muted,
          }}
        >
          target: <span style={{ color: palette.text }}>{target}</span>
        </div>
        <div className="logos-tool-md" style={{ minWidth: 0 }}>
          <MarkdownText>{desc}</MarkdownText>
        </div>
      </div>
    );
  }
  return (
    <pre
      style={{
        margin: 0,
        fontFamily: type.mono,
        fontSize: 12,
        lineHeight: 1.5,
        color: palette.text,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {JSON.stringify(call.args, null, 2)}
    </pre>
  );
}

function ToolResultBody({ call, isTask }: { call: DesignToolCall; isTask: boolean }) {
  const { s } = useStrings();
  if (call.pending) {
    return (
      <span
        style={{
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: palette.faint,
        }}
      >
        {s.thinking.inProgress}
      </span>
    );
  }
  if (isTask && call.rawResult) {
    return (
      <div
        className="logos-tool-md"
        style={{
          minWidth: 0,
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 8,
        }}
      >
        <MarkdownText>{call.rawResult}</MarkdownText>
      </div>
    );
  }
  const j = call.jsonResult;
  if (j && typeof j === "object") {
    return (
      <pre
        style={{
          margin: 0,
          fontFamily: type.mono,
          fontSize: 12,
          lineHeight: 1.5,
          color: palette.text,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxHeight: 360,
          overflowY: "auto",
        }}
      >
        {JSON.stringify(j, null, 2)}
      </pre>
    );
  }
  return (
    <div
      style={{
        fontFamily: type.ui,
        fontSize: 13,
        lineHeight: 1.55,
        color: palette.text,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      {call.rawResult ?? "—"}
    </div>
  );
}

interface Props {
  toolCalls: DesignToolCall[];
  /** True while this turn is still in flight. Auto-expands the trace,
   *  swaps the header to "step N of M". */
  inProgress: boolean;
}

export function ThinkingTrace({ toolCalls, inProgress }: Props) {
  const { s } = useStrings();
  // null = follow auto. After the user clicks once we honour their choice.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen != null ? userOpen : inProgress;

  if (toolCalls.length === 0) return null;
  const doneCount = toolCalls.filter((c) => !c.pending).length;
  const headerLabel = inProgress
    ? s.thinking.stepOf(Math.max(doneCount, 1), toolCalls.length)
    : s.thinking.done(toolCalls.length);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        style={{
          appearance: "none",
          border: 0,
          background: "transparent",
          cursor: "default",
          padding: "10px 0",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: palette.muted,
          textAlign: "left",
          fontFamily: type.mono,
          fontSize: 10.5,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          borderTop: `0.5px solid ${palette.hairline}`,
          borderBottom: open ? `0.5px solid ${palette.hairline}` : "none",
          transition: "color 200ms ease, border-color 320ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = palette.text;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = palette.muted;
        }}
      >
        <Chevron open={open} color="currentColor" />
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: inProgress ? palette.accent : palette.faint,
            opacity: inProgress ? 1 : 0.5,
            animation: inProgress ? "logos-pulse 1.4s ease-in-out infinite" : "none",
            flexShrink: 0,
          }}
        />
        <span>{headerLabel}</span>
      </button>

      {open && (
        <div
          style={{
            paddingLeft: 20,
            marginLeft: 4,
            borderLeft: `0.5px solid ${palette.hairline}`,
            display: "flex",
            flexDirection: "column",
            animation: "logos-rise 320ms cubic-bezier(.22,.61,.36,1) both",
          }}
        >
          {toolCalls.map((tc) => (
            <ToolRow key={tc.id} call={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
