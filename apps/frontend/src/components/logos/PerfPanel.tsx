"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Frame-budget profiler overlay. Off by default; control from console:
 *
 *   __perf.show()        — open
 *   __perf.hide()        — close
 *   __perf.toggle()      — flip
 *   __perf.reset()       — zero counters and rolling window
 *   __perf.dump()        — log the current ring buffer to console
 *
 * `?perf=1` in the URL auto-opens it on load.
 *
 * The numbers shown:
 *
 *   fps   — 1000 / median(dt) over a ~120-frame rolling window. Median,
 *           not instant — instant fps flickers because v-sync misses
 *           alternate between fastest (1× display refresh) and 2× /
 *           3×, and an average over the window is what tells you the
 *           sustained rate.
 *   1%low — 1st-percentile fps over the window (the slowest frames).
 *   js    — median ms of main-thread JS work per frame. Measured via a
 *           setTimeout(0) scheduled inside the rAF tick — that callback
 *           fires after ALL sync work in the current task is done but
 *           before next paint, so the delta from rAF callback start
 *           to the setTimeout fire = total main-thread time spent
 *           inside this frame's task.
 *   gpu   — median (dt − js). If dt is 14ms on a 144Hz monitor and js is
 *           1ms, the other 13ms is compositor + paint + waiting for the
 *           next vsync. This is the bucket SVG-filter cost shows up in.
 *   lt    — count of "long tasks" observed via PerformanceObserver — any
 *           main-thread task longer than 50ms.
 *   mem   — JS heap used / limit, only available in Chrome (non-standard
 *           `performance.memory`). Comma when unavailable.
 *
 * Cost when hidden: zero (no observers, no rAF). When visible: one rAF
 * loop + one PerformanceObserver + a 250ms-throttled React update.
 */

interface Stats {
  fps: number;
  lowFps: number;
  jsMedian: number;
  gpuMedian: number;
  longtasks: number;
  worstLt: number;
  mem: string;
  jank: number;
}

const RING = 120;
const JANK_FRAME_MS = 33;

type PerfHandle = {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  reset: () => void;
  dump: () => void;
};

interface ChromeMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: ChromeMemory;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + "KB";
  return (n / 1024 / 1024).toFixed(1) + "MB";
}

export function PerfPanel() {
  const [visible, setVisible] = useState(false);
  const [stats, setStats] = useState<Stats>({
    fps: 0,
    lowFps: 0,
    jsMedian: 0,
    gpuMedian: 0,
    longtasks: 0,
    worstLt: 0,
    mem: "—",
    jank: 0,
  });

  const dtRing = useRef<number[]>([]);
  const jsRing = useRef<number[]>([]);
  const jankRef = useRef(0);
  const longtasksRef = useRef(0);
  const worstLtRef = useRef(0);

  // Console handle + ?perf=1 auto-open.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const reset = () => {
      dtRing.current = [];
      jsRing.current = [];
      jankRef.current = 0;
      longtasksRef.current = 0;
      worstLtRef.current = 0;
    };
    const dump = () => {
      const dt = dtRing.current;
      const js = jsRing.current;
      console.group("%cPerfPanel dump", "color:#8be9fd;font-weight:600");
      console.log("samples (dt):", dt.length);
      console.log("dt median:", median(dt).toFixed(2), "ms");
      console.log("dt p99:", percentile(dt, 0.99).toFixed(2), "ms");
      console.log("dt min:", Math.min(...dt).toFixed(2), "ms");
      console.log("dt max:", Math.max(...dt).toFixed(2), "ms");
      console.log("js median:", median(js).toFixed(2), "ms");
      console.log("js p95:", percentile(js, 0.95).toFixed(2), "ms");
      console.log("longtasks:", longtasksRef.current, "worst:", worstLtRef.current.toFixed(0), "ms");
      console.log("raw dt:", dt);
      console.log("raw js:", js);
      console.groupEnd();
    };
    const handle: PerfHandle = {
      show: () => setVisible(true),
      hide: () => setVisible(false),
      toggle: () => setVisible((v) => !v),
      reset,
      dump,
    };
    (window as unknown as { __perf?: PerfHandle }).__perf = handle;
    if (new URLSearchParams(window.location.search).get("perf") === "1") {
      setVisible(true);
    }
    console.info(
      "%cPerfPanel ready",
      "color:#8be9fd;font-weight:600",
      "— __perf.show() / .hide() / .toggle() / .reset() / .dump()",
    );
    return () => {
      delete (window as unknown as { __perf?: unknown }).__perf;
    };
  }, []);

  // Measurement loop — only while visible.
  useEffect(() => {
    if (!visible) return undefined;
    let raf = 0;
    let displayId = 0;
    let lastTick = performance.now();

    // Longtask observer: any main-thread task > 50ms (PerformanceObserver
    // standard threshold). Browsers without LongTask API just won't fire.
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longtasksRef.current += 1;
          if (entry.duration > worstLtRef.current) {
            worstLtRef.current = entry.duration;
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask not supported */
    }

    const tick = (now: number) => {
      const dt = now - lastTick;
      lastTick = now;
      const dring = dtRing.current;
      dring.push(dt);
      if (dring.length > RING) dring.shift();
      if (dt > JANK_FRAME_MS) jankRef.current += 1;

      // Measure main-thread JS time inside the current frame's task.
      // setTimeout(0) inside a rAF callback fires AFTER all sync work in
      // the current task completes (including other rAF callbacks queued
      // for this frame), and crucially BEFORE the next paint. So:
      //
      //   delta = (when setTimeout fires) - (rAF callback start)
      //         = total main-thread JS work in this frame's task
      //
      // This catches Background.tsx's two rAF loops + our own + any
      // React commits triggered in this frame.
      const rafStart = now;
      window.setTimeout(() => {
        const jsTime = performance.now() - rafStart;
        const jring = jsRing.current;
        jring.push(jsTime);
        if (jring.length > RING) jring.shift();
      }, 0);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const refresh = () => {
      const dts = dtRing.current;
      if (dts.length === 0) return;
      const dtMed = median(dts);
      const dtP99 = percentile(dts, 0.99);
      const jsMed = median(jsRing.current);
      const gpuMed = Math.max(0, dtMed - jsMed);
      const perf = performance as PerformanceWithMemory;
      const mem = perf.memory
        ? `${fmtBytes(perf.memory.usedJSHeapSize)} / ${fmtBytes(perf.memory.jsHeapSizeLimit)}`
        : "—";
      setStats({
        fps: Math.round(1000 / Math.max(dtMed, 0.001)),
        lowFps: Math.round(1000 / Math.max(dtP99, 0.001)),
        jsMedian: jsMed,
        gpuMedian: gpuMed,
        longtasks: longtasksRef.current,
        worstLt: worstLtRef.current,
        mem,
        jank: jankRef.current,
      });
    };
    displayId = window.setInterval(refresh, 250) as unknown as number;

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(displayId);
      observer?.disconnect();
    };
  }, [visible]);

  if (!visible) return null;

  const fpsColor = (n: number) =>
    n >= 110 ? "#5bd16a" : n >= 55 ? "#a8d168" : n >= 30 ? "#ffd166" : "#e85d65";
  const msColor = (ms: number, budget: number) =>
    ms < budget * 0.6 ? "#5bd16a" : ms < budget * 0.9 ? "#ffd166" : "#e85d65";

  // Display-refresh-aware budget. Most users 60Hz → 16.67ms; high-refresh
  // would want lower. We can't read the actual rate from JS, so 16.67ms
  // is the universal "you've got a problem" line.
  const FRAME_BUDGET_MS = 16.67;

  const Row = ({
    label,
    value,
    color,
    suffix,
  }: {
    label: string;
    value: string | number;
    color?: string;
    suffix?: string;
  }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
      <span style={{ color: "rgba(236,230,214,0.45)" }}>{label}</span>
      <span style={{ color: color ?? "#ece6d6", fontVariantNumeric: "tabular-nums" }}>
        {value}
        {suffix && (
          <span style={{ color: "rgba(236,230,214,0.35)", marginLeft: 2 }}>
            {suffix}
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 99999,
        background: "rgba(11,12,14,0.88)",
        border: "0.5px solid rgba(238,232,218,0.18)",
        borderRadius: 6,
        padding: "8px 12px",
        fontFamily:
          "var(--font-geist-mono, ui-monospace), Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#ece6d6",
        letterSpacing: "0.04em",
        pointerEvents: "none",
        minWidth: 168,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        userSelect: "none",
      }}
    >
      <Row label="fps" value={stats.fps} color={fpsColor(stats.fps)} />
      <Row label="1%low" value={stats.lowFps} color={fpsColor(stats.lowFps)} />
      <Row
        label="js"
        value={stats.jsMedian.toFixed(1)}
        suffix="ms"
        color={msColor(stats.jsMedian, FRAME_BUDGET_MS)}
      />
      <Row
        label="gpu"
        value={stats.gpuMedian.toFixed(1)}
        suffix="ms"
        color={msColor(stats.gpuMedian, FRAME_BUDGET_MS)}
      />
      <Row
        label="lt"
        value={stats.longtasks}
        color={stats.longtasks > 0 ? "#ffd166" : "rgba(236,230,214,0.45)"}
        suffix={
          stats.worstLt > 0 ? `· ${stats.worstLt.toFixed(0)}ms` : undefined
        }
      />
      <Row
        label="jank"
        value={stats.jank}
        color={stats.jank > 0 ? "#ffd166" : "rgba(236,230,214,0.45)"}
      />
      <Row label="mem" value={stats.mem} />
    </div>
  );
}
