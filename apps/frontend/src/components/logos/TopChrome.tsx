"use client";

import { palette, type } from "./tokens";
import { useStrings, type Lang } from "./i18n";

interface Props {
  inChat: boolean;
  onHome: () => void;
  lightOn: boolean;
  onToggleLight: () => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  /** Optional slot for a Library trigger — rendered inline so the
   *  LibraryBrowser keeps its own Radix dialog while looking like part
   *  of the top chrome. */
  librarySlot?: React.ReactNode;
  /** Optional slot for the ConnectAgent trigger — same pattern as
   *  librarySlot. Rendered after the library pill. */
  connectSlot?: React.ReactNode;
}

export function TopChrome({
  inChat,
  onHome,
  lightOn,
  onToggleLight,
  lang,
  onLangChange,
  librarySlot,
  connectSlot,
}: Props) {
  const { s } = useStrings();
  // Layout (padding) + which decorations show (brand pip, library /
  // connect pills) are driven by `@media (max-width: 640px)` in
  // logos.css, NOT by `useMediaQuery`. The JS hook defaulted to `false`
  // on SSR and the first client render, which caused a visible
  // padding+content jump on mobile cold loads as soon as
  // `useEffect` flipped isNarrow to true.
  return (
    <header
      className="logos-top-chrome"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: type.mono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: palette.muted,
        pointerEvents: "none",
      }}
    >
      <div
        className="logos-top-chrome-brand"
        style={{ display: "flex", alignItems: "center", gap: 14, pointerEvents: "auto" }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: palette.accent,
            boxShadow: `0 0 12px ${palette.accent}`,
            opacity: 0.7,
          }}
        />
        <span>{s.brand}</span>
      </div>
      <div
        className="logos-top-chrome-right"
        style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto" }}
      >
        <span className="logos-top-chrome-library">{librarySlot}</span>
        <span className="logos-top-chrome-connect">{connectSlot}</span>

        {inChat && (
          <button
            type="button"
            onClick={onHome}
            aria-label={s.top.homeAria}
            style={{
              appearance: "none",
              border: 0,
              background: "transparent",
              color: palette.muted,
              cursor: "default",
              fontFamily: type.mono,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              transition: "color 240ms ease, background 240ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = palette.text;
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = palette.muted;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width={14} height={10} viewBox="0 0 14 10" fill="none">
              <path
                d="M5 1L1 5l4 4M1 5h12"
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{s.top.homeLabel}</span>
          </button>
        )}

        {/* Language toggle */}
        <div
          role="radiogroup"
          aria-label={s.top.langAria}
          style={{
            display: "inline-flex",
            border: `0.5px solid ${palette.hairline}`,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          {(["ru", "en"] as const).map((v) => {
            const on = lang === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onLangChange(v)}
                style={{
                  appearance: "none",
                  border: 0,
                  cursor: "default",
                  background: on ? "rgba(255,255,255,0.06)" : "transparent",
                  color: on ? palette.text : palette.faint,
                  fontFamily: type.mono,
                  fontSize: 10,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  padding: "8px 12px",
                  transition: "background 240ms ease, color 240ms ease",
                }}
              >
                {v}
              </button>
            );
          })}
        </div>

        {/* Light toggle — desktop-only (the mobile background is a
            static halo with no animated light, so the toggle would be
            a no-op there). Hidden via `.logos-top-chrome-light` in
            logos.css under @media (max-width: 640px) or (hover: none). */}
        <span className="logos-top-chrome-light" style={{ display: "inline-flex" }}>
          <button
            type="button"
            onClick={onToggleLight}
            role="switch"
            aria-checked={lightOn}
            aria-label={lightOn ? s.top.lightOnAria : s.top.lightOffAria}
            style={{
              appearance: "none",
              border: `0.5px solid ${palette.hairline}`,
              background: "transparent",
              cursor: "default",
              color: lightOn ? palette.text : palette.faint,
              fontFamily: type.mono,
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px 8px 10px",
              borderRadius: 999,
              transition: "color 320ms ease, border-color 320ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = palette.hairline;
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: lightOn ? palette.accent : "transparent",
                boxShadow: lightOn ? `0 0 10px ${palette.accent}` : "none",
                border: `0.5px solid ${lightOn ? "transparent" : palette.faint}`,
                transition:
                  "background 320ms ease, box-shadow 320ms ease, border-color 320ms ease",
              }}
            />
            <span>{s.top.lightLabel}</span>
          </button>
        </span>
      </div>
    </header>
  );
}
