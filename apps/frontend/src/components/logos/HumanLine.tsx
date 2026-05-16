"use client";

import { useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

interface Props {
  text: string;
  /** Editing is only enabled if this prop is provided. */
  onEdit?: (newText: string) => void;
}

export function HumanLine({ text, onEdit }: Props) {
  const { s } = useStrings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (editing) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontFamily: type.ui,
          fontSize: 14.5,
          lineHeight: 1.6,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            border: `0.5px solid ${palette.hairline}`,
            outline: 0,
            background: palette.surface,
            color: palette.text,
            fontFamily: type.ui,
            fontSize: 14.5,
            lineHeight: 1.5,
            padding: "10px 12px",
            borderRadius: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
            style={pillStyle(palette, type, false)}
          >
            {s.chat.cancelEdit}
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed || trimmed === text) {
                setEditing(false);
                return;
              }
              onEdit?.(trimmed);
              setEditing(false);
            }}
            style={pillStyle(palette, type, true)}
          >
            {s.chat.saveEdit}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        fontFamily: type.ui,
        fontSize: 14.5,
        lineHeight: 1.6,
        color: palette.muted,
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
      }}
      className="logos-human"
    >
      <div
        style={{
          flexShrink: 0,
          marginTop: 2,
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
        }}
      >
        {s.chat.you}
      </div>
      <div style={{ color: palette.text, whiteSpace: "pre-wrap", flex: 1 }}>{text}</div>
      {onEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
          aria-label={s.chat.editAria}
          className="logos-human-edit"
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            color: palette.faint,
            cursor: "default",
            padding: "2px 6px",
            fontFamily: type.mono,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0,
            transition: "opacity 200ms ease, color 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.faint;
          }}
        >
          {s.chat.edit}
        </button>
      )}
    </div>
  );
}

function pillStyle(p: typeof palette, t: typeof type, primary: boolean) {
  return {
    appearance: "none" as const,
    border: `0.5px solid ${p.hairline}`,
    background: primary ? "rgba(255,255,255,0.06)" : "transparent",
    color: primary ? p.text : p.muted,
    fontFamily: t.mono,
    fontSize: 10,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    padding: "8px 14px",
    borderRadius: 999,
    cursor: "default" as const,
  };
}
