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

  // Cross-shadow group — opacity + tiny x-translation driven by the flame
  // envelope each frame so the shadow on the rock pulses with the flames.
  const crossShadowRef = useRef<SVGGElement | null>(null);

  // Persisted across mode transitions so fade-in/out doesn't reset.
  const flameEnvRef = useRef(0);
  const cursorEnvRef = useRef(1);
  const pressedRef = useRef(false);

  // Refs that mirror props so the long-lived rAF loop reads fresh values
  // without re-creating its closure on every prop change.
  const dimCursorRef = useRef(false);
  const lightOnRef = useRef(true);
  const lightSourceRef = useRef<LightSource>(lightSource);
  useEffect(() => {
    dimCursorRef.current = dimCursor;
  }, [dimCursor]);
  useEffect(() => {
    lightOnRef.current = lightOn;
  }, [lightOn]);
  useEffect(() => {
    lightSourceRef.current = lightSource;
  }, [lightSource]);

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
  //   N = 10  → full lamp shape; intensity ramping up.
  //   N = 20+ → full lamp at 100% (capped by tweaks.light).
  //
  // KNOWN LIMITATION: chatCount is read from localStorage threads, which
  // means clearing browser storage (or using incognito) resets the user
  // to a "new visitor" cave. This is intentional — the metaphor is "your
  // own accumulated conversations light up your space", not a global
  // counter. If a server-backed counter is wanted, fetch it from the
  // backend and merge here.
  const N = Math.max(0, chatCount);
  const baseline = 0.15;
  const progress = baseline + (1 - baseline) * Math.min(1, N / 20);
  const torchness = Math.max(0, Math.min(1, (10 - N) / 5));
  const lerp = (a: number, b: number, t: number) => a * t + b * (1 - t);
  const lightK = tweaks.light / 100;
  const grainK = tweaks.noise / 100;
  const surfaceScale = 14 + grainK * 14;

  const TORCH = { cursor: 5.0, ambient: 0.20, z: 32, specZ: 40, specC: 0.65 };
  const LAMP = { cursor: 3.5, ambient: 0.32, z: 90, specZ: 110, specC: 0.41 };
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
  const ambientIntensity = isCursorActive
    ? ambientTorchLamp
    : lightSource === "reading"
      ? 0.18
      : 0.10; // thinking — flames will brighten the rest
  const specExponent = 48;

  // ── Cursor follow ── only runs while lightSource === "cursor".
  useEffect(() => {
    if (lightSource !== "cursor") return undefined;
    if (reducedMotion) return undefined;
    let raf = 0;
    let tx = VBW * 0.5, ty = VBH * 0.4;
    let cx = tx, cy = ty;
    let pxX = window.innerWidth / 2, pxY = window.innerHeight * 0.4;
    let cpxX = pxX, cpxY = pxY;

    const onMove = (e: PointerEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      tx = ((e.clientX - r.left) / r.width) * VBW;
      ty = ((e.clientY - r.top) / r.height) * VBH;
      pxX = e.clientX;
      pxY = e.clientY;
    };
    // Primary button only. Capture phase so child stopPropagation can't break it.
    const onDown = (e: PointerEvent) => { if (e.button === 0) pressedRef.current = true; };
    const onUp   = (e: PointerEvent) => { if (e.button === 0) pressedRef.current = false; };
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
      // Slow follow — heavy, monumental.
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
  }, [lightSource, reducedMotion]);

  // ── Flame + cross-shadow + cursor envelope ── runs always so fades
  // don't snap on mode transitions.
  useEffect(() => {
    if (reducedMotion) return undefined;
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
      const target =
        lightSource === "thinking" && lightOnRef.current ? 1 : 0;
      let env = flameEnvRef.current;
      env += (target - env) * 0.04;
      if (Math.abs(target - env) < 0.0005) env = target;
      flameEnvRef.current = env;

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
      const cTarget =
        lightSourceRef.current !== "cursor" ||
        pressedRef.current ||
        dimCursorRef.current ||
        !lightOnRef.current
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
  }, [cursorPeakDiff, cursorPeakSpec, reducedMotion]);

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
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
            x="0"
            y="0"
            width={VBW}
            height={VBH}
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
                dominates and the unlit side reads near-black. */}
            <feDiffuseLighting
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
              diffuseConstant={0}
              lightingColor={palette.stoneLit}
              result="cursorLit"
            >
              <fePointLight ref={registerLight} x={VBW / 2} y={VBH * 0.4} z={cursorZ} />
            </feDiffuseLighting>

            <feSpecularLighting
              ref={cursorSpecRef}
              in="rockSharp"
              surfaceScale={surfaceScale}
              specularConstant={0}
              specularExponent={specExponent}
              lightingColor={palette.stoneSpec}
              result="cursorSpec"
            >
              <fePointLight ref={registerLight} x={VBW / 2} y={VBH * 0.4} z={specZ} />
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
            <stop offset="0%" stopColor={palette.stoneLit} stopOpacity={0.10 * lightK} />
            <stop offset="60%" stopColor={palette.stoneLit} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="logosVignette" cx="50%" cy="50%" r="75%">
            <stop offset="55%" stopColor="#000" stopOpacity={0} />
            <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
          </radialGradient>
        </defs>

        <rect width={VBW} height={VBH} filter="url(#logosRockCliff)" />
        <rect width={VBW} height={VBH} fill="url(#logosBeam)" style={{ mixBlendMode: "screen" }} />
        <rect width={VBW} height={VBH} fill="url(#logosVignette)" />
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
