// apps/frontend/src/components/logos/CitationsList.tsx
"use client";

import { useEffect, useState } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { useCitationContext } from "./CitationContext";
import { PassageModal } from "./PassageModal";
import { Chevron } from "./Chevron";
import {
  type RowKind,
  azbykaHref,
  refLabel,
} from "./citation-rows";
import { reachGoal } from "@/lib/metrika";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const COLLAPSE_STORAGE_KEY = "logos:citations-collapsed";

/** Read the user's last collapse preference. SSR-safe (returns false). */
function readCollapsedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeCollapsedPref(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, v ? "true" : "false");
  } catch {
    /* localStorage may throw in privacy mode */
  }
}

function CitationRowSuccess({ row }: { row: Extract<RowKind, { kind: "success" }> }) {
  const { s, lang } = useStrings();
  const { hoveredN, setHoveredN, turnKey } = useCitationContext();
  const [modalOpen, setModalOpen] = useState(false);
  const isNarrow = useMediaQuery("(max-width: 640px)");
  const { marker, rich } = row;
  const ref = refLabel(rich, lang);
  const href = azbykaHref(rich);
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
        // On narrow viewports the fixed 220px right column was squeezing
        // the quote container down to ~30px — barely 3 words per line.
        // Collapse to a 2-col layout there and inline ref + azbyka below
        // the metadata inside the middle column.
        gridTemplateColumns: isNarrow ? "24px 1fr" : "32px 1fr 220px",
        gap: isNarrow ? 12 : 20,
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
            fontFamily: type.cite,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: "clamp(16px, 1.25vw, 18px)",
            lineHeight: 1.6,
            letterSpacing: "0.005em",
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
          onClick={() => {
            reachGoal("citation_opened");
            setModalOpen(true);
          }}
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
        {isNarrow && (ref || href) && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "baseline",
              fontFamily: type.mono,
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: palette.faint,
              lineHeight: 1.6,
            }}
          >
            {ref && <span>{ref}</span>}
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => reachGoal("azbyka_clicked")}
                style={{
                  color: palette.muted,
                  textDecoration: "none",
                  borderBottom: `0.5px solid ${palette.hairline}`,
                }}
              >
                {s.citation.sourceLabel} ↗
              </a>
            )}
          </div>
        )}
      </div>
      {!isNarrow && (
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
          {href && (
            <div style={{ marginTop: 6 }}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => reachGoal("azbyka_clicked")}
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
      )}
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
  const isNarrow = useMediaQuery("(max-width: 640px)");
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
        gridTemplateColumns: isNarrow ? "24px 1fr" : "32px 1fr 220px",
        gap: isNarrow ? 12 : 20,
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
      {!isNarrow && <div />}
    </div>
  );
}

/**
 * Panel below the answer. Driven by pre-built rows (built once at
 * AssistantTurn level so the tooltip can share the same data via
 * CitationContext). Collapsible — preference persists in localStorage
 * under `logos:citations-collapsed`. SSR default is expanded; on the
 * very first render the lazy initializer reads localStorage on the
 * client (chat is client-only post-hydration, so no mismatch).
 */
export function CitationsList({ rows }: { rows: RowKind[] }) {
  const { s } = useStrings();
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());

  // Persist on every change. Effect (not inline call) so React keeps
  // strict-mode double-invokes idempotent.
  useEffect(() => {
    writeCollapsedPref(collapsed);
  }, [collapsed]);

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
      <button
        type="button"
        className="logos-citations-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? s.citation.expandAria : s.citation.collapseAria}
      >
        <Chevron open={!collapsed} color={palette.muted} />
        <span>
          {s.citation.sources} · {rows.length}
        </span>
      </button>
      <div
        className="logos-citations-collapse-wrap"
        data-collapsed={collapsed ? "true" : undefined}
      >
        <div className="logos-citations-collapse-inner">
          {rows.map((row) =>
            row.kind === "success" ? (
              <CitationRowSuccess key={`c-${row.marker.n}`} row={row} />
            ) : (
              <CitationRowError key={`c-${row.marker.n}`} row={row} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
