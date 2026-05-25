"use client";

import { useEffect } from "react";

/**
 * Keeps a CSS custom property `--monolith-clearance` on
 * `document.documentElement` equal to the live height of the
 * fixed-bottom Monolith card plus a comfortable gap. The home column
 * reads it as `padding-bottom: var(--monolith-clearance, 175px)` so
 * the Starter chips never slide under the input regardless of:
 *
 *   - Monolith height changes (textarea auto-grows on multi-line input,
 *     style-select popover affects the controls strip, etc.)
 *   - Mobile URL bar showing/hiding (iOS Safari / mobile Chrome shrink
 *     the visual viewport, the fixed-bottom Monolith follows it up,
 *     and the home column would otherwise keep its hardcoded padding
 *     based on the larger layout viewport).
 *
 * Listeners:
 *   - `ResizeObserver` on .logos-monolith-card → catches height
 *     changes from inside the card.
 *   - `visualViewport.resize` → catches URL-bar show/hide.
 *   - `window.resize` → catches orientation flips / hard viewport
 *     changes on browsers without visualViewport support.
 *
 * Runs client-only. SSR fallback is the static 175px in logos.css.
 */
export function useMonolithClearance(): void {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const root = document.documentElement;
    const GAP_ABOVE = 28; // px of breathing room between chips and input
    const GAP_BELOW = 28; // matches .logos-monolith[data-mode="..."] bottom

    let card: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    const compute = () => {
      if (!card) {
        card = document.querySelector(".logos-monolith-card");
      }
      if (!card) return;
      const h = card.getBoundingClientRect().height;
      const px = Math.ceil(h + GAP_BELOW + GAP_ABOVE);
      root.style.setProperty("--monolith-clearance", `${px}px`);
    };

    // ResizeObserver hooks up only after the card is in the DOM.
    // First compute() may run before the card mounts (effects run
    // bottom-up, but components mount in a separate phase) — schedule
    // a microtask retry that re-queries the DOM.
    const armObserver = () => {
      card = document.querySelector(".logos-monolith-card");
      if (!card) {
        // Card not mounted yet — try again next frame.
        window.requestAnimationFrame(armObserver);
        return;
      }
      compute();
      ro = new ResizeObserver(compute);
      ro.observe(card);
    };
    armObserver();

    window.addEventListener("resize", compute);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", compute);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", compute);
      vv?.removeEventListener("resize", compute);
      // Clear the var so the CSS fallback (175px) takes effect again
      // if the hook unmounts mid-session (won't happen in practice,
      // but defensive).
      root.style.removeProperty("--monolith-clearance");
    };
  }, []);
}
