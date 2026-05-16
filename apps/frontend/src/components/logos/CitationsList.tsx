// apps/frontend/src/components/logos/CitationsList.tsx
"use client";

import { useMemo, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { useCitationContext } from "./CitationContext";
import { PassageModal } from "./PassageModal";
import type {
  ReadPassageFailure,
  ReadPassageSuccess,
} from "@/components/citation-card";
import type { DesignToolCall } from "./turns";
import type { CitationMarker } from "@/lib/citation-marker";

type RowKind =
  | { kind: "success"; marker: CitationMarker; rich: ReadPassageSuccess }
  | { kind: "error"; marker: CitationMarker; err: ReadPassageFailure };

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

function matchToolCall(
  toolCalls: DesignToolCall[],
  slug: string,
): DesignToolCall | undefined {
  return toolCalls.find(
    (tc) =>
      tc.name === "read_passage" &&
      typeof tc.args.citation === "string" &&
      tc.args.citation === slug,
  );
}

function buildRows(
  markers: CitationMarker[],
  toolCalls: DesignToolCall[],
): RowKind[] {
  return markers.map((m) => {
    const tc = matchToolCall(toolCalls, m.slug);
    if (!tc || tc.jsonResult == null) {
      return {
        kind: "error",
        marker: m,
        err: {
          found: false,
          error: "no matching read_passage call for this slug",
          citation: m.slug,
        } as ReadPassageFailure,
      };
    }
    const r = tc.jsonResult as ReadPassageSuccess | ReadPassageFailure;
    if (r.found === false) {
      return { kind: "error", marker: m, err: r };
    }
    return { kind: "success", marker: m, rich: r };
  });
}

function CitationRowSuccess({ row }: { row: Extract<RowKind, { kind: "success" }> }) {
  const { s } = useStrings();
  const { hoveredN, setHoveredN, turnKey } = useCitationContext();
  const [modalOpen, setModalOpen] = useState(false);
  const { marker, rich } = row;
  const ref = [chapterLabel(rich), paraLabel(rich)].filter(Boolean).join(" · ");
  const active = hoveredN === marker.n;

  return (
    <div
      id={`${turnKey}-cite-${marker.n}`}
      className="citation-row"
      data-active={active ? "true" : undefined}
      onMouseEnter={() => setHoveredN(marker.n)}
      onMouseLeave={() => setHoveredN(null)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${(marker.n - 1) * 80}ms`,
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
        [{marker.n}]
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
          «{marker.quote}»
        </div>
        <div
          style={{
            fontFamily: type.ui,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: palette.muted,
          }}
        >
          {rich.author && (
            <span style={{ color: palette.text }}>{rich.author}</span>
          )}
          {rich.author && rich.work_title && " · "}
          {rich.work_title}
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            cursor: "pointer",
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
          <span>▾ {s.citation.showPassage}</span>
        </button>
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
        {rich.source_url && (
          <div style={{ marginTop: 6 }}>
            <a
              href={rich.source_url}
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
      <PassageModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        passage={rich}
        highlightQuote={marker.quote}
      />
    </div>
  );
}

function CitationRowError({ row }: { row: Extract<RowKind, { kind: "error" }> }) {
  const { s } = useStrings();
  const { hoveredN, setHoveredN, turnKey } = useCitationContext();
  const { marker, err } = row;
  const active = hoveredN === marker.n;
  const explain =
    err.work_exists === false
      ? "Похоже, агент сократил slug. Попроси: «возьми citation из результатов поиска буква-в-букву»."
      : err.work_exists === true
        ? "Труд найден, но такого параграфа нет — глава/номер ошибочны."
        : "Citation не разобрался — нужен формат author_slug/work_slug/NNNN/pX.";
  return (
    <div
      id={`${turnKey}-cite-${marker.n}`}
      className="citation-row"
      data-active={active ? "true" : undefined}
      onMouseEnter={() => setHoveredN(marker.n)}
      onMouseLeave={() => setHoveredN(null)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr 220px",
        gap: 20,
        padding: "20px 14px",
        marginInline: -14,
        borderBottom: `0.5px solid ${palette.hairline}`,
        alignItems: "baseline",
        animation: "logos-rise 700ms cubic-bezier(.22,.61,.36,1) both",
        animationDelay: `${(marker.n - 1) * 80}ms`,
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
        [{marker.n}]
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
          {err.citation}
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

export function CitationsList({
  markers,
  toolCalls,
}: {
  markers: CitationMarker[];
  toolCalls: DesignToolCall[];
}) {
  const rows = useMemo(() => buildRows(markers, toolCalls), [markers, toolCalls]);
  if (rows.length === 0) return null;
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
      {rows.map((row) =>
        row.kind === "success" ? (
          <CitationRowSuccess key={`c-${row.marker.n}`} row={row} />
        ) : (
          <CitationRowError key={`c-${row.marker.n}`} row={row} />
        ),
      )}
    </div>
  );
}
