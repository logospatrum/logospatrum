"use client";

import { useEffect, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { GitHubSVG } from "@/components/icons/github";

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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 16, pointerEvents: "auto" }}>
        {s.bottom.corpus}
        <a
          href="https://github.com/logospatrum/logospatrum"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.bottom.githubAria}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "inherit",
            textDecoration: "none",
            opacity: 0.7,
            transition: "opacity 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
        >
          <span style={{ width: 12, height: 12, display: "inline-block" }}>
            <GitHubSVG width="100%" height="100%" />
          </span>
          {s.bottom.github}
        </a>
      </span>
      <span>
        Σ &nbsp;·&nbsp; {hh}:{mm} &nbsp;·&nbsp; v 0.5
      </span>
    </footer>
  );
}
