"use client";

import { LogosShell } from "@/components/logos/LogosShell";
import { StreamProvider } from "@/providers/Stream";
import { ThreadProvider } from "@/providers/Thread";
import { Toaster } from "@/components/ui/sonner";
import React from "react";

// Static pre-hydration skeleton. Painted by Next.js SSR before any JS
// arrives, and again by React while the suspense boundary below resolves
// (nuqs `useQueryState` causes a useSearchParams bail-out that defers
// the real tree to client). The skeleton keeps the page from looking
// blank on Ctrl+F5 and gives the chat input a visible footprint at the
// same position the real Monolith lands at after hydration — so the
// transition is "fill in" rather than "pop in".
function HomeSkeleton(): React.ReactNode {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0c0e",
        zIndex: 0,
        pointerEvents: "none",
      }}
    >
      {/* Input slot silhouette — matches LogosShell.Monolith desktop home
          (centered, 720px wide) and chat/narrow (bottom-pinned). Drawn in
          CSS only; no JS or font work needed for first paint. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(720px, 92vw)",
          height: 115,
          border: "0.5px solid rgba(238, 232, 218, 0.08)",
          borderRadius: 18,
          background: "#15171b",
        }}
      />
    </div>
  );
}

// LogosShell replaces the original `Thread` component from agent-chat-ui.
// We keep StreamProvider / ThreadProvider intact so the real LangGraph
// stream and localStorage thread history continue to work — only the
// visual shell changes.
//
// ArtifactProvider was removed: the backend doesn't currently emit UI
// messages or artifacts, and nothing inside LogosShell calls useArtifact().
// If that capability returns, wire the provider back here and add an
// artifact panel inside LogosShell.
export default function HomePage(): React.ReactNode {
  return (
    <React.Suspense fallback={<HomeSkeleton />}>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <LogosShell />
        </StreamProvider>
      </ThreadProvider>
    </React.Suspense>
  );
}
