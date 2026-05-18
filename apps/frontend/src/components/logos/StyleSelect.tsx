"use client";

import { useEffect, useRef, useState } from "react";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { STYLE_PRESETS, type StyleId } from "./styles";

interface Props {
  styleId: StyleId;
  onChange: (id: StyleId) => void;
}

/** Compact pill in the Monolith bottom row that opens a vertical popover with
 *  the 4 response-style presets. No external popover dep — we don't need full
 *  Radix keyboard nav for 4 options, and the inline-style aesthetic matches
 *  the rest of the Logos shell (see apps/frontend/CLAUDE.md "Gotchas"). */
export function StyleSelect({ styleId, onChange }: Props) {
  const { s, lang } = useStrings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape to close. Mirrors LangContext/LightToggle patterns.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current =
    STYLE_PRESETS.find((p) => p.id === styleId) ?? STYLE_PRESETS[0];
  const triggerText = current.label[lang];

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={s.chat.style.triggerAria}
        style={{
          appearance: "none",
          border: 0,
          cursor: "default",
          background: "transparent",
          padding: "4px 10px",
          borderRadius: 999,
          color: palette.muted,
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          boxShadow: `inset 0 0 0 0.5px ${palette.hairline}`,
          transition: "color 200ms ease, box-shadow 200ms ease",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = palette.text;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = palette.muted;
        }}
      >
        <span aria-hidden="true" style={{ opacity: 0.6 }}>
          ▸
        </span>
        <span>{triggerText}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={s.chat.style.heading}
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            minWidth: 260,
            padding: "8px 0",
            borderRadius: 12,
            background: `linear-gradient(180deg,
              color-mix(in oklab, ${palette.surfaceHi} 96%, transparent),
              color-mix(in oklab, ${palette.surface}   96%, transparent))`,
            boxShadow: `
              0 1px 0 rgba(${palette.light}, 0.06) inset,
              0 0 0 0.5px ${palette.hairline} inset,
              0 20px 40px rgba(0,0,0,0.55),
              0 6px 16px rgba(0,0,0,0.35)`,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            zIndex: 50,
            animation: "logos-rise 220ms ease",
          }}
        >
          <div
            style={{
              padding: "4px 14px 8px",
              color: palette.faint,
              fontFamily: type.mono,
              fontSize: 9,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            {s.chat.style.heading}
          </div>
          {STYLE_PRESETS.map((p) => {
            const isActive = p.id === styleId;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  appearance: "none",
                  border: 0,
                  cursor: "default",
                  background: isActive
                    ? `color-mix(in oklab, ${palette.accent} 8%, transparent)`
                    : "transparent",
                  textAlign: "left",
                  padding: "8px 14px",
                  color: isActive ? palette.text : palette.muted,
                  fontFamily: type.ui,
                  transition: "background 160ms ease, color 160ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      `color-mix(in oklab, ${palette.accent} 4%, transparent)`;
                    (e.currentTarget as HTMLButtonElement).style.color =
                      palette.text;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color =
                      palette.muted;
                  }
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    letterSpacing: "0.005em",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 8,
                      textAlign: "center",
                      color: isActive ? palette.accent : "transparent",
                      fontSize: 12,
                    }}
                  >
                    ✓
                  </span>
                  {p.label[lang]}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: palette.faint,
                    marginTop: 2,
                    paddingLeft: 16,
                    fontFamily: type.ui,
                  }}
                >
                  {p.tagline[lang]}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
