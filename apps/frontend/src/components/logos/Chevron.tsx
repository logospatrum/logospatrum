"use client";

// 8×8 rotating triangle. 0deg = pointing right (▸), 90deg = down (▾).
export function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <svg
      width={8}
      height={8}
      viewBox="0 0 8 8"
      aria-hidden="true"
      style={{
        transform: `rotate(${open ? 90 : 0}deg)`,
        transition: "transform 200ms ease",
        flexShrink: 0,
      }}
    >
      <path d="M2 1.5 L6 4 L2 6.5 Z" fill={color} />
    </svg>
  );
}
