"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export function Quote({ show }: { show: boolean }) {
  const { s } = useStrings();
  // Padding (`72px 140px` on desktop, `32px 20px` on `@media
  // (max-width: 640px)`) is set via `.logos-quote-figure` in logos.css.
  // Moved off `useMediaQuery` to avoid the SSR-vs-hydration shift that
  // collapsed the halo from desktop spacing to mobile spacing after JS
  // loaded.
  return (
    <figure
      className="logos-quote-figure"
      style={{
        position: "relative",
        margin: 0,
        textAlign: "center",
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(-6px)",
        transition: "opacity 800ms ease, transform 800ms ease",
        pointerEvents: show ? "auto" : "none",
        height: show ? "auto" : 0,
        overflow: show ? "visible" : "hidden",
      }}
    >
      {/* Soft dark halo for readability over the lit rock. closest-side
          keeps the gradient inside the box's inscribed ellipse so the
          rectangular corners stay fully transparent. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse closest-side at 50% 50%, " +
            "rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.92) 38%, " +
            "rgba(0,0,0,0.70) 68%, rgba(0,0,0,0.30) 88%, rgba(0,0,0,0) 100%)",
          filter: "blur(2px)",
        }}
      />
      <blockquote
        style={{
          position: "relative",
          zIndex: 1,
          margin: 0,
          padding: 0,
          fontFamily: type.quote,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: "clamp(17px, 1.6vw, 22px)",
          lineHeight: 1.55,
          letterSpacing: "0.005em",
          color: palette.text,
          maxWidth: "32ch",
          marginInline: "auto",
          textWrap: "balance",
          userSelect: "none",
        }}
      >
        {s.quote.line1}
        <br />
        {s.quote.line2}
      </blockquote>
      <figcaption
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 14,
          fontFamily: type.mono,
          fontSize: 10.5,
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: palette.muted,
          userSelect: "none",
        }}
      >
        {s.quote.ref}
      </figcaption>
    </figure>
  );
}
