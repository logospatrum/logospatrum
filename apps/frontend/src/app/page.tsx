"use client";

import { LogosShell } from "@/components/logos/LogosShell";
import { StreamProvider } from "@/providers/Stream";
import { ThreadProvider } from "@/providers/Thread";
import { Toaster } from "@/components/ui/sonner";
import React from "react";

// LogosShell replaces the original `Thread` component from agent-chat-ui.
// We keep StreamProvider / ThreadProvider intact so the real LangGraph
// stream and localStorage thread history continue to work — only the
// visual shell changes.
//
// No `<Suspense>` boundary here — `StreamProvider` now reads `threadId`
// via `useEffect` on `window.location.search` (see providers/Stream.tsx
// `useUrlThreadId`) instead of nuqs's `useQueryState`, so the tree no
// longer suspends on `useSearchParams`. The full LogosShell renders in
// SSR HTML — input lands at its CSS-fallback position on the first
// paint, and the post-hydration measurement smoothly slides it into
// its final slot via the existing 480ms `top` transition.
//
// ArtifactProvider was removed: the backend doesn't currently emit UI
// messages or artifacts, and nothing inside LogosShell calls useArtifact().
// If that capability returns, wire the provider back here and add an
// artifact panel inside LogosShell.
export default function HomePage(): React.ReactNode {
  return (
    <>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <LogosShell />
        </StreamProvider>
      </ThreadProvider>
    </>
  );
}
