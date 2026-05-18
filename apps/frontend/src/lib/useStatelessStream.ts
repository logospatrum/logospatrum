// apps/frontend/src/lib/useStatelessStream.ts
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Client, type Message } from "@langchain/langgraph-sdk";

import { getPatSession } from "@/lib/session";

export interface UseStatelessStreamOptions {
  apiUrl: string;
  assistantId: string;
}

export interface SubmitConfig {
  /** Forwarded to LangGraph as `config.configurable` — proxy preserves keys
   *  added here (it only injects `subject_key`, doesn't strip others). */
  configurable?: Record<string, unknown>;
}

export interface UseStatelessStreamApi {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  submit: (
    input: { messages: Message[] },
    options?: { config?: SubmitConfig },
  ) => void;
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

    // LangGraph SDK builds request URLs via `new URL(path, apiUrl)`, which
    // throws "Invalid URL" when apiUrl is relative (e.g. our default "/api").
    // Promote to absolute against window.location.origin so the SDK is happy
    // while the browser still resolves the actual fetch same-origin.
    const absoluteApiUrl =
      typeof window !== "undefined" && apiUrl.startsWith("/")
        ? `${window.location.origin}${apiUrl}`
        : apiUrl;

    return new Client({
      apiUrl: absoluteApiUrl,
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
    (
      input: { messages: Message[] },
      options?: { config?: SubmitConfig },
    ) => {
      // Cancel any in-flight run before starting a new one.
      abortRef.current?.abort();

      const ac = new AbortController();
      abortRef.current = ac;

      // Optimistic: show the input immediately so the UI doesn't lag the
      // first SSE chunk.
      setMessagesState(input.messages);
      setError(null);
      setIsLoading(true);

      // Per-stream partials buffer: AIMessageChunk.id -> accumulated message.
      // Cleared on every authoritative `values` snapshot (and on submit).
      const partials = new Map<string, Message>();
      let lastFlush = 0;
      const FLUSH_MS = 50; // throttle: ~20 FPS is plenty for token rendering

      const mergePartialsInto = (
        base: Message[],
      ): Message[] => {
        if (partials.size === 0) return base;
        const byId = new Map<string, Message>();
        for (const m of base) {
          const id = (m as { id?: string }).id;
          if (id) byId.set(id, m);
        }
        for (const [id, p] of partials) byId.set(id, p);
        // Preserve original order; append any partial not in base at the end.
        const out: Message[] = [];
        const seen = new Set<string>();
        for (const m of base) {
          const id = (m as { id?: string }).id;
          if (id && byId.has(id)) {
            out.push(byId.get(id)!);
            seen.add(id);
          } else {
            out.push(m);
          }
        }
        for (const [id, p] of partials) {
          if (!seen.has(id)) out.push(p);
        }
        return out;
      };

      let lastSnapshot: Message[] = input.messages;

      void (async () => {
        try {
          const iter = client.runs.stream(null, assistantId, {
            input: { messages: input.messages },
            // values: per-node state snapshots (authoritative, clears partials)
            // messages-tuple: per-LLM-token chunks for live text streaming.
            //   Requires ChatOpenAI(streaming=True) on the backend; without
            //   it the server returns the full completion as one chunk.
            streamMode: ["values", "messages-tuple"],
            streamSubgraphs: true,
            signal: ac.signal,
            // Forwarded to the graph as RunnableConfig — the Next.js proxy
            // adds `subject_key` to configurable and passes other keys
            // (style_id, etc.) through to the backend untouched.
            config: options?.config,
          } as any);

          // Event taxonomy with subgraphs=True + the two stream modes above:
          //   "values"                                   root wrapper graph,
          //                                              fires only at start
          //                                              + final tick.
          //   "values|agent_inner:<uuid>"                deepagents main loop
          //                                              state, after every
          //                                              node (tool call / LLM
          //                                              response complete).
          //   "values|agent_inner:<uuid>/tools:<uuid>"   nested subagent
          //                                              (search) state —
          //                                              private thread, NOT
          //                                              spliced into the chat.
          //   "messages-tuple|agent_inner:<uuid>"        token-level
          //                                              AIMessageChunk +
          //                                              metadata pair from
          //                                              the main loop's LLM.
          //   "messages-tuple|...tools:..."              subagent token stream,
          //                                              also ignored.
          const MAIN_VALUES_RE = /^values(\|agent_inner:[^/]+)?$/;
          const MAIN_MSG_RE = /^messages-tuple(\|agent_inner:[^/]+)?$/;

          const flush = () => {
            setMessagesState(mergePartialsInto(lastSnapshot));
            lastFlush = performance.now();
          };

          for await (const chunk of iter as AsyncIterable<{
            event: string;
            data: unknown;
          }>) {
            if (ac.signal.aborted) break;

            if (MAIN_VALUES_RE.test(chunk.event)) {
              // Authoritative snapshot from the graph. Trumps partials.
              const data = chunk.data as { messages?: Message[] };
              if (Array.isArray(data.messages)) {
                lastSnapshot = data.messages;
                partials.clear();
                setMessagesState(data.messages);
                lastFlush = performance.now();
              }
            } else if (MAIN_MSG_RE.test(chunk.event)) {
              // [AIMessageChunk, metadata] — accumulate per chunk id.
              const tup = chunk.data as unknown[];
              if (Array.isArray(tup) && tup.length >= 1) {
                const part = tup[0] as {
                  id?: string;
                  content?: string;
                  tool_calls?: unknown[];
                  additional_kwargs?: Record<string, unknown>;
                  response_metadata?: Record<string, unknown>;
                };
                if (part?.id) {
                  const prev = partials.get(part.id) as
                    | (Message & { content?: string })
                    | undefined;
                  const prevContent =
                    typeof prev?.content === "string" ? prev.content : "";
                  const addContent =
                    typeof part.content === "string" ? part.content : "";
                  const merged = {
                    ...(prev ?? {}),
                    type: "ai",
                    id: part.id,
                    content: prevContent + addContent,
                    tool_calls: part.tool_calls ?? (prev as { tool_calls?: unknown[] })?.tool_calls ?? [],
                    additional_kwargs:
                      part.additional_kwargs ?? (prev as { additional_kwargs?: Record<string, unknown> })?.additional_kwargs ?? {},
                    response_metadata:
                      part.response_metadata ?? (prev as { response_metadata?: Record<string, unknown> })?.response_metadata ?? {},
                  } as unknown as Message;
                  partials.set(part.id, merged);

                  const now = performance.now();
                  if (now - lastFlush >= FLUSH_MS) flush();
                }
              }
            } else if (chunk.event === "error") {
              const data = chunk.data as { message?: string };
              setError(new Error(data.message ?? "stream error"));
              break;
            }
            // Everything else (subagent paths, metadata, end) is dropped.
          }
          // Final flush in case the last burst sat under the throttle window.
          if (partials.size > 0) flush();
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
