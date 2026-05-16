"use client";

import { useEffect, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

export interface SidebarThread {
  id: string;
  title: string;
}

interface Props {
  threads: SidebarThread[];
  activeId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({ threads, activeId, onPick, onNew }: Props) {
  const { s } = useStrings();
  const [hover, setHover] = useState(false);

  // Reveal the sidebar when the cursor approaches the left edge of the
  // viewport — a 24px "hot zone" wide enough to grab even on a trackpad.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.clientX <= 24) setHover(true);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <>
      {/* Collapsed icon — always visible, left edge, near the top. */}
      <button
        type="button"
        aria-label={s.sidebar.historyAria}
        onClick={() => setHover((v) => !v)}
        onMouseEnter={() => setHover(true)}
        style={{
          position: "fixed",
          left: 16,
          top: 24,
          zIndex: 14,
          appearance: "none",
          border: 0,
          cursor: "default",
          background: "transparent",
          color: palette.muted,
          width: 36,
          height: 36,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          transition: "color 240ms ease, background 240ms ease, opacity 240ms ease",
          opacity: hover ? 0 : 1,
          pointerEvents: hover ? "none" : "auto",
        }}
      >
        <svg width={18} height={14} viewBox="0 0 18 14" fill="none">
          <path
            d="M1 2h16M1 7h12M1 12h16"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </svg>
      </button>

      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 13,
          width: 300,
          transform: `translateX(${hover ? 0 : -320}px)`,
          transition: "transform 360ms cubic-bezier(.22,.61,.36,1)",
          background:
            "radial-gradient(ellipse closest-side at 30% 50%, " +
            "rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.90) 55%, " +
            "rgba(0,0,0,0.60) 80%, rgba(0,0,0,0) 100%)",
          padding: "78px 24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: palette.text,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: type.mono,
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: palette.faint,
          }}
        >
          <span>{s.sidebar.history}</span>
          <span>{threads.length}</span>
        </div>

        <button
          type="button"
          onClick={onNew}
          style={{
            appearance: "none",
            border: 0,
            cursor: "default",
            background: "transparent",
            color: palette.text,
            fontFamily: type.ui,
            fontSize: 13.5,
            letterSpacing: "0.01em",
            textAlign: "left",
            padding: "8px 4px",
            borderTop: `0.5px solid ${palette.hairline}`,
            borderBottom: `0.5px solid ${palette.hairline}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            transition: "color 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.text;
          }}
        >
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <path
              d="M6 1v10M1 6h10"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          </svg>
          <span>{s.sidebar.newChat}</span>
        </button>

        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.1) transparent",
          }}
        >
          {threads.length === 0 && (
            <div
              style={{
                fontFamily: type.quote,
                fontStyle: "italic",
                color: palette.faint,
                fontSize: 13.5,
                lineHeight: 1.6,
                padding: "12px 4px",
              }}
            >
              {s.sidebar.empty}
            </div>
          )}
          {threads.map((c) => {
            const active = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                style={{
                  appearance: "none",
                  border: 0,
                  cursor: "default",
                  background: active ? "rgba(255,255,255,0.05)" : "transparent",
                  color: active ? palette.text : palette.muted,
                  fontFamily: type.ui,
                  fontSize: 13,
                  lineHeight: 1.45,
                  textAlign: "left",
                  padding: "10px 10px",
                  borderRadius: 6,
                  transition: "color 200ms ease, background 200ms ease",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.color = palette.text;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.color = palette.muted;
                }}
              >
                {c.title}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
