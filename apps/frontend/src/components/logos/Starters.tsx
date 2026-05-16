"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export function Starters({ onPick }: { onPick: (text: string) => void }) {
  const { s } = useStrings();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 10,
        maxWidth: "min(720px, 92vw)",
      }}
    >
      {s.starters.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          style={{
            appearance: "none",
            cursor: "default",
            border: `0.5px solid ${palette.hairline}`,
            background: "transparent",
            color: palette.muted,
            fontFamily: type.ui,
            fontSize: 12.5,
            lineHeight: 1.4,
            padding: "8px 14px",
            borderRadius: 999,
            letterSpacing: "0.01em",
            transition: "color 240ms ease, border-color 240ms ease, background 240ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.text;
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
            e.currentTarget.style.background = "rgba(255,255,255,0.03)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.muted;
            e.currentTarget.style.borderColor = palette.hairline;
            e.currentTarget.style.background = "transparent";
          }}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
