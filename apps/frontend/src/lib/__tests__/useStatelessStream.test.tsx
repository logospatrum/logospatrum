// apps/frontend/src/lib/__tests__/useStatelessStream.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Message } from "@langchain/langgraph-sdk";

// Hoisted mock — must be set up before the hook module is imported.
const streamMock = vi.fn();
vi.mock("@langchain/langgraph-sdk", () => ({
  Client: vi.fn().mockImplementation(function () {
    return { runs: { stream: streamMock } };
  }),
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
    expect(opts.streamMode).toEqual(["values", "messages-tuple"]);
    expect(opts.streamSubgraphs).toBe(true);
  });

  it("optimistically sets messages to input.messages before the first chunk", async () => {
    // Stream that never yields — verifies the optimistic state without races.
    streamMock.mockReturnValue({
      // eslint-disable-next-line require-yield
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
      // eslint-disable-next-line require-yield
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
