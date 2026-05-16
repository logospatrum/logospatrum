"use client";

import { useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { Chevron } from "./Chevron";
import type { DesignToolCall } from "./turns";

function ToolRow({ call }: { call: DesignToolCall }) {
  const { s } = useStrings();
  const [open, setOpen] = useState(false);
  const summary = summarizeArgs(call);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = palette.text;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = palette.muted;
        }}
      >
        <Chevron open={open} color="currentColor" />
        <span style={{ color: palette.accent }}>{call.name || "tool"}</span>
        <span
          style={{
            letterSpacing: "0.01em",
            textTransform: "none",
            fontFamily: type.ui,
            fontSize: 12,
            color: palette.muted,
          }}
        >
          {summary}
        </span>
        <span
          style={{
            marginLeft: "auto",
            color: call.pending ? palette.accent : palette.faint,
            fontSize: 9.5,
            letterSpacing: "0.18em",
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
            animation: "logos-rise 320ms cubic-bezier(.22,.61,.36,1) both",
          }}
        >
          <div>
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
            <pre
              style={{
                margin: 0,
                fontFamily: type.mono,
                fontSize: 12,
                lineHeight: 1.5,
                color: palette.text,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          <div>
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
            <ToolResultBody call={call} />
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

function ToolResultBody({ call }: { call: DesignToolCall }) {
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
          wordBreak: "break-word",
          maxHeight: 280,
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
