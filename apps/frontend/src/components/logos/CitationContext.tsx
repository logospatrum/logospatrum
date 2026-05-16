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
      el.setAttribute("data-flash", "true");
      window.setTimeout(() => el.removeAttribute("data-flash"), 800);
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
