"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export function Logo() {
  const { s } = useStrings();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 10.5,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color: palette.faint,
          userSelect: "none",
        }}
      >
        {s.tagline}
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: type.logo,
          fontWeight: type.logoWeight,
          fontSize: type.logoSize,
          letterSpacing: type.logoTracking,
          // Trailing tracking pushes the optical center right; nudge back.
          paddingLeft: type.logoTracking,
          lineHeight: 0.95,
          color: palette.text,
          textShadow: `0 1px 0 rgba(0,0,0,0.4), 0 0 60px rgba(${palette.light}, 0.06)`,
          // Engraved feel — a hair of inner darkness on the strokes.
          WebkitTextStroke: "0.4px rgba(0,0,0,0.25)",
          userSelect: "none",
        }}
      >
        ΛΟΓΟΣ
      </h1>
    </div>
  );
}
