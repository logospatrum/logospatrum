import React, {
  createContext,
  useContext,
  ReactNode,
  useEffect,
} from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import { type Message } from "@langchain/langgraph-sdk";
import {
  uiMessageReducer,
  isUIMessage,
  isRemoveUIMessage,
  type UIMessage,
  type RemoveUIMessage,
} from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { useThreadStore } from "./Thread";
import { toast } from "sonner";

export type StateType = { messages: Message[]; ui?: UIMessage[] };

const useTypedStream = useStream<
  StateType,
  {
    UpdateType: {
      messages?: Message[] | Message | string;
      ui?: (UIMessage | RemoveUIMessage)[] | UIMessage | RemoveUIMessage;
      context?: Record<string, unknown>;
    };
    CustomEventType: UIMessage | RemoveUIMessage;
  }
>;

type StreamContextType = ReturnType<typeof useTypedStream>;
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

// Default values (used if env vars are unset).
const DEFAULT_API_URL = "http://localhost:2024";
const DEFAULT_ASSISTANT_ID = "agent";

const StreamSession = ({
  children,
  apiUrl,
  assistantId,
}: {
  children: ReactNode;
  apiUrl: string;
  assistantId: string;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { saveCurrent } = useThreadStore();

  const streamValue = useTypedStream({
    apiUrl,
    assistantId,
    threadId: threadId ?? null,
    fetchStateHistory: { limit: 25 },
    // Batch SDK notify calls. Without this every SSE chunk fires
    // useSyncExternalStore on every token and re-renders the whole subtree.
    // 50ms is the sweet spot between smooth text and CPU savings.
    throttle: 50,
    onCustomEvent: (event, options) => {
      if (isUIMessage(event) || isRemoveUIMessage(event)) {
        options.mutate((prev) => {
          const ui = uiMessageReducer(prev.ui ?? [], event);
          return { ...prev, ui };
        });
      }
    },
    onThreadId: (id) => {
      setThreadId(id);
      // Save thread metadata to localStorage so the sidebar can list it.
      saveCurrent(id, []);
    },
  });

  // Persist the current thread to localStorage whenever its messages change.
  useEffect(() => {
    if (!threadId) return;
    if (!streamValue.messages || streamValue.messages.length === 0) return;
    saveCurrent(threadId, streamValue.messages);
  }, [threadId, streamValue.messages, saveCurrent]);

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
    <StreamContext.Provider value={streamValue}>
      {children}
    </StreamContext.Provider>
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
    <StreamSession
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
    >
      {children}
    </StreamSession>
  );
};

// Create a custom hook to use the context
export const useStreamContext = (): StreamContextType => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error("useStreamContext must be used within a StreamProvider");
  }
  return context;
};

export default StreamContext;
