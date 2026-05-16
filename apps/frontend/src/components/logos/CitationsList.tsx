"use client";

import { useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import type {
  ReadPassageFailure,
  ReadPassageResult,
  ReadPassageSuccess,
} from "@/components/citation-card";
import type { DesignToolCall } from "./turns";

// Mirrors the type guard in `components/thread/messages/tool-calls.tsx` so
// the same payload shape rules apply here. Kept private to this file —
// the guard's logic is small and inlined where used.
function looksLikeReadPassage(value: unknown): value is ReadPassageResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    v.found === false &&
    typeof v.error === "string" &&
    typeof v.citation === "string"
  ) {
    return true;
  }
  return (
    typeof v.text === "string" &&
    typeof v.para_start === "number" &&
    typeof v.window_size === "number" &&
    "author" in v &&
    "work_title" in v
  );
}

function paraLabel(d: ReadPassageSuccess): string {
  return d.window_size === 1
    ? `§${d.para_start}`
    : `§${d.para_start}-${d.para_start + d.window_size - 1}`;
}

function chapterLabel(d: ReadPassageSuccess): string | null {
  if (d.chapter_title) return d.chapter_title;
  if (d.chapter_num) return `гл. ${d.chapter_num}`;
  return null;
}

function CitationRowSuccess({
  d,
  idx,
}: {
  d: ReadPassageSuccess;
  idx: number;
}) {
  const { s } = useStrings();
  const [open, setOpen] = useState(false);
  const ref = [chapterLabel(d), paraLabel(d)].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${idx * 80}ms`,
      }}
    >
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: palette.accent,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        [{idx + 1}]
      </div>
      <div>
        <div
          style={{
            fontFamily: type.quote,
            fontStyle: "italic",
            fontSize: "clamp(15px, 1.2vw, 17px)",
            lineHeight: 1.55,
            color: palette.text,
            marginBottom: 6,
            textWrap: "pretty",
            whiteSpace: "pre-wrap",
          }}
        >
          «{d.text}»
        </div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: palette.muted,
          }}
        >
          {d.author && <span style={{ color: palette.text }}>{d.author}</span>}
          {d.author && d.work_title && " · "}
          {d.work_title}
        </div>
        {(d.context_before || d.context_after) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{
              appearance: "none",
              border: 0,
              background: "transparent",
              cursor: "default",
              padding: "8px 0 0",
              color: palette.faint,
              fontFamily: type.mono,
              fontSize: 9.5,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              transition: "color 200ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = palette.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = palette.faint;
            }}
          >
            <span>{open ? s.citation.contextHide : s.citation.contextShow}</span>
          </button>
        )}
        {open && (
          <div
            style={{
              borderLeft: `1px solid ${palette.hairline}`,
              paddingLeft: 12,
              marginTop: 8,
              fontFamily: type.quote,
              fontStyle: "italic",
              fontSize: 13,
              lineHeight: 1.55,
              color: palette.muted,
              whiteSpace: "pre-wrap",
            }}
          >
            {d.context_before && <div>{d.context_before}</div>}
            {d.context_before && d.context_after && <div style={{ height: 6 }} />}
            {d.context_after && <div>{d.context_after}</div>}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
          textAlign: "right",
          lineHeight: 1.6,
        }}
      >
        {ref && <div>{ref}</div>}
        {d.source_url && (
          <div style={{ marginTop: 6 }}>
            <a
              href={d.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: palette.muted,
                textDecoration: "none",
                borderBottom: `0.5px solid ${palette.hairline}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = palette.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = palette.muted;
              }}
            >
              {s.citation.sourceLabel} ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function CitationRowError({ d, idx }: { d: ReadPassageFailure; idx: number }) {
  const { s } = useStrings();
  // Same diagnostic phrasing as the existing CitationCardError — keeps the
  // agent-feedback message stable so backend changes in `read_passage`
  // need only be updated in one place semantically.
  const explain =
    d.work_exists === false
      ? "Похоже, агент сократил slug. Попроси: «возьми citation из результатов поиска буква-в-букву»."
      : d.work_exists === true
        ? "Труд найден, но такого параграфа нет — глава/номер ошибочны."
        : "Citation не разобрался — нужен формат author_slug/work_slug/NNNN/pX.";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${idx * 80}ms`,
        opacity: 0.85,
      }}
    >
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 11,
          letterSpacing: "0.12em",
          color: palette.faint,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        [{idx + 1}]
      </div>
      <div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 13,
            lineHeight: 1.55,
            color: palette.text,
            marginBottom: 6,
          }}
        >
          {s.citation.notFound}
        </div>
        <div
          style={{
            fontFamily: type.mono,
            fontSize: 11,
            color: palette.muted,
            wordBreak: "break-all",
            marginBottom: 6,
          }}
        >
          {d.citation}
        </div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 12,
            color: palette.muted,
            lineHeight: 1.55,
          }}
        >
          {explain}
        </div>
      </div>
      <div />
    </div>
  );
}

export function CitationsList({ toolCalls }: { toolCalls: DesignToolCall[] }) {
  // Collect every read_passage result we can recognize. We accept whatever
  // tool name the backend actually uses ("read_passage") but also fall
  // through to the shape-check so renames don't silently break the list.
  const passages = toolCalls
    .filter((tc) => tc.name === "read_passage" || looksLikeReadPassage(tc.jsonResult))
    .map((tc) => tc.jsonResult as ReadPassageResult)
    .filter((d): d is ReadPassageResult => looksLikeReadPassage(d));

  if (passages.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderTop: `0.5px solid ${palette.hairline}`,
        animation: "logos-rise 900ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: "120ms",
      }}
    >
      {passages.map((p, i) =>
        p.found === false ? (
          <CitationRowError key={`c-${i}`} d={p} idx={i} />
        ) : (
          <CitationRowSuccess key={`c-${i}`} d={p} idx={i} />
        ),
      )}
    </div>
  );
}
