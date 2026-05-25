"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

// Fisher-Yates shuffle, returns a new array. Pure — caller decides when
// it's safe to call (SSR can't randomise without a hydration mismatch).
function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function Starters({ onPick }: { onPick: (text: string) => void }) {
  const { s } = useStrings();
  // SSR + first client render: keep the i18n order so HTML matches.
  // On mount we re-shuffle (client-only) so each page load shows a
  // different random pick first.
  const [order, setOrder] = useState<readonly string[]>(s.starters);
  useEffect(() => {
    setOrder(shuffle(s.starters));
  }, [s.starters]);

  // Count of chips actually rendered. Starts at "all"; the layout
  // effect below trims it down one at a time until the chips fit in
  // the space ABOVE the fixed Monolith (which can otherwise cover the
  // last row on short viewports).
  const [count, setCount] = useState<number>(s.starters.length);
  // Reset count to "all" on each resize / starter-list change — the
  // layout effect will re-trim from the top. This is what allows the
  // user to e.g. rotate a phone landscape and see more chips reappear.
  useEffect(() => {
    setCount(s.starters.length);
    if (typeof window === "undefined") return undefined;
    const onResize = () => setCount(s.starters.length);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [s.starters]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // After each render, measure: if the chip row bottom extends past the
  // Monolith's top (with a small breathing-room gap), drop one chip and
  // re-render. Converges in at most s.starters.length iterations.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const monolith = document.querySelector(".logos-monolith");
    const limit = monolith
      ? monolith.getBoundingClientRect().top - 12
      : window.innerHeight - 150;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > limit && count > 1) {
      setCount((c) => c - 1);
    }
  }, [count, order]);

  const visible = order.slice(0, count);

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 10,
        maxWidth: "min(720px, 92vw)",
      }}
    >
      {visible.map((p) => (
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
