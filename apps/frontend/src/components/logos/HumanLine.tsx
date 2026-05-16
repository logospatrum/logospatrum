"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export function HumanLine({ text }: { text: string }) {
  const { s } = useStrings();
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
      <div style={{ color: palette.text, whiteSpace: "pre-wrap" }}>{text}</div>
    </div>
  );
}
