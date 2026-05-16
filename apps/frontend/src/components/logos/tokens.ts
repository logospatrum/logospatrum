// Design tokens for the ΛΟΓΟΣ shell. The designer landed on the
// "Graphite Vespers" palette + "Sacred (Cormorant + Inter)" pairing in
// chat1.md, so those are the only options we ship — the Tweaks panel that
// used to expose alternatives was a design-tool artifact, not product UI.

export const palette = {
  bg:        "#0b0c0e",
  bgDeep:    "#06070a",
  surface:   "#15171b",
  surfaceHi: "#1d2025",
  hairline:  "rgba(238, 232, 218, 0.08)",
  text:      "#ece6d6",
  muted:     "rgba(236, 230, 214, 0.48)",
  faint:     "rgba(236, 230, 214, 0.28)",
  accent:    "#ece6d6",
  light:     "238, 232, 218",
  stoneAmbient: "#1d1d20",
  stoneLit:     "#d8d0bc",
  stoneSpec:    "#fff6e2",
} as const;

// Font families resolve through CSS variables wired up in `app/layout.tsx`
// via `next/font/google`. Each `--font-*` var carries a generated family
// name that next/font registers for that specific weight/subset set.
export const type = {
  logo:   `var(--font-cormorant), "Cormorant Garamond", "EB Garamond", Georgia, serif`,
  quote:  `var(--font-eb-garamond), "EB Garamond", Georgia, serif`,
  ui:     `var(--font-inter), "Inter", ui-sans-serif, system-ui, sans-serif`,
  mono:   `var(--font-geist-mono), "Geist Mono", ui-monospace, monospace`,
  logoWeight: 300,
  logoTracking: "0.32em",
  logoSize: "clamp(72px, 11vw, 168px)",
} as const;

// Default tweak values the designer settled on — no longer user-controlled,
// but kept here so the values are documented in one place.
export const tweaks = {
  noise: 25,        // rock relief intensity, 0..100
  light: 100,       // cursor light ceiling, 0..100
  showQuote: true,
} as const;
