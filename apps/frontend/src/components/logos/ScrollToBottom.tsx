"use client";

import { palette, type } from "./tokens";
import { useStrings } from "./i18n";

interface Props {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottom({ visible, onClick }: Props) {
  const { s } = useStrings();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={s.chat.toBottomAria}
      style={{
        position: "absolute",
        bottom: 100,
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? 0 : 10}px)`,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 240ms ease, transform 240ms ease",
        zIndex: 6,
        appearance: "none",
        border: `0.5px solid ${palette.hairline}`,
        background: "rgba(0,0,0,0.6)",
        color: palette.muted,
        fontFamily: type.mono,
        fontSize: 10,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        padding: "8px 14px 8px 10px",
        borderRadius: 999,
        cursor: "default",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
        <path
          d="M2 5l4 4 4-4"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{s.chat.toBottom}</span>
    </button>
  );
}
