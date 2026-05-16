// apps/frontend/src/providers/Stream.tsx
import React, {
  createContext,
  useContext,
  ReactNode,
  useEffect,
} from "react";
import type { Message } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import { toast } from "sonner";

import { useStatelessStream } from "@/lib/useStatelessStream";
import { loadThreads } from "@/lib/local-thread-store";
import { useThreadStore } from "./Thread";

type StreamContextType = ReturnType<typeof useStatelessStream>;
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

const DEFAULT_API_URL = "http://localhost:2024";
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
  const [threadId] = useQueryState("threadId");
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

  return (
    <StreamContext.Provider value={stream}>{children}</StreamContext.Provider>
  );
};

export const StreamProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const envApiUrl: string | undefined =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL;
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
