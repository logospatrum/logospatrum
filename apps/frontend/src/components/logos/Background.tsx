"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { palette, tweaks } from "./tokens";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * True on small viewports OR pure-touch devices. Phones can't keep up
 * with the rAF-driven SVG filter chain (iOS Safari software-rasterizes
 * feTurbulence/feDisplacementMap on the CPU at the full viewport size
 * every frame) — the phone overheats and the page locks. On these
 * devices we render the rock filter ONCE and skip both rAF loops, so
 * iOS caches the filter output as a static bitmap and subsequent
 * scrolls/taps just composite the cached layer. One slow initial paint
 * (~500ms-2s on iPhone 14 Pro) buys an otherwise smooth experience.
 *
 * Set ONCE on mount — no resize/change listener — because flipping
 * static mode mid-session would tear down the rAF loops asymmetrically.
 * The trade is: rotating a tablet from portrait (~640px) into landscape
 * (≥641px) keeps it in static mode until the next page load.
 */
function useStaticBackground(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setV(
      window.matchMedia("(max-width: 640px)").matches ||
        window.matchMedia("(hover: none)").matches,
    );
  }, []);
  return v;
}

// Three-state machine for the whole stage's lighting:
//   "cursor"   — landing. Cursor drives a moving point-light on the rock.
//   "thinking" — chat is mid-stream. Cursor light is off, two offscreen
//                warm flames pulse from below.
//   "reading"  — assistant turn is done. All dynamic lights off; only a
//                dim ambient remains.
export type LightSource = "cursor" | "thinking" | "reading";

interface Props {
  lightSource: LightSource;
  /** Master toggle for ALL light sources (cursor + flames). */
  lightOn: boolean;
  /** Number of past conversations. Drives progressive illumination
   *  (torch → lamp + intensity ramp). */
  chatCount: number;
  /** True when the home input is focused — dims the cursor light so the
   *  rock visually quiets while the user composes. Ignored in chat mode. */
  dimCursor: boolean;
}

const VBW = 1600;
const VBH = 1000;

// Camera zoom — show the central 85% of the logical 1600×1000 rock
// plate. Cropping inward by 7.5% on every side hides the edge
// artefacts (filter "seam" + displacement halo at user-space borders)
// without paying for a viewBox bleed, and the visible rock just
// reads bigger. Cursor mapping and pointer math reference this VIEW
// range; flames live outside it on Y by design (under-illumination).
const VB_VIEW_X0 = 120;
const VB_VIEW_Y0 = 75;
const VB_VIEW_W = VBW - 2 * VB_VIEW_X0; // 1360
const VB_VIEW_H = VBH - 2 * VB_VIEW_Y0; // 850

// Filter region — slightly wider than the camera view so
// feDisplacementMap has buffer pixels to sample when displacing
// at the boundary. Without the buffer the displaced output shows
// a thin "drained" strip at the edge.
const FILTER_BUFFER = 40;
const VB_FILTER_X0 = VB_VIEW_X0 - FILTER_BUFFER;
const VB_FILTER_Y0 = VB_VIEW_Y0 - FILTER_BUFFER;
const VB_FILTER_W = VB_VIEW_W + 2 * FILTER_BUFFER;
const VB_FILTER_H = VB_VIEW_H + 2 * FILTER_BUFFER;

// Cadence at which we invalidate the SVG filter (via setAttribute on
// fePointLight/feDiffuseLighting). The filter graph is the perf
// bottleneck — every attribute change triggers a full re-render of
// turbulence + displacement + N lighting passes + N blends. On a 144Hz
// monitor we used to invalidate 144×/sec, which the GPU compositor
// can't sustain (median frame dt would settle at ~14ms — half-vsync).
// Rate-limiting writes to 60Hz keeps motion smooth to the eye, lets
// the compositor reuse the previous filter output on most vsyncs, and
// drops the filter's GPU duty cycle by ~2.4× on high-refresh displays.
const FRAME_INTERVAL_MS = 16.6;

// Peak values used when the flame envelope reaches 1. We modulate the
// element's diffuseConstant / specularConstant via setAttribute each frame
// — NOT through React — so we don't re-render 60 times/sec and we don't
// have to play games with `z` to dim the lights (SVG fePointLight has no
// distance falloff; `z` only changes the direction).
const FLAME_PEAK_DIFF = 3.4;
const FLAME_PEAK_SPEC = 0.55;
const FLAME_COLOR = "#ff9a4a";
const FLAME_SPEC = "#ffd28a";

export function Background({ lightSource, lightOn, chatCount, dimCursor }: Props) {
  const reducedMotion = useReducedMotion();
  const staticMode = useStaticBackground();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // We hold every fePointLight in this array so JS can swing them in
  // lockstep each frame without going through React's reconciler.
  const lightsRef = useRef<SVGFEPointLightElement[]>([]);
  const torchRef = useRef<HTMLDivElement | null>(null);

  // Flame primitives — separate diffuse + specular passes per side.
  const flameLRefs = useRef<SVGFEPointLightElement[]>([]);
  const flameRRefs = useRef<SVGFEPointLightElement[]>([]);
  const flameDiffLRef = useRef<SVGFEDiffuseLightingElement | null>(null);
  const flameSpecLRef = useRef<SVGFESpecularLightingElement | null>(null);
  const flameDiffRRef = useRef<SVGFEDiffuseLightingElement | null>(null);
  const flameSpecRRef = useRef<SVGFESpecularLightingElement | null>(null);

  // Cursor lighting primitives — ref'd so we can modulate their constants
  // per frame (e.g. fade them when LMB is pressed).
  const cursorDiffRef = useRef<SVGFEDiffuseLightingElement | null>(null);
  const cursorSpecRef = useRef<SVGFESpecularLightingElement | null>(null);

  // Ambient pass — fixed at boot, but driven through a master envelope in
  // the rAF loop so it fades to 0 in lockstep with cursor/flame when the
  // user kills the LIGHT toggle. Without this the rock would still show a
  // dim ambient slab right up to the moment we unmount the heavy SVG.
  const ambientDiffRef = useRef<SVGFEDiffuseLightingElement | null>(null);

  // Cross-shadow group — opacity + tiny x-translation driven by the flame
  // envelope each frame so the shadow on the rock pulses with the flames.
  const crossShadowRef = useRef<SVGGElement | null>(null);

  // Persisted across mode transitions so fade-in/out doesn't reset.
  const flameEnvRef = useRef(0);
  const cursorEnvRef = useRef(1);
  const pressedRef = useRef(false);
  // Most recent pointer type. Touch pointers shouldn't trigger the
  // press-dim or the focus-dim — both are mouse-centric behaviours
  // (clicking to grab attention, mouse leaving the rock while typing).
  // On touch the user expects the light to track the finger and stay
  // visible underneath it. Updated in the cursor-follow effect and
  // consumed in the cTarget computation in the master-envelope effect.
  const pointerTypeRef = useRef<string>("mouse");
  // Master envelope for the LIGHT toggle. 1 = full scene (current default),
  // 0 = scene dimmed to nothing. Multiplied into ambient + cursor + flame
  // peaks so all three converge to zero at the same lerp rate before we
  // tear down the heavy SVG. Starts at 1 to match the initial-mount
  // expectation that the rock is visible on first paint.
  const masterEnvRef = useRef(1);

  // Refs that mirror props so the long-lived rAF loop reads fresh values
  // without re-creating its closure on every prop change.
  const dimCursorRef = useRef(false);
  const lightOnRef = useRef(true);
  const lightSourceRef = useRef<LightSource>(lightSource);
  // Mirror ambient peak intensity into a ref so the rAF loop reads its
  // current value (recomputed per render from lightSource + chatCount)
  // without re-creating the closure.
  const ambientPeakRef = useRef(0.20);
  useEffect(() => {
    dimCursorRef.current = dimCursor;
  }, [dimCursor]);
  useEffect(() => {
    lightOnRef.current = lightOn;
  }, [lightOn]);
  useEffect(() => {
    lightSourceRef.current = lightSource;
  }, [lightSource]);

  // GPU optimization: when the LIGHT toggle is OFF we unmount the heavy
  // SVG (turbulence + displacement + 7 lighting passes + 8 blends — the
  // bulk of background paint cost). On toggle-on we remount IMMEDIATELY
  // so the rock starts rendering BEFORE the light envelope swells in;
  // on toggle-off we wait ~1.5s for the masterEnv lerp to take ambient/
  // cursor/flame to ~0 before tearing the SVG down, so the rock fades to
  // black instead of popping out. Reduced-motion users get the instant
  // unmount (no animation expectation).
  const [renderHeavy, setRenderHeavy] = useState(lightOn);
  useEffect(() => {
    if (lightOn) {
      setRenderHeavy(true);
      return undefined;
    }
    // Reduced-motion + static-mobile both skip the cinematic fade —
    // we can't fade without a rAF, and on mobile the rAF is exactly
    // what we're trying to avoid.
    if (reducedMotion || staticMode) {
      setRenderHeavy(false);
      return undefined;
    }
    const t = window.setTimeout(() => setRenderHeavy(false), 1500);
    return () => window.clearTimeout(t);
  }, [lightOn, reducedMotion, staticMode]);

  const registerLight = useCallback((el: SVGFEPointLightElement | null) => {
    if (el && !lightsRef.current.includes(el)) lightsRef.current.push(el);
  }, []);
  const registerFlameL = useCallback((el: SVGFEPointLightElement | null) => {
    if (el && !flameLRefs.current.includes(el)) flameLRefs.current.push(el);
  }, []);
  const registerFlameR = useCallback((el: SVGFEPointLightElement | null) => {
    if (el && !flameRRefs.current.includes(el)) flameRRefs.current.push(el);
  }, []);

  // ── Progressive illumination ─────────────────────────────────────────
  // Cursor light strength scales with how many past conversations the
  // user has had (passed in as chatCount, which comes from useThreads()).
  //
  //   N = 0   → very tight torch, ~15% of peak intensity.
  //   N = 5   → torch peaks; starts crossfading to lamp.
  //   N = 10  → full lamp shape; intensity still ramping up.
  //   N = 30+ → full lamp at the calibrated ceiling (well below the old
  //             3.5 peak that was reported as blinding around N=6–10
  //             once the torch cone faded out).
  //
  // KNOWN LIMITATION: chatCount is read from localStorage threads, which
  // means clearing browser storage (or using incognito) resets the user
  // to a "new visitor" cave. This is intentional — the metaphor is "your
  // own accumulated conversations light up your space", not a global
  // counter. If a server-backed counter is wanted, fetch it from the
  // backend and merge here.
  const N = Math.max(0, chatCount);
  const baseline = 0.15;
  // Slower ramp (over 30 chats, not 20) so the lamp doesn't reach its
  // full intensity right after the torch cone disappears.
  const progress = baseline + (1 - baseline) * Math.min(1, N / 30);
  const torchness = Math.max(0, Math.min(1, (10 - N) / 5));
  const lerp = (a: number, b: number, t: number) => a * t + b * (1 - t);
  const lightK = tweaks.light / 100;
  const grainK = tweaks.noise / 100;
  const surfaceScale = 14 + grainK * 14;

  // LAMP peak softened: diffuse 3.5 → 2.4, specular 0.41 → 0.28. The
  // torch numbers are unchanged so the early-visitor experience stays
  // the same — only the post-crossfade brightness drops.
  const TORCH = { cursor: 5.0, ambient: 0.20, z: 32, specZ: 40, specC: 0.65 };
  const LAMP = { cursor: 2.4, ambient: 0.26, z: 90, specZ: 110, specC: 0.28 };
  const baseCursor = lerp(TORCH.cursor, LAMP.cursor, torchness);
  const baseSpec = lerp(TORCH.specC, LAMP.specC, torchness);
  const cursorZ = lerp(TORCH.z, LAMP.z, torchness);
  const specZ = lerp(TORCH.specZ, LAMP.specZ, torchness);
  const ambientTorchLamp = lerp(TORCH.ambient, LAMP.ambient, torchness);

  const isCursorActive = lightSource === "cursor";
  // Peaks — always positive, regardless of mode. The rAF below gates them
  // off via the `cEnv` envelope (cEnv → 0 when mode ≠ cursor). Keeping the
  // peak independent of `lightSource` is what lets the rAF loop be the
  // single writer of these two SVG attributes: no JSX-prop/setAttribute
  // race like the one that left cursorLit stuck at "0.750" after a chat
  // switched in from the sidebar (see git history).
  const cursorPeakDiff = baseCursor * progress * lightK;
  const cursorPeakSpec = baseSpec * progress * lightK;

  // Cursor lighting constants written into the JSX on the VERY FIRST
  // render — i.e. into the SSR HTML. The rAF loop below takes over as
  // the sole writer once it mounts (via `setAttribute`), so subsequent
  // re-renders of this component don't fight the animation. Capturing
  // through `useRef(...).current` pins the value to first-render data:
  //   - `lightOn` reflects the server-known cookie (default true), so
  //     SSR shows the cursor halo immediately for users who have the
  //     light on — no waiting for JS to hydrate before it draws.
  //   - When the user has the light off, both initial values are 0 and
  //     the SVG starts dark, matching their preference from frame one.
  const initialCursorDiffConstant = useRef(
    lightOn ? cursorPeakDiff : 0,
  ).current;
  const initialCursorSpecConstant = useRef(
    lightOn ? cursorPeakSpec : 0,
  ).current;
  const ambientIntensity = isCursorActive
    ? ambientTorchLamp
    : lightSource === "reading"
      ? 0.18
      : 0.10; // thinking — flames will brighten the rest
  ambientPeakRef.current = ambientIntensity;
  const specExponent = 48;

  // ── Cursor follow ── only runs while lightSource === "cursor" AND the
  // heavy SVG is mounted. Without `renderHeavy` in deps the loop would
  // keep running after we tear the filter down, writing to dead refs.
  useEffect(() => {
    if (lightSource !== "cursor") return undefined;
    if (reducedMotion) return undefined;
    if (!renderHeavy) return undefined;
    // Static mobile path: no rAF, no pointer tracking. The cursor light
    // sits at a fixed top-right position (set in JSX below) and is held
    // bright by the setAttribute effect a bit lower in this file.
    if (staticMode) return undefined;
    let raf = 0;
    let tx = VBW * 0.5, ty = VBH * 0.4;
    let cx = tx, cy = ty;
    let pxX = window.innerWidth / 2, pxY = window.innerHeight * 0.4;
    let cpxX = pxX, cpxY = pxY;
    // Pointer-type tracking: see `pointerTypeRef` declaration above.
    // We mirror into the ref so the master-envelope effect (separate
    // useEffect) can also gate dim conditions by pointer type.
    //
    // `setTarget` updates tx/ty + pxX/pxY from any pointer event.
    // The rAF lerp below is the SAME for mouse and touch — slow,
    // meditative trail. Touch drags fire `pointermove` continuously,
    // so the light glides under the finger the same way it does under
    // the cursor on desktop.
    const setTarget = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      // Map element pixels to the *visible* user-space window so the
      // light pool stays under the cursor — element 0..r.width
      // corresponds to viewBox VB_VIEW_X0..VB_VIEW_X0+VB_VIEW_W.
      tx = ((e.clientX - r.left) / r.width) * VB_VIEW_W + VB_VIEW_X0;
      ty = ((e.clientY - r.top) / r.height) * VB_VIEW_H + VB_VIEW_Y0;
      pxX = e.clientX;
      pxY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      pointerTypeRef.current = e.pointerType || "mouse";
      setTarget(e);
    };
    // Primary button only. Capture phase so child stopPropagation can't break it.
    // Touch pointers don't toggle pressedRef — every touch is a press,
    // so applying the press-dim would make the light vanish under the
    // user's finger on every tap / swipe. We also don't snap on
    // pointerdown — the lerp catching up from the previous resting
    // point is exactly the trail the user wants.
    const onDown = (e: PointerEvent) => {
      pointerTypeRef.current = e.pointerType || "mouse";
      setTarget(e);
      if (e.pointerType === "mouse" && e.button === 0) {
        pressedRef.current = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0 && e.pointerType === "mouse") pressedRef.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);

    let lastWrite = 0;
    const tick = (now: number) => {
      if (now - lastWrite < FRAME_INTERVAL_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastWrite = now;
      // Meditative 0.06 / 0.10 lerp — slow follow that reads as a
      // monumental, drifting halo. Identical for mouse and touch:
      // pointermove fires continuously during a finger drag on every
      // modern mobile browser, so the same gentle catch-up creates the
      // same trail under a finger that it does under a cursor.
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      cpxX += (pxX - cpxX) * 0.10;
      cpxY += (pxY - cpxY) * 0.10;
      const sx = cx.toFixed(1), sy = cy.toFixed(1);
      for (const l of lightsRef.current) {
        l.setAttribute("x", sx);
        l.setAttribute("y", sy);
      }
      if (torchRef.current) {
        torchRef.current.style.setProperty("--tx", cpxX.toFixed(1) + "px");
        torchRef.current.style.setProperty("--ty", cpxY.toFixed(1) + "px");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      cancelAnimationFrame(raf);
    };
  }, [lightSource, reducedMotion, renderHeavy, staticMode]);

  // ── Flame + cross-shadow + cursor + master envelopes ── runs whenever
  // the heavy SVG is mounted. Tearing down with renderHeavy=false lets us
  // stop the rAF entirely (and stop writing setAttribute into refs that
  // are about to vanish).
  useEffect(() => {
    if (reducedMotion) return undefined;
    if (!renderHeavy) return undefined;
    // Static mobile path: skip the whole flame/ambient/cursor envelope
    // loop. Ambient stays at its JSX-initial diffuseConstant
    // (= ambientIntensity), cursor diff/spec stay at the values written
    // by the one-shot setAttribute effect below, and flames stay at 0.
    // The rock filter then has a steady input → iOS caches the
    // rasterized output and reuses it across frames.
    if (staticMode) return undefined;
    const baseLX = VBW * 0.30, baseRX = VBW * 0.70;
    const baseY = VBH * 1.15;
    let raf = 0;
    let lastWrite = 0;
    const t0 = performance.now();
    const flicker = (t: number, seed: number) =>
      0.50 +
      0.28 * Math.sin(t * 0.0042 + seed) +
      0.14 * Math.sin(t * 0.0093 + seed * 1.7) +
      0.08 * Math.sin(t * 0.0181 + seed * 2.3);

    const tick = (now: number) => {
      if (now - lastWrite < FRAME_INTERVAL_MS) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastWrite = now;
      // Read mode via ref, not closure — this effect's deps don't include
      // lightSource (intentional, so the loop isn't torn down on every
      // mode change), so the closure binding would stay frozen at
      // "thinking" forever once flames first ignite. Bug symptom: going
      // home mid-stream kept the flames burning under the rock until
      // chatCount / lightK happened to change.
      const target =
        lightSourceRef.current === "thinking" && lightOnRef.current ? 1 : 0;
      let env = flameEnvRef.current;
      // Faster fade-out (0.12 vs the cinematic 0.04) when the user kills
      // LIGHT — otherwise the flames would still be at ~55% intensity by
      // the time we unmount the heavy SVG and produce a visible pop.
      const flameLerp = lightOnRef.current ? 0.04 : 0.12;
      env += (target - env) * flameLerp;
      if (Math.abs(target - env) < 0.0005) env = target;
      flameEnvRef.current = env;

      // Master envelope — fades ambient/cursor/flame TOGETHER when the
      // user kills the LIGHT toggle so all three sources hit 0 in step.
      // Without this, ambient stays at its constant JSX-prop value right
      // up to unmount and "pops" off when the SVG tears down.
      const mTarget = lightOnRef.current ? 1 : 0;
      let mEnv = masterEnvRef.current;
      mEnv += (mTarget - mEnv) * 0.12;
      if (Math.abs(mTarget - mEnv) < 0.001) mEnv = mTarget;
      masterEnvRef.current = mEnv;
      ambientDiffRef.current?.setAttribute(
        "diffuseConstant",
        (ambientPeakRef.current * mEnv).toFixed(3),
      );

      const t = now - t0;
      const fL = Math.max(0, Math.min(1, flicker(t, 1.0)));
      const fR = Math.max(0, Math.min(1, flicker(t, 4.3)));
      const dxL = Math.sin(t * 0.0017) * 22;
      const dxR = Math.cos(t * 0.0023 + 1.1) * 22;
      const dyL = Math.sin(t * 0.0031 + 0.4) * 14;
      const dyR = Math.sin(t * 0.0027 + 2.1) * 14;
      const zL = 160 - 110 * fL;
      const zR = 160 - 110 * fR;
      for (const l of flameLRefs.current) {
        l.setAttribute("x", (baseLX + dxL).toFixed(1));
        l.setAttribute("y", (baseY + dyL).toFixed(1));
        l.setAttribute("z", zL.toFixed(1));
      }
      for (const l of flameRRefs.current) {
        l.setAttribute("x", (baseRX + dxR).toFixed(1));
        l.setAttribute("y", (baseY + dyR).toFixed(1));
        l.setAttribute("z", zR.toFixed(1));
      }
      const diffL = env * FLAME_PEAK_DIFF * (0.7 + 0.5 * fL);
      const diffR = env * FLAME_PEAK_DIFF * (0.7 + 0.5 * fR);
      const specL = env * FLAME_PEAK_SPEC * (0.6 + 0.6 * fL);
      const specR = env * FLAME_PEAK_SPEC * (0.6 + 0.6 * fR);
      flameDiffLRef.current?.setAttribute("diffuseConstant", diffL.toFixed(3));
      flameDiffRRef.current?.setAttribute("diffuseConstant", diffR.toFixed(3));
      flameSpecLRef.current?.setAttribute("specularConstant", specL.toFixed(3));
      flameSpecRRef.current?.setAttribute("specularConstant", specR.toFixed(3));

      // Cross-shadow opacity tracks env but holds near 1 once env > 0.2,
      // dropping to 0 only at the very end of the fade — otherwise the
      // shadow would visually leave before its light source does.
      if (crossShadowRef.current) {
        const envBoosted = Math.min(1, env * 5);
        const baseAlpha = envBoosted * (0.95 + 0.20 * fL + 0.18 * fR);
        const swayX = (fR - fL) * 22;
        const swayY = (1 - (fL + fR) / 2) * 8;
        crossShadowRef.current.setAttribute(
          "opacity",
          Math.min(1, baseAlpha).toFixed(3),
        );
        crossShadowRef.current.setAttribute(
          "transform",
          `translate(${swayX.toFixed(1)} ${swayY.toFixed(1)})`,
        );
      }

      // Cursor envelope — target 0 in any non-cursor mode, or when LMB is
      // held, the home input is focused (dimCursorRef), or the global
      // light toggle is off. Always written (no `if`-gate), so the rAF
      // remains the single writer of the cursor diffuse/spec attributes
      // and any cached "0.750" from the previous mode gets cleanly faded
      // out to 0.
      // Touch pointers skip the press-dim AND the focus-dim — both are
      // mouse-centric behaviours and on touch the light should stay
      // bright wherever the finger last landed. pressedRef itself is
      // gated on the input side too (onDown only sets it for mouse),
      // but dimCursorRef is driven by `inputFocused` from the parent
      // and doesn't know about pointer type — we gate it here.
      const isMousePointer = pointerTypeRef.current === "mouse";
      const cTarget =
        lightSourceRef.current !== "cursor" ||
        !lightOnRef.current ||
        (isMousePointer && (pressedRef.current || dimCursorRef.current))
          ? 0
          : 1;
      let cEnv = cursorEnvRef.current;
      cEnv += (cTarget - cEnv) * 0.12;
      if (Math.abs(cTarget - cEnv) < 0.001) cEnv = cTarget;
      cursorEnvRef.current = cEnv;
      cursorDiffRef.current?.setAttribute(
        "diffuseConstant",
        (cEnv * cursorPeakDiff).toFixed(3),
      );
      cursorSpecRef.current?.setAttribute(
        "specularConstant",
        (cEnv * cursorPeakSpec).toFixed(3),
      );

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cursorPeakDiff, cursorPeakSpec, reducedMotion, renderHeavy, staticMode]);

  // ── Static mobile: pin the cursor light at its peak intensity ──
  // The rAF envelopes that normally lerp cursor diff/spec from 0 → peak
  // never run in static mode, so we set the attributes ourselves once
  // the heavy SVG mounts. Without this, the SSR-initial values
  // (controlled by `lightOn` via useRef capture above) might still be 0
  // for users whose pat_light cookie was off at first render, leaving
  // the rock looking dark on mobile even though they later toggled
  // light back on.
  useEffect(() => {
    if (!staticMode) return;
    if (!renderHeavy) return;
    const cursorDiff = lightOn ? cursorPeakDiff : 0;
    const cursorSpec = lightOn ? cursorPeakSpec : 0;
    cursorDiffRef.current?.setAttribute("diffuseConstant", cursorDiff.toFixed(3));
    cursorSpecRef.current?.setAttribute("specularConstant", cursorSpec.toFixed(3));
    ambientDiffRef.current?.setAttribute(
      "diffuseConstant",
      (lightOn ? ambientPeakRef.current : 0).toFixed(3),
    );
  }, [staticMode, renderHeavy, lightOn, cursorPeakDiff, cursorPeakSpec]);

  // When LIGHT is off and the fade-out timer has fired, drop the heavy
  // filter graph but keep a minimal SVG carrying ONLY:
  //   - black background — matches what the filter outputs at env=0
  //     (ambient * albedo with ambient=0 → pure #000)
  //   - the same top-off-screen beam (`logosBeam` radial gradient) and
  //     the same edge vignette as the heavy version
  //
  // Critical: use the SAME `viewBox` and `preserveAspectRatio="xMidYMid
  // slice"` as the heavy SVG. The SVG aspect-mapping math then resolves
  // the gradient's `cx/cy/r` percentages against the SAME object-
  // bounding-box and applies the SAME slice scaling — so the beam lands
  // at the EXACT same screen coordinates and the EXACT same ellipse
  // shape regardless of LIGHT toggle state or viewport resize.
  //
  // CSS radial-gradient fallback was tried first but doesn't match: it
  // resolves percentages against the viewport rather than an SVG bbox,
  // and uses viewport aspect instead of viewBox aspect — both shift the
  // beam's center and stretch its ellipse differently from the SVG one.
  //
  // GPU cost: two gradient rects, no filter, no compositing layer —
  // ~1-2 % of the heavy-mode paint cost.
  if (!renderHeavy) {
    return (
      <svg
        viewBox={`${VB_VIEW_X0} ${VB_VIEW_Y0} ${VB_VIEW_W} ${VB_VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 0,
          pointerEvents: "none",
          background: "#000",
        }}
      >
        <defs>
          <radialGradient id="logosBeamOff" cx="50%" cy="-5%" r="60%">
            <stop offset="0%" stopColor={palette.stoneLit} stopOpacity={0.14 * lightK} />
            <stop offset="60%" stopColor={palette.stoneLit} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="logosVignetteOff" cx="50%" cy="50%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
          </radialGradient>
        </defs>
        <rect
          x={VB_VIEW_X0}
          y={VB_VIEW_Y0}
          width={VB_VIEW_W}
          height={VB_VIEW_H}
          fill="url(#logosBeamOff)"
        />
        <rect
          x={VB_VIEW_X0}
          y={VB_VIEW_Y0}
          width={VB_VIEW_W}
          height={VB_VIEW_H}
          fill="url(#logosVignetteOff)"
        />
      </svg>
    );
  }

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`${VB_VIEW_X0} ${VB_VIEW_Y0} ${VB_VIEW_W} ${VB_VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 0,
          pointerEvents: "none",
          background: palette.bgDeep,
        }}
      >
        <defs>
          <filter
            id="logosRockCliff"
            x={VB_FILTER_X0}
            y={VB_FILTER_Y0}
            width={VB_FILTER_W}
            height={VB_FILTER_H}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            {/* Two-noise rock geometry: smooth base + turbulence displacer →
                chipped facets, not rolling dunes. Equal X/Y baseFrequency
                so the light's X and Y motion reveal symmetric structure. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0085"
              numOctaves={3}
              seed={7}
              stitchTiles="stitch"
              result="rockBase"
            />
            <feTurbulence
              type="turbulence"
              baseFrequency="0.022"
              numOctaves={2}
              seed={13}
              stitchTiles="stitch"
              result="displace"
            />
            <feDisplacementMap
              in="rockBase"
              in2="displace"
              scale={28}
              xChannelSelector="R"
              yChannelSelector="G"
              result="rockJagged"
            />
            {/* S-curve contrast → crisp facet edges, not smooth gradients. */}
            <feComponentTransfer in="rockJagged" result="rockSharp">
              <feFuncR type="table" tableValues="0 0.05 0.18 0.55 0.85 1" />
              <feFuncG type="table" tableValues="0 0.05 0.18 0.55 0.85 1" />
              <feFuncB type="table" tableValues="0 0.05 0.18 0.55 0.85 1" />
            </feComponentTransfer>


            {/* Albedo: a static greyscale "body" of the rock, multiplied
                with the lit output so the pattern reads as one stone
                even as the light moves. */}
            <feColorMatrix
              in="rockSharp"
              type="matrix"
              values="0.50 0 0 0 0.30
                      0.50 0 0 0 0.30
                      0.50 0 0 0 0.30
                      0    0 0 0 1"
              result="albedo"
            />

            {/* Micro-grain breaks the soft halos that normal-mapped
                lighting on smooth turbulence inherently produces. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={19}
              stitchTiles="stitch"
              result="microRaw"
            />
            <feColorMatrix
              in="microRaw"
              type="matrix"
              values="0.15 0 0 0 0.85
                      0.15 0 0 0 0.85
                      0.15 0 0 0 0.85
                      0    0 0 0 1"
              result="micro"
            />

            {/* Ambient key from above-left — dim, so the cursor light
                dominates and the unlit side reads near-black. diffuseConstant
                is driven by the master envelope in the rAF loop so ambient
                fades alongside cursor/flame when the LIGHT toggle drops. */}
            <feDiffuseLighting
              ref={ambientDiffRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              diffuseConstant={ambientIntensity}
              lightingColor={palette.stoneAmbient}
              result="ambient"
            >
              <feDistantLight azimuth={220} elevation={28} />
            </feDiffuseLighting>

            {/* Cursor pool — bright, close to the surface. The
                diffuseConstant/specularConstant attributes are owned
                exclusively by the rAF loop above (see comment near
                cursorPeakDiff). Initial 0 here so the rock starts dark
                until rAF lerps the envelope up. */}
            <feDiffuseLighting
              ref={cursorDiffRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              diffuseConstant={initialCursorDiffConstant}
              lightingColor={palette.stoneLit}
              result="cursorLit"
            >
              <fePointLight
                ref={registerLight}
                /* Static mobile parks the light upper-right of the
                   view area ("right of the header"); desktop starts
                   it centered and the rAF takes over from there. */
                x={staticMode ? VB_VIEW_X0 + VB_VIEW_W * 0.82 : VBW / 2}
                y={staticMode ? VB_VIEW_Y0 + VB_VIEW_H * 0.15 : VBH * 0.4}
                z={cursorZ}
              />
            </feDiffuseLighting>

            <feSpecularLighting
              ref={cursorSpecRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              specularConstant={initialCursorSpecConstant}
              specularExponent={specExponent}
              lightingColor={palette.stoneSpec}
              result="cursorSpec"
            >
              <fePointLight
                ref={registerLight}
                x={staticMode ? VB_VIEW_X0 + VB_VIEW_W * 0.82 : VBW / 2}
                y={staticMode ? VB_VIEW_Y0 + VB_VIEW_H * 0.15 : VBH * 0.4}
                z={specZ}
              />
            </feSpecularLighting>

            {/* Flames — left + right, offscreen below the chat. Initial
                constants are 0; the rAF loop modulates them. */}
            <feDiffuseLighting
              ref={flameDiffLRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              diffuseConstant={0}
              lightingColor={FLAME_COLOR}
              result="flameLDiff"
            >
              <fePointLight ref={registerFlameL} x={VBW * 0.30} y={VBH * 1.15} z={90} />
            </feDiffuseLighting>
            <feSpecularLighting
              ref={flameSpecLRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              specularConstant={0}
              specularExponent={32}
              lightingColor={FLAME_SPEC}
              result="flameLSpec"
            >
              <fePointLight ref={registerFlameL} x={VBW * 0.30} y={VBH * 1.15} z={90} />
            </feSpecularLighting>
            <feDiffuseLighting
              ref={flameDiffRRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              diffuseConstant={0}
              lightingColor={FLAME_COLOR}
              result="flameRDiff"
            >
              <fePointLight ref={registerFlameR} x={VBW * 0.70} y={VBH * 1.15} z={90} />
            </feDiffuseLighting>
            <feSpecularLighting
              ref={flameSpecRRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              specularConstant={0}
              specularExponent={32}
              lightingColor={FLAME_SPEC}
              result="flameRSpec"
            >
              <fePointLight ref={registerFlameR} x={VBW * 0.70} y={VBH * 1.15} z={90} />
            </feSpecularLighting>

            {/* Compose. Lighting adds via screen; multiply pulls in the
                static rock identity at the end. */}
            <feBlend in="cursorLit" in2="ambient" mode="screen" result="lit" />
            <feBlend in="cursorSpec" in2="lit" mode="screen" result="lit2" />
            <feBlend in="flameLDiff" in2="lit2" mode="screen" result="lit3" />
            <feBlend in="flameLSpec" in2="lit3" mode="screen" result="lit4" />
            <feBlend in="flameRDiff" in2="lit4" mode="screen" result="lit5" />
            <feBlend in="flameRSpec" in2="lit5" mode="screen" result="lit6" />
            <feBlend in="lit6" in2="albedo" mode="multiply" result="litRock" />
            <feBlend in="litRock" in2="micro" mode="multiply" result="finalRock" />
            <feComposite in="finalRock" in2="finalRock" operator="in" result="opaque" />
          </filter>

          <radialGradient id="logosBeam" cx="50%" cy="-5%" r="60%">
            <stop offset="0%" stopColor={palette.stoneLit} stopOpacity={0.14 * lightK} />
            <stop offset="60%" stopColor={palette.stoneLit} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="logosVignette" cx="50%" cy="50%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
          </radialGradient>
        </defs>

        <rect
          x={VB_FILTER_X0}
          y={VB_FILTER_Y0}
          width={VB_FILTER_W}
          height={VB_FILTER_H}
          filter="url(#logosRockCliff)"
        />
        <rect
          x={VB_VIEW_X0}
          y={VB_VIEW_Y0}
          width={VB_VIEW_W}
          height={VB_VIEW_H}
          fill="url(#logosBeam)"
          style={{ mixBlendMode: "screen" }}
        />
        <rect
          x={VB_VIEW_X0}
          y={VB_VIEW_Y0}
          width={VB_VIEW_W}
          height={VB_VIEW_H}
          fill="url(#logosVignette)"
        />
      </svg>

      {/* Cross-shadow overlay — only outside of cursor (home) mode. */}
      {!isCursorActive && (
        <svg
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 1,
            pointerEvents: "none",
            mixBlendMode: "multiply",
          }}
        >
          <defs>
            <filter id="logosCrossShadowBlur" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation={18} />
            </filter>
          </defs>
          <g ref={crossShadowRef} opacity={0}>
            <g
              transform="translate(1420 960) scale(1 1.3)"
              filter="url(#logosCrossShadowBlur)"
              fill="#000"
            >
              <rect x={-32} y={-580} width={64} height={620} rx={6} />
              <rect x={-200} y={-460} width={400} height={64} rx={6} />
            </g>
          </g>
        </svg>
      )}

      {/* Torch cone overlay — dark radial mask cut by the cursor halo.
          Opacity fades with torchness, so the cone opens up as the user
          accumulates chats. Mounted regardless of `isCursorActive`; the
          mode-toggle goes through the `opacity` transition so the mask
          fades in lockstep with the cursor envelope. If we instead
          unmounted on mode change, the dark mask would vanish in one
          paint while the cursor light below it still has ~500ms of
          envelope fade left — that gap reads visually as a brief
          "lamp" flash. */}
      {torchness > 0.02 && (
        <div
          ref={torchRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4,
            pointerEvents: "none",
            background:
              "radial-gradient(circle 24vmax at var(--tx, 50%) var(--ty, 40%), " +
              "rgba(0,0,0,0) 0%, rgba(0,0,0,0) 14%, " +
              "rgba(0,0,0,0.55) 38%, rgba(0,0,0,0.92) 70%, rgba(0,0,0,0.97) 100%)",
            opacity: isCursorActive ? torchness : 0,
            transition: "opacity 500ms ease",
          }}
        />
      )}
    </>
  );
}
