"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import {
  type RowKind,
  azbykaHref,
  refLabel,
} from "./citation-rows";
import { reachGoal } from "@/lib/metrika";

const SIDE_MARGIN = 8;      // px from viewport edge
const PILL_GAP = 8;         // visual clear space between pill and card
const BRIDGE_SLACK = 6;     // extra px the bridge extends BEYOND PILL_GAP
const TOOLTIP_WIDTH = 360;

interface Props {
  /** Marker number (1-based) — only used to forward through to UI text. */
  n: number;
  /** Per-marker view-model. */
  row: RowKind;
  /** Bounding box of the trigger pill, captured by the pill on open. */
  anchorRect: DOMRect;
  /** Caller-driven close. The tooltip itself triggers this on scroll,
   *  outside-click, ESC, and (on touch) outside tap. */
  onClose: () => void;
  /** Called when the cursor enters the tooltip surface (card OR the
   *  bridge that absorbs the diagonal across PILL_GAP). The pill uses
   *  this to cancel its pending close timer. */
  onPersistHover: () => void;
  /** Called when the cursor leaves the tooltip surface. The pill
   *  schedules a delayed close from here so the user can re-enter
   *  within the grace period. */
  onReleaseHover: () => void;
  /** True if we're on a touch device (no hover). Mobile uses the
   *  pointerdown outside-listener instead of mouseleave. */
  isTouch: boolean;
  /** Open the full-paragraph modal. Owned by the pill (not the tooltip)
   *  so the modal survives tooltip dismissal — without this split, the
   *  modal mounts inside the tooltip's portal fragment, body-scroll-lock
   *  fires our onScroll listener, we close the tooltip, and the modal
   *  unmounts on the same tick. */
  onOpenPassage: () => void;
}

interface Placement {
  top: number;
  left: number;
  /** Which side relative to the pill. Drives the bridge direction. */
  side: "top" | "bottom";
}

/** Compute a viewport-clamped placement: prefer above the pill; if there
 *  isn't enough room above, fall to below. Horizontal: center on the pill
 *  but clamp into the viewport with a small margin. */
function place(
  anchor: DOMRect,
  tooltipHeight: number,
  tooltipWidth: number,
): Placement {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spaceAbove = anchor.top;
  const spaceBelow = vh - anchor.bottom;
  const side: "top" | "bottom" =
    spaceAbove >= tooltipHeight + PILL_GAP || spaceAbove >= spaceBelow
      ? "top"
      : "bottom";

  const top =
    side === "top"
      ? Math.max(SIDE_MARGIN, anchor.top - PILL_GAP - tooltipHeight)
      : Math.min(vh - tooltipHeight - SIDE_MARGIN, anchor.bottom + PILL_GAP);

  const anchorCenter = anchor.left + anchor.width / 2;
  let left = anchorCenter - tooltipWidth / 2;
  left = Math.max(SIDE_MARGIN, Math.min(vw - tooltipWidth - SIDE_MARGIN, left));

  return { top, left, side };
}

export function CitationTooltip({
  n,
  row,
  anchorRect,
  onClose,
  onPersistHover,
  onReleaseHover,
  isTouch,
  onOpenPassage,
}: Props) {
  const { s, lang } = useStrings();
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Measure ourselves after first paint, then position. We render once
  // invisible (visibility: hidden) so the layout doesn't flash in the
  // wrong place.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - 2 * SIDE_MARGIN);
    setPlacement(place(anchorRect, rect.height, width));
  }, [anchorRect]);

  useEffect(() => {
    const onResize = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - 2 * SIDE_MARGIN);
      setPlacement(place(anchorRect, rect.height, width));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [anchorRect]);

  // Close on any scroll. Capture phase so we catch scrolls in nested
  // containers (the chat column itself is the scroller in chat mode).
  useEffect(() => {
    const onScroll = () => onClose();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [onClose]);

  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Outside-tap handling — touch only. On desktop, mouseleave + the
  // pill's close timer handle dismissal; intercepting clicks would
  // break the azbyka link inside the card.
  useEffect(() => {
    if (!isTouch) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      // Don't close if the tap lands on the trigger pill itself — the
      // pill's click handler will toggle us.
      const tx = e.clientX;
      const ty = e.clientY;
      if (
        tx >= anchorRect.left &&
        tx <= anchorRect.right &&
        ty >= anchorRect.top &&
        ty <= anchorRect.bottom
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [isTouch, anchorRect, onClose]);

  const visible = placement !== null;

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="logos-citation-tooltip"
      // Mounts invisible for one layout tick to measure itself, then
      // snaps into the computed position. Without this the user sees
      // a one-frame flash at top-left of the viewport.
      style={{
        position: "fixed",
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        width: TOOLTIP_WIDTH,
        maxWidth: `calc(100vw - ${2 * SIDE_MARGIN}px)`,
        visibility: visible ? "visible" : "hidden",
      }}
      data-side={placement?.side ?? "top"}
      onMouseEnter={onPersistHover}
      onMouseLeave={onReleaseHover}
      onClick={(e) => {
        // Stop the click from reaching the pill below — its onClick
        // would otherwise toggle/scroll on every interaction inside
        // the card. Native anchors inside still navigate (we don't
        // preventDefault).
        e.stopPropagation();
      }}
    >
      {/* Invisible hit-area bridge that extends the tooltip's hover
          region across the visible PILL_GAP. As a DOM child of the
          tooltip, mouseenter on the bridge bubbles to the tooltip's
          onMouseEnter → cancels the pill's pending close. Without
          this bridge, the cursor briefly hovers nothing during the
          diagonal pill→card crossing, the close fires, and the user
          can't reach the card. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: PILL_GAP + BRIDGE_SLACK,
          ...(placement?.side === "top"
            ? { bottom: -(PILL_GAP + BRIDGE_SLACK) }
            : { top: -(PILL_GAP + BRIDGE_SLACK) }),
        }}
      />

      {row.kind === "success" ? (
        <SuccessBody
          row={row}
          lang={lang}
          sourceLabel={s.citation.sourceLabel}
          showPassageLabel={s.citation.showPassage}
          n={n}
          onPassage={() => {
            reachGoal("citation_opened");
            // Hand the modal off to the pill, then dismiss ourselves —
            // the modal is now the user's focus, the tooltip is in the
            // way.
            onOpenPassage();
            onClose();
          }}
        />
      ) : (
        <ErrorBody n={n} citation={row.err.citation} notFoundLabel={s.citation.notFound} />
      )}
    </div>,
    document.body,
  );
}

function SuccessBody({
  row,
  lang,
  sourceLabel,
  showPassageLabel,
  n,
  onPassage,
}: {
  row: Extract<RowKind, { kind: "success" }>;
  lang: import("./i18n").Lang;
  sourceLabel: string;
  showPassageLabel: string;
  n: number;
  onPassage: () => void;
}) {
  const { marker, rich } = row;
  const ref = refLabel(rich, lang);
  const href = azbykaHref(rich);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
        }}
      >
        <span style={{ color: palette.accent }}>[{n}]</span>
        {ref && <span style={{ textAlign: "right" }}>{ref}</span>}
      </div>
      <div
        style={{
          fontFamily: type.cite,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 16,
          lineHeight: 1.6,
          letterSpacing: "0.005em",
          color: palette.text,
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={onPassage}
          style={{
            appearance: "none",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            padding: 0,
            color: palette.faint,
            fontFamily: type.mono,
            fontSize: 9.5,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            transition: "color 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.faint;
          }}
        >
          <span>▾ {showPassageLabel}</span>
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => reachGoal("azbyka_clicked")}
            style={{
              marginLeft: "auto",
              color: palette.muted,
              textDecoration: "none",
              borderBottom: `0.5px solid ${palette.hairline}`,
              fontFamily: type.mono,
              fontSize: 9.5,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              transition: "color 200ms ease, border-color 200ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = palette.text;
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = palette.muted;
              e.currentTarget.style.borderColor = palette.hairline;
            }}
          >
            {sourceLabel} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function ErrorBody({
  n,
  citation,
  notFoundLabel,
}: {
  n: number;
  citation: string;
  notFoundLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.faint,
        }}
      >
        [{n}]
      </div>
      <div
        style={{
          fontFamily: type.ui,
          fontSize: 13,
          lineHeight: 1.55,
          color: palette.text,
        }}
      >
        {notFoundLabel}
      </div>
      <div
        style={{
          fontFamily: type.mono,
          fontSize: 11,
          color: palette.muted,
          wordBreak: "break-all",
        }}
      >
        {citation}
      </div>
    </div>
  );
}
