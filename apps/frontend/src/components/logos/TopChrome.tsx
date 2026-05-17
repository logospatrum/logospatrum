"use client";

import { palette, type } from "./tokens";
import { useStrings, type Lang } from "./i18n";
import { useMediaQuery } from "@/hooks/useMediaQuery";

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
  const isNarrow = useMediaQuery("(max-width: 640px)");
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        // Extra left pad — the sidebar trigger sits there.
        padding: isNarrow ? "16px 16px 16px 60px" : "26px 36px 26px 76px",
        fontFamily: type.mono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: palette.muted,
        pointerEvents: "none",
      }}
    >
      {!isNarrow && (
        <div
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
      )}
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto", marginLeft: isNarrow ? "auto" : 0 }}
      >
        {!isNarrow && librarySlot}
        {!isNarrow && connectSlot}

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

        {/* Light toggle */}
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
      </div>
    </header>
  );
}
