"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";

// Vertical dark column spanning full viewport height, sitting under both
// the message list AND the input. Mask-fades on the left/right edges so
// it doesn't read as a card. The rock is still visible beyond the column.
// On narrow viewports the column goes full-width without horizontal mask
// so text doesn't push under faded edges.
export function ChatBackdrop() {
  const isNarrow = useMediaQuery("(max-width: 720px)");
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: isNarrow ? "100vw" : "min(1140px, 100vw)",
        zIndex: 4,
        pointerEvents: "none",
        background: "rgba(0,0,0,0.94)",
        WebkitMaskImage: isNarrow
          ? "none"
          : "linear-gradient(to right, transparent 0, rgba(0,0,0,1) 80px, rgba(0,0,0,1) calc(100% - 80px), transparent 100%)",
        maskImage: isNarrow
          ? "none"
          : "linear-gradient(to right, transparent 0, rgba(0,0,0,1) 80px, rgba(0,0,0,1) calc(100% - 80px), transparent 100%)",
      }}
    />
  );
}
