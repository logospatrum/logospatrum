// apps/frontend/src/providers/Stream.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  ReactNode,
  useEffect,
  useState,
} from "react";
import type { Message } from "@langchain/langgraph-sdk";
import { toast } from "sonner";

import { useStatelessStream } from "@/lib/useStatelessStream";
import { loadThreads } from "@/lib/local-thread-store";
import { useThreadStore } from "./Thread";

/**
 * URL-driven `threadId` state — replaces `nuqs.useQueryState("threadId")`.
 *
 * nuqs used `next/navigation.useSearchParams()` under the hood, which forces
 * the entire route to bail out to client-side rendering inside its nearest
 * Suspense boundary. That bail-out is why the page used to ship a skeleton
 * in the SSR HTML and "pop" the real layout in after hydration. By reading
 * the URL via `useEffect` instead, the calling tree (including this Stream
 * provider AND LogosShell) renders fully on the server and hydrates without
 * suspending — no skeleton needed.
 *
 * Trade-off: the SSR HTML doesn't carry the `threadId` value (the server
 * has no access to `window.location.search` here, and we'd rather not lift
 * the read into a server component). The first render always shows "home"
 * mode; the URL-driven thread switch happens 1 paint later via the effect.
 * For users who land on `/?threadId=xxx` this means home flashes briefly
 * before the chat history loads from localStorage — acceptable, since the
 * history hydration was already async (it comes from localStorage, not the
 * server).
 */
function useUrlThreadId(): [string | null, (next: string | null) => void] {
  const [threadId, setThreadIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      setThreadIdState(params.get("threadId"));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const setThreadId = useCallback((next: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next == null || next === "") {
      url.searchParams.delete("threadId");
    } else {
      url.searchParams.set("threadId", next);
    }
    // replaceState (not pushState) so the back button doesn't accumulate one
    // history entry per thread switch — matches the previous nuqs default.
    window.history.replaceState(null, "", url.toString());
    setThreadIdState(next);
  }, []);

  return [threadId, setThreadId];
}

type StreamContextType = ReturnType<typeof useStatelessStream> & {
  threadId: string | null;
  setThreadId: (next: string | null) => void;
};
const StreamContext = createContext<StreamContextType | undefined>(undefined);

async function checkGraphStatus(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/info`);
    return res.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Default to the Next.js proxy at /api so the HMAC + budget guard chain
// is always engaged (dev frontend 3001 → /api/* → backend 8000 via
// BACKEND_URL server-side env). To bypass, set NEXT_PUBLIC_API_URL.
const DEFAULT_API_URL = "/api";
const DEFAULT_ASSISTANT_ID = "patristic";

const StreamSession = ({
  children,
  apiUrl,
  assistantId,
}: {
  children: ReactNode;
  apiUrl: string;
  assistantId: string;
}) => {
  const [threadId, setThreadId] = useUrlThreadId();
  const { saveCurrent } = useThreadStore();

  const stream = useStatelessStream({ apiUrl, assistantId });

  // Thread switching: when the URL threadId changes, hydrate `messages` from
  // localStorage. This replaces the server-side fetchStateHistory path.
  useEffect(() => {
    if (!threadId) {
      stream.setMessages([]);
      return;
    }
    const stored = loadThreads().find((t) => t.id === threadId);
    // If the thread isn't in storage yet, it's a freshly-promoted thread
    // (LogosShell.submit just set threadId during the first message). Leave
    // the in-memory messages alone so we don't clobber the optimistic state.
    if (!stored) return;
    stream.setMessages(stored.messages);
    // We only want this to fire on threadId changes, not on every render of
    // the hook value — stream.setMessages is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Persist the active thread to localStorage on every messages change.
  useEffect(() => {
    if (!threadId) return;
    if (!stream.messages || stream.messages.length === 0) return;
    saveCurrent(threadId, stream.messages as Message[]);
  }, [threadId, stream.messages, saveCurrent]);

  useEffect(() => {
    checkGraphStatus(apiUrl).then((ok) => {
      if (!ok) {
        toast.error("Не удалось подключиться к LangGraph", {
          description: () => (
            <p>
              Проверьте, что бэкенд запущен на <code>{apiUrl}</code>.
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiUrl]);

  // Bundle threadId state into the context so LogosShell consumes URL state
  // from the same hook instance — keeping us off `useSearchParams` entirely.
  const value: StreamContextType = { ...stream, threadId, setThreadId };
  return (
    <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
  );
};

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId: string | undefined =
    process.env.NEXT_PUBLIC_ASSISTANT_ID;

  const finalApiUrl = envApiUrl || DEFAULT_API_URL;
  const finalAssistantId = envAssistantId || DEFAULT_ASSISTANT_ID;

  return (
    <StreamSession apiUrl={finalApiUrl} assistantId={finalAssistantId}>
      {children}
    </StreamSession>
  );
};

export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
