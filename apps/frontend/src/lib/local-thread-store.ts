// Browser localStorage thread storage. Replaces the upstream agent-chat-ui
// flow of fetching threads from the LangGraph server — Patristic chat is
// stateless on the backend, so we keep all conversation history client-side.

import type { Message, Thread } from "@langchain/langgraph-sdk";

export interface StoredThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const KEY = "patristic:threads";
const VERSION_KEY = "patristic:threads:v";
const SCHEMA_VERSION = 1;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadThreads(): StoredThread[] {
  if (!isBrowser()) return [];
  try {
    // Bump migration logic later if schema changes.
    if (localStorage.getItem(VERSION_KEY) !== String(SCHEMA_VERSION)) {
      localStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
    }
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredThread[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveThreads(threads: StoredThread[]): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(threads));
  } catch (e) {
    // localStorage quota — log & best-effort prune oldest threads.
    console.warn("Failed to save threads:", e);
    if (threads.length > 5) {
      const trimmed = threads.slice(0, Math.floor(threads.length / 2));
      try {
        localStorage.setItem(KEY, JSON.stringify(trimmed));
      } catch {
        /* give up */
      }
    }
  }
}

export function upsertThread(t: StoredThread): void {
  const all = loadThreads();
  const i = all.findIndex((x) => x.id === t.id);
  if (i >= 0) all[i] = t;
  else all.unshift(t);
  saveThreads(all);
}

export function deleteThread(id: string): void {
  const all = loadThreads().filter((x) => x.id !== id);
  saveThreads(all);
}

export function newThreadId(): string {
  if (isBrowser() && typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for SSR / older runtimes (very unlikely path).
  return "thr-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getContentText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "string") return block;
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
    }
  }
  return "";
}

export function deriveTitle(messages: Message[]): string {
  const firstHuman = messages.find((m) => m.type === "human");
  if (!firstHuman) return "Новый разговор";
  const txt = getContentText(firstHuman.content).trim();
  if (!txt) return "Новый разговор";
  return txt.slice(0, 60);
}

/** Convert a StoredThread to the SDK's Thread shape that the upstream history list expects. */
export function toSdkThread(t: StoredThread): Thread {
  return {
    thread_id: t.id,
    created_at: new Date(t.createdAt).toISOString(),
    updated_at: new Date(t.updatedAt).toISOString(),
    metadata: { title: t.title },
    status: "idle",
    config: {},
    values: { messages: t.messages },
    // Upstream Thread type is broader; cast is safe for our display needs.
  } as unknown as Thread;
}
