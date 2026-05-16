"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import type { ReadPassageSuccess } from "@/components/citation-card";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passage: ReadPassageSuccess;
  highlightQuote: string;
}

/**
 * Modal with the full read_passage text and the agent's short quote
 * highlighted via <mark>. If the quote is not a verbatim substring of the
 * text, render text plain (soft fail — see spec edge cases).
 */
export function PassageModal({
  open,
  onOpenChange,
  passage,
  highlightQuote,
}: Props) {
  const { s } = useStrings();
  const idx = highlightQuote ? passage.text.indexOf(highlightQuote) : -1;
  const found = idx >= 0;

  const refLine = [
    passage.chapter_title
      ? passage.chapter_title
      : passage.chapter_num
        ? `гл. ${passage.chapter_num}`
        : null,
    passage.window_size === 1
      ? `§${passage.para_start}`
      : `§${passage.para_start}-${passage.para_start + passage.window_size - 1}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="logos-passage-modal-overlay" />
        <Dialog.Content className="logos-passage-modal-content">
          <Dialog.Title
            style={{
              fontFamily: type.logo,
              fontSize: 22,
              fontWeight: 400,
              color: palette.text,
              marginBottom: 4,
            }}
          >
            {passage.author}
          </Dialog.Title>
          <div
            style={{
              fontFamily: type.ui,
              fontSize: 14,
              color: palette.muted,
              marginBottom: 4,
            }}
          >
            {passage.work_title}
          </div>
          {refLine && (
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 18,
              }}
            >
              {refLine}
            </div>
          )}

          {passage.context_before && (
            <div
              style={{
                color: palette.muted,
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
                marginBottom: 14,
              }}
            >
              {passage.context_before}
            </div>
          )}

          <div style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>
            {found ? (
              <>
                {passage.text.slice(0, idx)}
                <mark>{highlightQuote}</mark>
                {passage.text.slice(idx + highlightQuote.length)}
              </>
            ) : (
              passage.text
            )}
          </div>

          {!found && highlightQuote && (
            <div
              style={{
                fontFamily: type.mono,
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: palette.faint,
                marginBottom: 14,
              }}
            >
              {s.citation.highlightNotFound}
            </div>
          )}

          {passage.context_after && (
            <div
              style={{
                color: palette.muted,
                fontStyle: "italic",
                whiteSpace: "pre-wrap",
                marginBottom: 14,
              }}
            >
              {passage.context_after}
            </div>
          )}

          {passage.source_url && (
            <div style={{ marginTop: 20 }}>
              <a
                href={passage.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: palette.muted,
                  textDecoration: "none",
                  borderBottom: `0.5px solid ${palette.hairline}`,
                  fontFamily: type.mono,
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {s.citation.sourceLabel} ↗
              </a>
            </div>
          )}

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close"
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                appearance: "none",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                color: palette.muted,
                fontSize: 18,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ✕
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
