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
  // Shuffle an INDEX permutation, not the strings themselves, and only
  // ONCE on mount. The earlier `[s.starters]` dep re-shuffled on every
  // language change — and since English chip strings are noticeably
  // shorter than Russian, a fresh shuffle could collapse chips from
  // two rows to one. Total content height dropped under the viewport
  // → no overflow → mobile scroll bar disappeared mid-session, which
  // the user read as "scroll disappeared on language switch". Stable
  // indices keep the chip ORDER (and therefore the wrapping layout)
  // identical across languages; only the visible strings change.
  const [indices, setIndices] = useState<readonly number[]>(() =>
    s.starters.map((_, i) => i),
  );
  useEffect(() => {
    setIndices(shuffle(s.starters.map((_, i) => i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Defensive bounds check in case the two language packs ever have
  // different chip counts — `.filter(Boolean)` drops out-of-range slots.
  const order = indices.map((i) => s.starters[i]).filter(Boolean);

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
