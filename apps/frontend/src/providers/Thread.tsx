"use client";

import { Thread } from "@langchain/langgraph-sdk";
import type { Message } from "@langchain/langgraph-sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  deleteThread as deleteThreadFromStore,
  deriveTitle,
  loadThreads,
  toSdkThread,
  upsertThread,
  type StoredThread,
} from "@/lib/local-thread-store";

// Public hook API — kept compatible with the upstream agent-chat-ui surface so
// history/sidebar code in `components/thread/history` continues to work
// unchanged. The only behavioural change is that data comes from localStorage
// instead of a server-side LangGraph thread API.
interface ThreadContextType {
  getThreads: () => Promise<Thread[]>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

// Extra store API that Stream.tsx uses to persist outgoing/incoming messages.
interface ThreadStoreApi {
  saveCurrent: (threadId: string, messages: Message[]) => void;
  removeThread: (threadId: string) => void;
  refresh: () => void;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);
const ThreadStoreContext = createContext<ThreadStoreApi | undefined>(undefined);

function readAllAsSdk(): Thread[] {
  const stored = loadThreads();
  // Show most recently updated first.
  return [...stored]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSdkThread);
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(async (): Promise<Thread[]> => {
    return readAllAsSdk();
  }, []);

  // Hydrate on mount (and keep in sync if another tab updates storage).
  useEffect(() => {
    setThreads(readAllAsSdk());
    const onStorage = (e: StorageEvent) => {
      if (e.key && !e.key.startsWith("patristic:threads")) return;
      setThreads(readAllAsSdk());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const saveCurrent = useCallback(
    (threadId: string, messages: Message[]) => {
      const existing = loadThreads().find((t) => t.id === threadId);
      const now = Date.now();
      const next: StoredThread = {
        id: threadId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        title:
          messages.length > 0
            ? deriveTitle(messages)
            : (existing?.title ?? "Новый разговор"),
        messages,
      };
      upsertThread(next);
      setThreads(readAllAsSdk());
    },
    [],
  );

  const removeThread = useCallback((threadId: string) => {
    deleteThreadFromStore(threadId);
    setThreads(readAllAsSdk());
  }, []);

  const refresh = useCallback(() => {
    setThreads(readAllAsSdk());
  }, []);

  const value: ThreadContextType = {
    getThreads,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  };

  const storeApi: ThreadStoreApi = { saveCurrent, removeThread, refresh };

  return (
    <ThreadContext.Provider value={value}>
      <ThreadStoreContext.Provider value={storeApi}>
        {children}
      </ThreadStoreContext.Provider>
    </ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}

export function useThreadStore() {
  const context = useContext(ThreadStoreContext);
  if (context === undefined) {
    throw new Error("useThreadStore must be used within a ThreadProvider");
  }
  return context;
}
