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
