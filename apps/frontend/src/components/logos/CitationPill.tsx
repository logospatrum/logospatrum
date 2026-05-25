"use client";

import { useEffect, useRef, useState } from "react";
import { useCitationContext } from "./CitationContext";
import { CitationTooltip } from "./CitationTooltip";
import { PassageModal } from "./PassageModal";
import { useMediaQuery } from "@/hooks/useMediaQuery";

interface Props {
  n: string;        // arrives as string from react-markdown hProperties
  slug?: string;
  quote?: string;
}

// Open delay matches inline-reading rhythm — long enough that brushing
// past many [N] in one paragraph doesn't fire a tooltip on every one,
// short enough that an intentional pause still pops up promptly.
const HOVER_OPEN_MS = 90;
// Close delay must absorb the time it takes the cursor to cross the
// 8px clear gap between pill and tooltip card. The tooltip also wires
// its own onMouseEnter to cancel this timer, so once the cursor lands
// inside the card the tooltip stays open indefinitely.
const HOVER_CLOSE_MS = 220;

/**
 * Inline [N] pill rendered for each `citationMarker` MDAST node. Hover
 * (desktop) or tap (touch) opens a tooltip with the same content as the
 * matching row in the citations panel below; the tooltip carries an
 * azbyka link and a "Полный параграф" button. Plain click on desktop
 * still scrolls to the panel row — both affordances coexist.
 *
 * Hover-bridge architecture: there are TWO mutually-exclusive hover
 * regions (the pill itself, and the portal'd tooltip card). Each owns
 * a ref-flag; the tooltip is kept open as long as EITHER flag is true.
 * The 220ms close delay covers the diagonal across the 8px gap, and
 * the tooltip's onMouseEnter cancels the pending close as soon as the
 * cursor lands on the card. Without this dual-flag design, the pill's
 * mouseleave fires the instant the cursor leaves its 14px box and the
 * tooltip closes before the user can reach it.
 */
export function CitationPill({ n }: Props) {
  const num = Number(n);
  const { hoveredN, setHoveredN, scrollToN, getRow, turnKey } = useCitationContext();
  const active = hoveredN === num;
  const isTouch = useMediaQuery("(hover: none)");

  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // PassageModal lives at pill level (NOT inside the tooltip) so its
  // lifecycle survives tooltip dismissal. Otherwise the tooltip's
  // onScroll listener fires when the dialog body-locks the page, the
  // tooltip closes, and the modal portal unmounts on the same tick.
  const [modalOpen, setModalOpen] = useState(false);

  const pillHoverRef = useRef(false);
  const tooltipHoverRef = useRef(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const row = getRow(num);

  // Cleanup on unmount — strict-mode-safe.
  useEffect(() => {
    return () => {
      if (openTimerRef.current != null) {
        window.clearTimeout(openTimerRef.current);
      }
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const doOpen = () => {
    if (!anchorRef.current) return;
    setAnchorRect(anchorRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const doClose = () => {
    setOpen(false);
    setAnchorRect(null);
  };

  const cancelTimers = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleOpen = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    if (openTimerRef.current != null) return; // already pending
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      // Re-check: user may have left in the interim and flipped pillHover
      // back to false. Only open if SOMEONE is still hovering, otherwise
      // a transient brush would leave us with a stuck-open tooltip after
      // the cursor is long gone.
      if (pillHoverRef.current || tooltipHoverRef.current) {
        doOpen();
      }
    }, HOVER_OPEN_MS);
  };

  const scheduleClose = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!open) return;
    if (closeTimerRef.current != null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (!pillHoverRef.current && !tooltipHoverRef.current) {
        doClose();
      }
    }, HOVER_CLOSE_MS);
  };

  const onTooltipPersistHover = () => {
    tooltipHoverRef.current = true;
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const onTooltipReleaseHover = () => {
    tooltipHoverRef.current = false;
    scheduleClose();
  };

  return (
    <sup>
      <a
        ref={anchorRef}
        href={`#${turnKey}-cite-${num}`}
        className="citation-pill"
        data-citation-n={num}
        data-active={active || open ? "true" : undefined}
        onMouseEnter={() => {
          pillHoverRef.current = true;
          setHoveredN(num);
          if (!isTouch && row) scheduleOpen();
        }}
        onMouseLeave={() => {
          pillHoverRef.current = false;
          setHoveredN(null);
          if (!isTouch) scheduleClose();
        }}
        onClick={(e) => {
          e.preventDefault();
          if (isTouch) {
            // Tap-toggle on mobile: tap the same pill closes the
            // tooltip; tap a different pill re-anchors.
            if (open) {
              cancelTimers();
              doClose();
            } else if (row) {
              cancelTimers();
              doOpen();
            }
            return;
          }
          // Desktop click: scroll to the panel row AND close the
          // tooltip so the row gets the user's attention.
          cancelTimers();
          doClose();
          scrollToN(num);
        }}
      >
        [{num}]
      </a>
      {open && anchorRect && row && (
        <CitationTooltip
          n={num}
          row={row}
          anchorRect={anchorRect}
          onClose={() => {
            cancelTimers();
            doClose();
          }}
          onPersistHover={onTooltipPersistHover}
          onReleaseHover={onTooltipReleaseHover}
          isTouch={isTouch}
          onOpenPassage={() => setModalOpen(true)}
        />
      )}
      {row?.kind === "success" && (
        <PassageModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          passage={row.rich}
          highlightQuote={row.marker.quote}
        />
      )}
    </sup>
  );
}
