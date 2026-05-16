# Stateless chat storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/frontend` the single source of truth for chat history by replacing the LangGraph `useStream` hook (server-state oriented) with a custom `useStatelessStream` hook that submits threadless runs and stores everything in localStorage.

**Architecture:** Frontend keeps the existing localStorage thread store unchanged. A new hook submits `client.runs.stream(null, "agent", {input: {messages}})` and exposes `{messages, isLoading, error, submit, stop, setMessages}`. Regenerate/Edit slice the messages array in localStorage instead of using server-side `parent_checkpoint`. Backend (`backend.graph`) is not touched.

**Tech Stack:** TypeScript, React 19, Next.js 15 (app router, "use client"), `@langchain/langgraph-sdk` 1.8.10, vitest + @testing-library/react, jsdom.

**Spec:** [docs/superpowers/specs/2026-05-16-stateless-chat-storage-design.md](../specs/2026-05-16-stateless-chat-storage-design.md)

---

## File Structure

**Created:**

- `apps/frontend/src/lib/chat-history-slice.ts` — pure functions `sliceForRegenerate` and `sliceForEdit`. Pulled out of `LogosShell.tsx` so they're testable.
- `apps/frontend/src/lib/__tests__/chat-history-slice.test.ts` — unit tests for the slice helpers.
- `apps/frontend/src/lib/useStatelessStream.ts` — React hook that replaces `@langchain/langgraph-sdk/react#useStream` for our threadless model.
- `apps/frontend/src/lib/__tests__/useStatelessStream.test.tsx` — unit tests with mocked `client.runs.stream` async iterator.

**Modified:**

- `apps/frontend/src/providers/Stream.tsx` — swap `useTypedStream` → `useStatelessStream`; drop `fetchStateHistory`/`onThreadId`/`onCustomEvent`; add thread-switching effect that loads messages from localStorage on `threadId` change.
- `apps/frontend/src/components/logos/LogosShell.tsx` — rewrite `handleRegenerate` and `handleEditHuman` to use the slice helpers; drop `getMessagesMetadata`/`parent_checkpoint`; drop `streamResumable` from all `submit` calls.

**Not touched:**

- `apps/frontend/src/providers/Thread.tsx`, `apps/frontend/src/lib/local-thread-store.ts`, `apps/frontend/src/lib/ensure-tool-responses.ts`.
- `apps/backend/**`.

---

### Task 1: Slice helpers — failing tests

**Files:**

- Create: `apps/frontend/src/lib/__tests__/chat-history-slice.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/frontend/src/lib/__tests__/chat-history-slice.test.ts
import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { sliceForRegenerate, sliceForEdit } from "../chat-history-slice";

function human(id: string, text: string): Message {
  return { id, type: "human", content: text } as Message;
}
function ai(id: string, text: string): Message {
  return { id, type: "ai", content: text } as Message;
}
function tool(id: string, callId: string): Message {
  return { id, type: "tool", tool_call_id: callId, content: "ok" } as Message;
}

describe("sliceForRegenerate", () => {
  it("returns input through the last human (drops trailing assistant turn)", () => {
    const msgs: Message[] = [
      human("h1", "first question"),
      ai("a1", "first answer"),
      human("h2", "second question"),
      ai("a2", "second answer"),
    ];
    expect(sliceForRegenerate(msgs)).toEqual([
      human("h1", "first question"),
      ai("a1", "first answer"),
      human("h2", "second question"),
    ]);
  });

  it("drops tool messages between the last human and the trailing assistant", () => {
    const msgs: Message[] = [
      human("h1", "q"),
      ai("a1", "calling tool", ),
      tool("t1", "call-1"),
      ai("a2", "final answer"),
    ];
    expect(sliceForRegenerate(msgs)).toEqual([human("h1", "q")]);
  });

  it("returns empty array when there is no human message", () => {
    expect(sliceForRegenerate([])).toEqual([]);
    expect(sliceForRegenerate([ai("a", "stray")])).toEqual([]);
  });
});

describe("sliceForEdit", () => {
  it("replaces target human content and drops everything after", () => {
    const msgs: Message[] = [
      human("h1", "first"),
      ai("a1", "first answer"),
      human("h2", "second"),
      ai("a2", "second answer"),
    ];
    const out = sliceForEdit(msgs, "h2", "second edited");
    expect(out).toEqual([
      human("h1", "first"),
      ai("a1", "first answer"),
      { id: "h2", type: "human", content: "second edited" },
    ]);
  });

  it("returns the original array when target id is not found", () => {
    const msgs: Message[] = [human("h1", "q"), ai("a1", "a")];
    expect(sliceForEdit(msgs, "missing", "new")).toBe(msgs);
  });

  it("works when target is the first message", () => {
    const msgs: Message[] = [
      human("h1", "first"),
      ai("a1", "answer"),
    ];
    expect(sliceForEdit(msgs, "h1", "edited")).toEqual([
      { id: "h1", type: "human", content: "edited" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- chat-history-slice`
Expected: FAIL — `Cannot find module '../chat-history-slice'`.

---

### Task 2: Slice helpers — implementation

**Files:**

- Create: `apps/frontend/src/lib/chat-history-slice.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// apps/frontend/src/lib/chat-history-slice.ts
import type { Message } from "@langchain/langgraph-sdk";

/**
 * Slice the chat history so a regenerate can be re-submitted. Drops everything
 * after the last human message (the assistant turn we want to redo). Returns
 * an empty array if there is no human message.
 */
export function sliceForRegenerate(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "human") {
      return messages.slice(0, i + 1);
    }
  }
  return [];
}

/**
 * Slice the chat history so an edited human message can be re-submitted.
 * Replaces the content of the message with `humanId` and drops every message
 * after it. Returns the original array (same reference) if the id is not
 * found, so callers can no-op cheaply.
 */
export function sliceForEdit(
  messages: Message[],
  humanId: string,
  newText: string,
): Message[] {
  const idx = messages.findIndex((m) => m.id === humanId);
  if (idx < 0) return messages;
  const target = messages[idx];
  const replaced: Message = { ...target, content: newText } as Message;
  return [...messages.slice(0, idx), replaced];
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- chat-history-slice`
Expected: PASS — all 6 cases green.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/chat-history-slice.ts apps/frontend/src/lib/__tests__/chat-history-slice.test.ts
git commit -m "feat(frontend): add pure chat-history slice helpers for regenerate/edit"
```

---

### Task 3: useStatelessStream — failing tests

**Files:**

- Create: `apps/frontend/src/lib/__tests__/useStatelessStream.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/lib/__tests__/useStatelessStream.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Message } from "@langchain/langgraph-sdk";

// Hoisted mock — must be set up before the hook module is imported.
const streamMock = vi.fn();
vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn().mockImplementation(() => ({
    runs: { stream: streamMock },
  })),
}));

import { useStatelessStream } from "../useStatelessStream";

// Build an async iterator from a fixed list of events. Resolves when consumed.
function asyncIter<T>(events: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const ev of events) {
        // Yield on a microtask so React state updates can flush.
        await Promise.resolve();
        yield ev;
      }
    },
  };
}

const human = (id: string, text: string): Message =>
  ({ id, type: "human", content: text }) as Message;
const ai = (id: string, text: string): Message =>
  ({ id, type: "ai", content: text }) as Message;

beforeEach(() => {
  streamMock.mockReset();
});

describe("useStatelessStream", () => {
  it("submit invokes client.runs.stream with thread=null and the full messages input", async () => {
    streamMock.mockReturnValue(asyncIter([]));
    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );

    await act(async () => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(streamMock).toHaveBeenCalledTimes(1);
    const [thread, assistantId, opts] = streamMock.mock.calls[0];
    expect(thread).toBeNull();
    expect(assistantId).toBe("agent");
    expect(opts.input).toEqual({ messages: [human("h1", "hi")] });
    expect(opts.streamMode).toEqual(["values"]);
    expect(opts.streamSubgraphs).toBe(true);
  });

  it("optimistically sets messages to input.messages before the first chunk", async () => {
    // Stream that never yields — verifies the optimistic state without races.
    streamMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        // Hang forever (will be aborted on unmount via test cleanup).
        await new Promise(() => {});
      },
    });

    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );

    act(() => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });

    expect(result.current.messages).toEqual([human("h1", "hi")]);
    expect(result.current.isLoading).toBe(true);
  });

  it("updates messages on each top-level values event", async () => {
    streamMock.mockReturnValue(
      asyncIter([
        { event: "values", data: { messages: [human("h1", "hi")] } },
        {
          event: "values",
          data: { messages: [human("h1", "hi"), ai("a1", "hello")] },
        },
      ]),
    );
    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    await act(async () => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([
      human("h1", "hi"),
      ai("a1", "hello"),
    ]);
  });

  it("ignores subgraph values events (event name has a namespace suffix)", async () => {
    streamMock.mockReturnValue(
      asyncIter([
        { event: "values", data: { messages: [human("h1", "hi")] } },
        // Subagent's internal scratchpad — must NOT overwrite root messages.
        { event: "values|search", data: { messages: [ai("scratch", "irrelevant")] } },
      ]),
    );
    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    await act(async () => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([human("h1", "hi")]);
  });

  it("stop aborts the current run and clears isLoading", async () => {
    let aborted = false;
    streamMock.mockImplementation((_t, _a, opts) => ({
      async *[Symbol.asyncIterator]() {
        opts.signal?.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise<void>((resolve) => {
          opts.signal?.addEventListener("abort", () => resolve());
        });
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    }));

    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    act(() => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });
    expect(result.current.isLoading).toBe(true);
    act(() => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(aborted).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("submit during an active run aborts the previous run before starting a new one", async () => {
    const callOrder: string[] = [];
    streamMock.mockImplementation((_t, _a, opts) => ({
      async *[Symbol.asyncIterator]() {
        const tag = streamMock.mock.calls.length === 1 ? "first" : "second";
        callOrder.push(`start:${tag}`);
        opts.signal?.addEventListener("abort", () => {
          callOrder.push(`abort:${tag}`);
        });
        if (tag === "first") {
          await new Promise<void>((resolve) => {
            opts.signal?.addEventListener("abort", () => resolve());
          });
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        yield { event: "values", data: { messages: [human("h2", "second")] } };
      },
    }));

    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    act(() => {
      result.current.submit({ messages: [human("h1", "first")] });
    });
    act(() => {
      result.current.submit({ messages: [human("h2", "second")] });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(callOrder).toEqual(["start:first", "abort:first", "start:second"]);
    expect(result.current.messages).toEqual([human("h2", "second")]);
  });

  it("error events surface as error state and isLoading clears", async () => {
    streamMock.mockReturnValue(
      asyncIter([{ event: "error", data: { message: "model 401" } }]),
    );
    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    await act(async () => {
      result.current.submit({ messages: [human("h1", "hi")] });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error?.message).toBe("model 401");
  });

  it("setMessages updates messages without a network call", () => {
    const { result } = renderHook(() =>
      useStatelessStream({ apiUrl: "http://x", assistantId: "agent" }),
    );
    act(() => {
      result.current.setMessages([human("h1", "manually set")]);
    });
    expect(result.current.messages).toEqual([human("h1", "manually set")]);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npm test -- useStatelessStream`
Expected: FAIL — `Cannot find module '../useStatelessStream'`.

---

### Task 4: useStatelessStream — implementation

**Files:**

- Create: `apps/frontend/src/lib/useStatelessStream.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// apps/frontend/src/lib/useStatelessStream.ts
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Client, type Message } from "@langchain/langgraph-sdk";

export interface UseStatelessStreamOptions {
  apiUrl: string;
  assistantId: string;
}

export interface UseStatelessStreamApi {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  submit: (input: { messages: Message[] }) => void;
  stop: () => void;
  setMessages: (msgs: Message[]) => void;
}

/**
 * Threadless replacement for @langchain/langgraph-sdk/react#useStream. The
 * backend graph is invoked with no thread_id, so the server creates no
 * checkpoints. The frontend owns the full conversation history and submits
 * it on every call.
 *
 * Why: see docs/superpowers/specs/2026-05-16-stateless-chat-storage-design.md
 */
export function useStatelessStream(
  opts: UseStatelessStreamOptions,
): UseStatelessStreamApi {
  const { apiUrl, assistantId } = opts;
  const client = useMemo(() => new Client({ apiUrl }), [apiUrl]);

  const [messages, setMessagesState] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream when the consumer unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const setMessages = useCallback((msgs: Message[]) => {
    setMessagesState(msgs);
  }, []);

  const submit = useCallback(
    (input: { messages: Message[] }) => {
      // Cancel any in-flight run before starting a new one.
      abortRef.current?.abort();

      const ac = new AbortController();
      abortRef.current = ac;

      // Optimistic: show the input immediately so the UI doesn't lag the
      // first SSE chunk.
      setMessagesState(input.messages);
      setError(null);
      setIsLoading(true);

      void (async () => {
        try {
          const iter = client.runs.stream(null, assistantId, {
            input: { messages: input.messages },
            streamMode: ["values"],
            streamSubgraphs: true,
            signal: ac.signal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);

          for await (const chunk of iter as AsyncIterable<{
            event: string;
            data: unknown;
          }>) {
            if (ac.signal.aborted) break;
            if (chunk.event === "values") {
              // Top-level state from the root graph.
              const data = chunk.data as { messages?: Message[] };
              if (Array.isArray(data.messages)) {
                setMessagesState(data.messages);
              }
            } else if (chunk.event === "error") {
              const data = chunk.data as { message?: string };
              setError(new Error(data.message ?? "stream error"));
              break;
            }
            // Anything else (subgraph values like "values|search", "metadata",
            // tool progress…) is ignored: it doesn't represent root state.
          }
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            setError(e as Error);
          }
        } finally {
          if (abortRef.current === ac) {
            setIsLoading(false);
            abortRef.current = null;
          }
        }
      })();
    },
    [client, assistantId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isLoading, error, submit, stop, setMessages };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/frontend && npm test -- useStatelessStream`
Expected: PASS — all 8 cases green.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/useStatelessStream.ts apps/frontend/src/lib/__tests__/useStatelessStream.test.tsx
git commit -m "feat(frontend): add useStatelessStream hook for threadless runs"
```

---

### Task 5: Wire useStatelessStream into Stream.tsx

**Files:**

- Modify: `apps/frontend/src/providers/Stream.tsx` (full rewrite of the file body)

- [ ] **Step 1: Replace the file contents**

```tsx
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
    stream.setMessages(stored?.messages ?? []);
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
```

- [ ] **Step 2: Type-check and lint**

Run: `cd apps/frontend && npm run lint`
Expected: PASS — 0 errors (4 pre-existing react-refresh warnings are OK).

If TypeScript errors mention removed properties (`uiMessageReducer`, `StateType`, `isUIMessage`, `useStream`), those are old imports — confirm they are gone from the new file body.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/providers/Stream.tsx
git commit -m "refactor(frontend): switch Stream provider to useStatelessStream

Drops fetchStateHistory + onThreadId. Adds a thread-switching effect
that loads messages from localStorage when threadId changes."
```

---

### Task 6: Rewrite handleRegenerate in LogosShell

**Files:**

- Modify: `apps/frontend/src/components/logos/LogosShell.tsx` — the `handleRegenerate` callback at `LogosShell.tsx:156-173`.

- [ ] **Step 1: Add the slice import**

At the top of `LogosShell.tsx`, alongside other `@/lib/*` imports, add:

```typescript
import { sliceForRegenerate, sliceForEdit } from "@/lib/chat-history-slice";
```

(Both will be used; `sliceForEdit` is consumed in Task 7.)

- [ ] **Step 2: Replace handleRegenerate**

Find this block (currently `LogosShell.tsx:156-173`):

```typescript
  // Regenerate the last assistant turn. Uses the parent checkpoint from
  // the last *human* message in the stream so the new generation forks
  // off the same input.
  const handleRegenerate = useCallback(() => {
    // Find the last human message to fork from
    const reversedIdx = [...stream.messages]
      .reverse()
      .findIndex((m) => m.type === "human");
    if (reversedIdx < 0) return;
    const lastHuman =
      stream.messages[stream.messages.length - 1 - reversedIdx];
    const meta = stream.getMessagesMetadata(lastHuman);
    const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
    if (!parentCheckpoint) return;
    stream.submit(undefined, {
      checkpoint: parentCheckpoint,
      streamMode: ["values"],
      streamSubgraphs: true,
      streamResumable: true,
    });
  }, [stream]);
```

Replace with:

```typescript
  // Regenerate the last assistant turn by re-submitting the conversation
  // sliced to (and including) the last human message. No server-side
  // checkpoint involved — the frontend owns history.
  const handleRegenerate = useCallback(() => {
    const sliced = sliceForRegenerate(stream.messages);
    if (sliced.length === 0) return;
    stream.submit({ messages: sliced });
  }, [stream]);
```

- [ ] **Step 3: Run unit tests**

Run: `cd apps/frontend && npm test`
Expected: PASS — existing 21 + 6 + 8 = 35 cases green.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/logos/LogosShell.tsx
git commit -m "refactor(frontend): regenerate via message slice instead of parent_checkpoint"
```

---

### Task 7: Rewrite handleEditHuman in LogosShell

**Files:**

- Modify: `apps/frontend/src/components/logos/LogosShell.tsx` — the `handleEditHuman` callback at `LogosShell.tsx:177-204`.

- [ ] **Step 1: Replace handleEditHuman**

Find this block (currently `LogosShell.tsx:177-204`):

```typescript
  // Edit a previous human message: forks the conversation at the parent
  // checkpoint of that human and submits a new content.
  const handleEditHuman = useCallback(
    (humanId: string | undefined, newText: string) => {
      if (!humanId) return;
      const target = stream.messages.find((m) => m.id === humanId);
      if (!target) return;
      const meta = stream.getMessagesMetadata(target);
      const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
      if (!parentCheckpoint) return;
      const newMessage: Message = {
        type: "human",
        content: [{ type: "text", text: newText }] as Message["content"],
      };
      stream.submit(
        { messages: [newMessage] },
        {
          checkpoint: parentCheckpoint,
          streamMode: ["values"],
          streamSubgraphs: true,
          streamResumable: true,
          optimisticValues: (prev) => ({
            ...prev,
            messages: [...(prev.messages ?? []), newMessage],
          }),
        },
      );
    },
    [stream],
  );
```

Replace with:

```typescript
  // Edit a previous human message: replace its content and drop every
  // message after it, then re-submit the sliced history.
  const handleEditHuman = useCallback(
    (humanId: string | undefined, newText: string) => {
      if (!humanId) return;
      const sliced = sliceForEdit(stream.messages, humanId, newText);
      if (sliced === stream.messages) return; // id not found
      stream.submit({ messages: sliced });
    },
    [stream],
  );
```

- [ ] **Step 2: Simplify the normal submit (drop streamResumable + optimisticValues)**

Find this block (the `submit` callback at `LogosShell.tsx:125-151`):

```typescript
  // Submit a user message — same shape the old Thread component used.
  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stream.isLoading) return;

      const newHumanMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: [{ type: "text", text: trimmed }] as Message["content"],
      };
      const toolMessages = ensureToolCallsHaveResponses(stream.messages);
      stream.submit(
        { messages: [...toolMessages, newHumanMessage] },
        {
          streamMode: ["values"],
          streamSubgraphs: true,
          streamResumable: true,
          optimisticValues: (prev) => ({
            ...prev,
            messages: [...(prev.messages ?? []), ...toolMessages, newHumanMessage],
          }),
        },
      );
      setPrefill(undefined);
    },
    [stream],
  );
```

Replace with:

```typescript
  // Submit a user message — full history is sent because the backend is
  // stateless. Tool-call orphans (a previous run was stopped mid-turn) are
  // patched up with synthetic tool responses so the graph doesn't reject
  // the input.
  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stream.isLoading) return;

      const newHumanMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: [{ type: "text", text: trimmed }] as Message["content"],
      };
      const toolStubs = ensureToolCallsHaveResponses(stream.messages);
      stream.submit({
        messages: [...stream.messages, ...toolStubs, newHumanMessage],
      });
      setPrefill(undefined);
    },
    [stream],
  );
```

- [ ] **Step 3: Run unit tests + lint**

Run: `cd apps/frontend && npm test && npm run lint`
Expected: PASS — 35 tests green, lint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/logos/LogosShell.tsx
git commit -m "refactor(frontend): edit-human via slice; drop streamResumable + optimisticValues

Backend is stateless; submit() always sends the full conversation history
computed on the client. The optimisticValues callback is no longer
needed because useStatelessStream applies input.messages optimistically."
```

---

### Task 8: Production smoke

**Files:** none (manual verification).

- [ ] **Step 1: Build**

Run: `cd apps/frontend && npm run build`
Expected: PASS — Next.js build with no type errors.

- [ ] **Step 2: Start the backend**

In a separate terminal, from the repo root:

```powershell
cd apps/backend
$env:PYTHONUTF8=1; .\.venv\Scripts\langgraph dev --port 2024 --no-browser
```

Expected: server listens on `:2024`, `/info` returns 200.

- [ ] **Step 3: Start the frontend dev server**

```powershell
cd apps/frontend
npm run dev
```

Expected: Next dev on `:3000`.

- [ ] **Step 4: Walk through SMOKE scenarios**

Open `http://localhost:3000` and verify each:

1. **New chat**: type a question → assistant streams → answer appears with citations. Refresh page → message history persists (loaded from localStorage). ✓
2. **Switch threads**: open Sidebar, click a previous chat → its messages render instantly with no network call to `/threads/<id>/state`. (Check DevTools Network tab — only `/runs/stream` should appear, and only when you submit.) ✓
3. **Regenerate**: in a chat with at least one assistant turn, click the Regenerate pill on the last turn → assistant re-streams a new answer; the original is replaced. ✓
4. **Edit human**: hover over a previous human line → click Edit → modify text → Save → conversation reverts to that point and streams a new answer. ✓
5. **Stop**: submit a question, click Stop mid-stream → `isLoading` clears, partial answer remains visible. Then click Regenerate → fresh full answer streams. ✓
6. **Backend restart mid-session**: kill `langgraph dev`, observe SSE error toast; restart `langgraph dev` on the same port; submit a new question → answers stream again without losing history. ✓
7. **DevTools sanity**: open Network tab → confirm POST to `/runs/stream` has body `{"assistant_id": "agent", "input": {"messages": [...]}, ...}` with **no `thread_id`** field. ✓
8. **localStorage sanity**: in DevTools Application → Local Storage → `http://localhost:3000` → `patristic:threads` contains the full messages array for each thread. ✓

- [ ] **Step 5: Final commit (if any docs touch-ups landed)**

If `apps/frontend/CLAUDE.md` needs to reflect the stateless model (the line *"Patristic chat is stateless on the backend, so we keep all conversation history client-side"* is now actually true), include that touch-up:

```bash
git add apps/frontend/CLAUDE.md  # only if you edited it
git commit -m "docs(frontend): note stateless backend is now actually stateless"
```

Otherwise no final commit is needed.

---

## Self-Review

**Spec coverage:**

- ✅ "Один источник truth — localStorage" → Tasks 5 (thread-switching effect) + 6, 7 (slice helpers) keep all state on client.
- ✅ "client.runs.stream(null, ...)" → Task 4 implementation calls it directly.
- ✅ "useStream replaced" → Task 4 hook; Task 5 wires it in.
- ✅ "Regenerate via slice" → Task 6.
- ✅ "Edit via slice" → Task 7.
- ✅ "Drop fetchStateHistory, onThreadId, onCustomEvent, streamResumable, parent_checkpoint" → Tasks 5, 6, 7.
- ✅ "ensureToolCallsHaveResponses still used at submit" → Task 7 Step 2 keeps it.
- ✅ Tests: slice helpers (Tasks 1–2), hook (Tasks 3–4), manual SMOKE (Task 8).

**Placeholder scan:** No TBD/TODO/"similar to". All code blocks are concrete.

**Type consistency:**

- `sliceForRegenerate(messages)` / `sliceForEdit(messages, humanId, newText)` — signatures match between Task 2 implementation, Task 1 tests, and Tasks 6 / 7 call sites.
- `useStatelessStream` returns `{messages, isLoading, error, submit, stop, setMessages}` — same shape used by `Stream.tsx` (Task 5) and `LogosShell.tsx` (Tasks 6, 7 use only `stream.messages`, `stream.isLoading`, `stream.submit`).
- `Client.runs.stream(thread, assistantId, opts)` — first arg is `null` everywhere we call it.

No gaps.
