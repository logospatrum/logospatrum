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
  // the space ABOVE the fixed Monolith (mobile only — see the
  // computed-style gate below).
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

  // One-shot flag: keep chips visually suppressed (visibility: hidden,
  // layout reserved) until the first measure+trim pass settles. Without
  // it, the SSR HTML renders all 4 chips, the user stares at them for
  // ~1s while JS loads, then hydration trims them down to fit — a
  // "4 chips appear then half disappear" flash. The flag stays true
  // after the first stable pass (we don't re-hide on resize because
  // a flicker-then-stable cycle on every resize feels worse than the
  // brief overflow that the resize handler corrects within one frame).
  const [measured, setMeasured] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const monolith = document.querySelector(
      ".logos-monolith",
    ) as HTMLElement | null;
    if (!monolith) {
      // No monolith on the page (shouldn't happen, but defensive) —
      // nothing to bump against, render whatever count we have.
      if (!measured) setMeasured(true);
      return;
    }
    // The trim logic only makes sense when the Monolith is
    // overlay-positioned. On desktop it's a static flex sibling
    // ABOVE us in the column, so `monolith.top` is way above our
    // bottom and the original logic would clip us to 1 chip even
    // though there's plenty of room beneath the input. CSS flips
    // the Monolith to position: fixed only under `@media (max-width:
    // 640px)` (see logos.css ".logos-monolith[data-mode='home']").
    const monolithPos = window.getComputedStyle(monolith).position;
    if (monolithPos !== "fixed") {
      if (!measured) setMeasured(true);
      return;
    }
    const limit = monolith.getBoundingClientRect().top - 12;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > limit && count > 1) {
      setCount((c) => c - 1);
      return; // re-run after re-render; don't reveal yet
    }
    if (!measured) setMeasured(true);
  }, [count, order, measured]);

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
        // Hide chips until the first measure pass is done. visibility:
        // hidden preserves layout (so the home column doesn't shift
        // around once chips appear), which is what we want.
        visibility: measured ? "visible" : "hidden",
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
