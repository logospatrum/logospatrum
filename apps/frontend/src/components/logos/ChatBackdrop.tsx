"use client";

// Vertical dark column spanning full viewport height, sitting under both
// the message list AND the input. Mask-fades on the left/right edges so
// it doesn't read as a card. The rock is still visible beyond the column.
// On `@media (max-width: 720px)` the column goes full-width without the
// horizontal mask (text would push under faded edges otherwise).
//
// Width + mask are driven by `.logos-chat-backdrop` in logos.css —
// previously these were JS-derived via `useMediaQuery`, which caused a
// visible width jump on mobile after hydration (default `false` →
// `true` once `useEffect` ran).
export function ChatBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="logos-chat-backdrop"
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 4,
        pointerEvents: "none",
        background: "rgba(0,0,0,0.94)",
      }}
    />
  );
}
