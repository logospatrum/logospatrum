"use client";

import { LogosShell } from "@/components/logos/LogosShell";
import { StreamProvider } from "@/providers/Stream";
import { ThreadProvider } from "@/providers/Thread";
import { ArtifactProvider } from "@/components/thread/artifact";
import { Toaster } from "@/components/ui/sonner";
import React from "react";

// LogosShell replaces the original `Thread` component from agent-chat-ui.
// We keep StreamProvider / ThreadProvider / ArtifactProvider intact so the
// real LangGraph stream, localStorage thread history, and artifact panel
// continue to work — only the visual shell changes.
export default function HomePage(): React.ReactNode {
  return (
    <React.Suspense fallback={null}>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <ArtifactProvider>
            <LogosShell />
          </ArtifactProvider>
        </StreamProvider>
      </ThreadProvider>
    </React.Suspense>
  );
}
