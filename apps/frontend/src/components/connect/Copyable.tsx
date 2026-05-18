"use client";

import { useState } from "react";
import { toast } from "sonner";
import { palette, type } from "@/components/logos/tokens";
import { useStrings } from "@/components/logos/i18n";

export interface CopyableProps {
  /** Text to display + copy to clipboard. Multi-line OK. */
  text: string;
  /** Optional aria-label override for the copy button. */
  copyAriaLabel?: string;
}

/**
 * Code-block with a copy-to-clipboard button. Shown inside the Connect
 * modal for `claude mcp add` / plugin-install commands and JSON snippets.
 *
 * Toast feedback via Sonner (already mounted in apps/frontend/src/app/page.tsx
 * via the existing Toaster).
 */
export function Copyable({ text, copyAriaLabel }: CopyableProps) {
  const { s } = useStrings();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(s.connect.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  return (
    <div
      style={{
        position: "relative",
        background: palette.bgDeep,
        border: `1px solid ${palette.faint}`,
        borderRadius: 4,
        padding: "12px 44px 12px 14px",
        fontFamily: type.mono,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: palette.text,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {text}
      <button
        onClick={onCopy}
        aria-label={copyAriaLabel ?? s.connect.copyAria}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: copied ? palette.text : "transparent",
          border: `1px solid ${palette.faint}`,
          borderRadius: 4,
          color: copied ? palette.bg : palette.muted,
          cursor: "pointer",
          transition: "color 160ms ease, background 160ms ease, border-color 160ms ease",
        }}
        onMouseEnter={(e) => {
          if (copied) return;
          e.currentTarget.style.color = palette.text;
          e.currentTarget.style.borderColor = palette.muted;
        }}
        onMouseLeave={(e) => {
          if (copied) return;
          e.currentTarget.style.color = palette.muted;
          e.currentTarget.style.borderColor = palette.faint;
        }}
      >
        {copied ? (
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 7.5L5.5 11L12 3.5"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect
              x={3.25}
              y={3.25}
              width={7.5}
              height={7.5}
              rx={1.2}
              stroke="currentColor"
              strokeWidth={1.1}
            />
            <path
              d="M5.5 1.75h4.25a2 2 0 0 1 2 2V8"
              stroke="currentColor"
              strokeWidth={1.1}
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
