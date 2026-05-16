"use client";

import { useEffect, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export function BottomChrome() {
  const { s } = useStrings();
  const [now, setNow] = useState<Date | null>(null);

  // Hydrate the clock on mount only — server-render shows an empty slot
  // so the time doesn't differ between SSR and client.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  return (
    <footer
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "20px 36px",
        fontFamily: type.mono,
        fontSize: 10.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: palette.faint,
        pointerEvents: "none",
      }}
    >
      <span>{s.bottom.corpus}</span>
      <span>
        Σ &nbsp;·&nbsp; {hh}:{mm} &nbsp;·&nbsp; v 0.5
      </span>
    </footer>
  );
}
