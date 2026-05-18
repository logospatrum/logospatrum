"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface CitationContextValue {
  hoveredN: number | null;
  setHoveredN: (n: number | null) => void;
  scrollToN: (n: number) => void;
  turnKey: string;
}

const CitationCtx = createContext<CitationContextValue | undefined>(undefined);

/**
 * Per-turn provider. Owns hover + scroll-target wiring between inline
 * <CitationPill> and the rows in <CitationsList>. Each turn gets an
 * isolated namespace via `turnKey`, so row IDs never collide across turns.
 */
export function CitationProvider({
  turnKey,
  children,
}: {
  turnKey: string;
  children: ReactNode;
}) {
  const [hoveredN, setHoveredN] = useState<number | null>(null);

  const scrollToN = useCallback(
    (n: number) => {
      const el = document.getElementById(`${turnKey}-cite-${n}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });

      // Flash AFTER the smooth scroll settles, not at click time —
      // otherwise the 800ms animation overlaps the ~400-500ms scroll and
      // the row lands under the user's gaze with no highlight left.
      //
      // `scrollend` (Chrome 114+, Firefox 109+, Safari 17.4+) fires when
      // the scrolling element comes to rest. Listened on document in the
      // capture phase because scrollend doesn't bubble — but the capture
      // path still catches events from any descendant scroll container
      // (be it window or an inner overflow:auto div).
      let fired = false;
      const flash = () => {
        if (fired) return;
        fired = true;
        document.removeEventListener("scrollend", flash, true);
        el.setAttribute("data-flash", "true");
        window.setTimeout(() => el.removeAttribute("data-flash"), 800);
      };
      document.addEventListener("scrollend", flash, { capture: true, once: true });
      // Safety net: if the row was already in view, no scroll happens
      // → no scrollend. Also covers older browsers without the event.
      // 700ms is the typical upper bound for `scrollIntoView({smooth})`.
      window.setTimeout(flash, 700);
    },
    [turnKey],
  );

  const value = useMemo<CitationContextValue>(
    () => ({ hoveredN, setHoveredN, scrollToN, turnKey }),
    [hoveredN, scrollToN, turnKey],
  );
  return <CitationCtx.Provider value={value}>{children}</CitationCtx.Provider>;
}

export function useCitationContext(): CitationContextValue {
  const ctx = useContext(CitationCtx);
  if (!ctx)
    throw new Error("useCitationContext must be used inside <CitationProvider>");
  return ctx;
}
