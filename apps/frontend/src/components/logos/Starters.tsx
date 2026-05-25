"use client";

import { useEffect, useState } from "react";
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

  // No trim, no visibility gating. The earlier "measure and drop chips
  // that don't fit" loop fought CSS layout and made the home column
  // feel broken on small screens (chips silently vanished and the
  // scrollbar had nothing to grab). The home column now scrolls
  // natively when chips overflow, and `padding-bottom` is sized off
  // the live Monolith rect (--monolith-clearance set by
  // useMonolithClearance in LogosShell) so chips never slide under
  // the fixed input.
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
      {order.map((p) => (
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
