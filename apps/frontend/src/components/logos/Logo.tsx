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
        <span style={{ position: "relative", display: "inline-block" }}>
          ΛΟΓΟΣ
          {/* PATRUM / AI stack: absolutely positioned under ΛΟΓΟΣ, right-
              edge aligned to the right edge of the Greek letters. Absolute
              so it doesn't add to h1 height — keeps the 64px gap to Quote
              intact and prevents the Monolith/Quote below from shifting. */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "calc(100% - 2px)",
              // Offset by the parent's trailing letter-spacing so the right
              // edge of the stack aligns with the visible right edge of Σ
              // (not the box right edge, which includes the trailing tracking).
              right: type.logoTracking,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              fontFamily: type.mono,
              fontWeight: 400,
              color: palette.faint,
              WebkitTextStroke: "0",
              textShadow: "none",
              lineHeight: 0.95,
              letterSpacing: "0.08em",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: "0.18em", color: palette.muted }}>PATRUM</span>
            <span style={{ fontSize: "0.11em", marginTop: "0.55em" }}>AI</span>
          </span>
        </span>
        {/* Layout placeholder — preserves the original inline AI footprint
            so the h1's total width (and therefore the column-flex centering
            of ΛΟΓΟΣ) is exactly the same as before this change. */}
        <span
          aria-hidden="true"
          style={{
            fontFamily: type.mono,
            fontSize: "0.18em",
            fontWeight: 400,
            letterSpacing: "0.2em",
            marginLeft: "0.3em",
            verticalAlign: "baseline",
            visibility: "hidden",
          }}
        >
          AI
        </span>
      </h1>
    </div>
  );
}
