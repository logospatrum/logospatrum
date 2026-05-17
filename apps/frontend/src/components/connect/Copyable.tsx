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
          padding: "2px 8px",
          background: copied ? palette.text : "transparent",
          border: `1px solid ${palette.faint}`,
          borderRadius: 3,
          color: copied ? palette.bg : palette.text,
          fontFamily: type.mono,
          fontSize: 11,
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
      >
        {copied ? "✓" : "📋"}
      </button>
    </div>
  );
}
