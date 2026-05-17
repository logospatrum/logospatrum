// apps/frontend/src/lib/useStatelessStream.ts
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Client, type Message } from "@langchain/langgraph-sdk";

import { getPatSession } from "@/lib/session";

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
  const client = useMemo(() => {
    // Custom fetch: per-request HMAC injection + response inspection for
    // 401 silent refresh, 429 toast, 503 service-paused event, and the
    // X-Budget-Warning soft-warning header. See task 5.2.
    async function wrappedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const headers = new Headers(init?.headers);
      const token = getPatSession();
      if (token) headers.set("X-Pat-Session", token);

      let res = await fetch(input, { ...init, headers });

      // 401 → silent refresh + single retry. The token may have expired
      // at midnight UTC; /api/session mints a fresh one against the
      // pat_uid cookie (handled server-side).
      if (res.status === 401) {
        try {
          const refreshRes = await fetch("/api/session");
          if (refreshRes.ok) {
            const { token: newToken } = (await refreshRes.json()) as {
              token?: string;
            };
            if (newToken) {
              // Keep the meta tag in sync so getPatSession() returns the
              // fresh value on subsequent calls in this tab.
              document
                .querySelector('meta[name="pat-session"]')
                ?.setAttribute("content", newToken);
              const retryHeaders = new Headers(init?.headers);
              retryHeaders.set("X-Pat-Session", newToken);
              res = await fetch(input, { ...init, headers: retryHeaders });
            }
          }
        } catch {
          /* fall through with the original 401 */
        }
      }

      // 429: daily per-subject budget exceeded → Russian Sonner toast.
      if (res.status === 429) {
        try {
          const j = (await res.clone().json()) as {
            error?: string;
            reset_at?: string;
          };
          if (j.error === "daily_budget_exceeded") {
            const resetAt = j.reset_at ?? "";
            const when = resetAt
              ? new Date(resetAt).toLocaleString("ru-RU")
              : "завтра";
            // Lazy import keeps sonner out of any SSR path.
            const { toast } = await import("sonner");
            toast.error(
              `Дневной лимит исчерпан. Возвращайтесь после ${when}.`,
            );
          }
        } catch {
          /* swallow — the stream consumer surfaces the underlying error */
        }
      }

      // 503: global month kill-switch → DOM event for LogosShell to render
      // the "сервис временно приостановлен" block. No toast.
      if (res.status === 503) {
        try {
          const j = (await res.clone().json()) as { error?: string };
          if (j.error === "service_paused_global_budget") {
            window.dispatchEvent(
              new CustomEvent("patristic:global-paused", { detail: j }),
            );
          }
        } catch {
          /* swallow */
        }
      }

      // Soft budget warning header. Response can be any status — typically
      // 200. LogosShell subscribes to this event in task 6.3.
      const warn = res.headers.get("x-budget-warning");
      if (warn) {
        const used = parseFloat(warn.match(/used=([\d.]+)/)?.[1] ?? "0");
        const limit = parseFloat(warn.match(/limit=([\d.]+)/)?.[1] ?? "0");
        window.dispatchEvent(
          new CustomEvent("patristic:budget-warning", {
            detail: { used, limit },
          }),
        );
      }

      return res;
    }

    return new Client({
      apiUrl,
      callerOptions: { fetch: wrappedFetch },
    });
  }, [apiUrl]);

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
