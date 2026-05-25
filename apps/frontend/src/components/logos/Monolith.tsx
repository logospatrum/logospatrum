"use client";

import { useEffect, useRef, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { StyleSelect } from "./StyleSelect";
import type { StyleId } from "./styles";

interface Props {
  /** Called when the user hits Enter (without shift) or clicks the send arrow. */
  onSubmit: (text: string) => void;
  /** True while the stream is mid-response — flips the button to a pulsing
   *  dot and (if `onStop` is provided) makes clicking it stop the stream. */
  busy: boolean;
  /** Optional stop handler. When set, clicking the button while `busy` calls it. */
  onStop?: () => void;
  /** Bubbles focus state up so the home view can dim the cursor light
   *  while the user composes. */
  onFocusChange?: (focused: boolean) => void;
  /** External prefill (e.g. from LibraryBrowser → "ask about this work"). */
  prefill?: string;
  /** Currently selected response-style preset (forwarded to the backend
   *  via config.configurable.style_id on every submit). */
  styleId: StyleId;
  /** Setter for the response-style preset. */
  onStyleChange: (id: StyleId) => void;
}

export function Monolith({ onSubmit, busy, onStop, onFocusChange, prefill, styleId, onStyleChange }: Props) {
  const { s } = useStrings();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    onFocusChange?.(focused);
  }, [focused, onFocusChange]);

  // Listen for prefill events (LibraryBrowser dispatches them when the
  // user clicks "ask about this work"). Replace whatever's in the field —
  // matches the previous frontend's behaviour for parity.
  useEffect(() => {
    if (prefill !== undefined) setValue(prefill);
  }, [prefill]);

  // Auto-grow up to a ceiling.
  useEffect(() => {
    const t = taRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 200) + "px";
  }, [value]);

  const send = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div
      className="logos-monolith-card"
      style={{
        position: "relative",
        // Sit above the ScrollToBottom pill (zIndex 6 in the same wrapper).
        // backdrop-filter + transform on this div already establish a
        // stacking context — without an explicit z-index it would stack
        // at z=auto≈0, and the StyleSelect popover (z=50 inside this
        // context) would paint *below* the pill at the outer-context
        // level. Bumping to 7 puts the whole Monolith context (popover
        // included) above the pill when it opens upward.
        zIndex: 7,
        width: "min(720px, 92vw)",
        borderRadius: 20,
        background: `linear-gradient(180deg,
          color-mix(in oklab, ${palette.surfaceHi} 96%, transparent),
          color-mix(in oklab, ${palette.surface}   96%, transparent))`,
        // Heavy drop shadows are overridden on mobile (@media) to a thin
        // hairline-only frame — see `.logos-monolith-card` in logos.css.
        boxShadow: `
          0 1px 0 rgba(${palette.light}, 0.06) inset,
          0 0 0 0.5px ${palette.hairline} inset,
          0 30px 80px rgba(0,0,0,0.55),
          0 8px 24px rgba(0,0,0,0.35)`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        transition: "box-shadow 400ms ease, transform 400ms ease",
        transform: focused ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      {/* Internal volumetric glow — a faint center light, like a candle
          behind stone. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 20,
          pointerEvents: "none",
          background: `radial-gradient(60% 80% at 50% 120%,
            rgba(${palette.light}, ${focused ? 0.10 : 0.05}) 0%,
            rgba(${palette.light}, 0) 70%)`,
          transition: "background 600ms ease",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          top: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${palette.hairline}, transparent)`,
        }}
      />

      {/* Textarea row — avatar (desktop only) + transparent textarea.
          The textarea now blends into the card surface: no dark fill,
          no inset border, no focus-state background flip. The cursor
          itself is the input affordance; the card's subtle
          translateY(-1px) on focus gives global feedback.
          `.logos-monolith-row` styling lives in logos.css. */}
      <div className="logos-monolith-row">
        {/* Greek sigil — the system speaks first. Hidden on mobile via
            `.logos-monolith-avatar { display: none }` media query. */}
        <div
          className="logos-monolith-avatar"
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            fontFamily: type.logo,
            fontSize: 18,
            fontWeight: 300,
            color: palette.muted,
            boxShadow: `inset 0 0 0 0.5px ${palette.hairline}`,
          }}
        >
          Σ
        </div>

        <textarea
          ref={taRef}
          className="logos-monolith-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          /* Single placeholder text — switching between long/short by
             `useMediaQuery` caused an SSR-vs-hydration content swap on
             mobile. The longer line wraps fine inside the taller mobile
             textarea (min-height 64px = ~2 lines visible). */
          placeholder={s.chat.placeholder}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            border: 0,
            outline: 0,
            background: "transparent",
            color: palette.text,
            caretColor: palette.accent,
            fontFamily: type.ui,
            fontSize: 17,
            lineHeight: 1.5,
            letterSpacing: "0.005em",
            padding: "10px 0",
            minHeight: 40,
            maxHeight: 200,
          }}
        />
      </div>

      {/* Controls strip — sits BELOW the textarea on the card surface
          (out of the input itself). Style picker left, send right. Same
          structure on desktop and mobile; the desktop variant just gets
          slightly larger spacing. */}
      <div className="logos-monolith-controls">
        <div className="logos-monolith-controls-style">
          <StyleSelect styleId={styleId} onChange={onStyleChange} />
        </div>
        <button
          type="button"
          className="logos-monolith-send"
          onClick={busy && onStop ? onStop : send}
          disabled={!busy && !value.trim()}
          aria-label={busy ? s.chat.stopAria : s.chat.sendAria}
          style={{
            flexShrink: 0,
            appearance: "none",
            border: 0,
            cursor: "default",
            borderRadius: "50%",
            background: busy
              ? palette.accent
              : value.trim()
                ? palette.accent
                : "transparent",
            color: value.trim() || busy ? palette.bg : palette.faint,
            boxShadow: `inset 0 0 0 0.5px ${palette.hairline}`,
            display: "grid",
            placeItems: "center",
            transition: "background 280ms ease, color 280ms ease",
          }}
        >
          {busy ? (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "currentColor",
                animation: "logos-pulse 1.4s ease-in-out infinite",
              }}
            />
          ) : (
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Footer captions — keyboard hint + safety note. Desktop only;
          hidden on mobile by `.logos-monolith-footer { display: none }`. */}
      <div
        className="logos-monolith-footer"
        style={{
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
        }}
      >
        <span className="logos-monolith-footer-enter" style={{ padding: "0 8px" }}>
          {s.chat.enterHint}
        </span>
        <span className="logos-monolith-footer-safety" style={{ padding: "0 8px" }}>
          {s.chat.safety}
        </span>
      </div>
    </div>
  );
}
