import { cookies } from "next/headers";

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
export default async function HomePage(): Promise<React.ReactNode> {
  // `pat_light` cookie carries the user's last LIGHT toggle. Reading it
  // here (server component) lets us hand the correct initial value to
  // LogosShell *before* SSR, so the rendered HTML already reflects the
  // user's preference — no `useState(true)` → useEffect → flip flicker
  // after hydration. Missing or unrecognised value defaults to ON.
  const cookieStore = await cookies();
  const initialLightOn = cookieStore.get("pat_light")?.value !== "0";
  return (
    <>
      <Toaster theme="dark" />
      <ThreadProvider>
        <StreamProvider>
          <LogosShell initialLightOn={initialLightOn} />
        </StreamProvider>
      </ThreadProvider>
    </>
  );
}
