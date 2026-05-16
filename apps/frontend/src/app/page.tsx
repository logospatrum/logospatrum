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
// ArtifactProvider was removed: the backend doesn't currently emit UI
// messages or artifacts, and nothing inside LogosShell calls useArtifact().
// If that capability returns, wire the provider back here and add an
// artifact panel inside LogosShell.
export default function HomePage(): React.ReactNode {
  return (
    <React.Suspense fallback={null}>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <LogosShell />
        </StreamProvider>
      </ThreadProvider>
    </React.Suspense>
  );
}
