"use client";

import "./logos.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { useQueryState } from "nuqs";
import type { Message } from "@langchain/langgraph-sdk";

import { useStreamContext } from "@/providers/Stream";
import { useThreads } from "@/providers/Thread";
import { ensureToolCallsHaveResponses } from "@/lib/ensure-tool-responses";
import { sliceForRegenerate, sliceForEdit } from "@/lib/chat-history-slice";
import { newThreadId } from "@/lib/local-thread-store";
import { LibraryBrowser } from "@/components/library/LibraryBrowser";

import { palette, tweaks, type } from "./tokens";
import { LangContext, useLangState, useStrings } from "./i18n";
import { Background, type LightSource } from "./Background";
import { TopChrome } from "./TopChrome";
import { BottomChrome } from "./BottomChrome";
import { Sidebar, type SidebarThread } from "./Sidebar";
import { ChatBackdrop } from "./ChatBackdrop";
import { Logo } from "./Logo";
import { Quote } from "./Quote";
import { Monolith } from "./Monolith";
import { ScrollToBottom } from "./ScrollToBottom";
import { Starters } from "./Starters";
import { HumanLine } from "./HumanLine";
import { AssistantTurn } from "./AssistantTurn";
import { groupMessagesIntoTurns } from "./turns";
import { humanMessageText } from "./markdown/content";

const LIGHT_STORAGE_KEY = "logos:lightOn";

// The whole shell is one big client component because it owns the
// stream/thread state machine for the chat. Keeping it monolithic mirrors
// the design's `app.js` `App()` and avoids prop-drilling palette/i18n.
export function LogosShell() {
  const langState = useLangState();
  return (
    <LangContext.Provider value={langState}>
      <LogosInner />
    </LangContext.Provider>
  );
}

function LogosInner() {
  const { s, lang, setLang } = useStrings();
  const stream = useStreamContext();
  const { threads } = useThreads();

  // URL-driven threadId (matches upstream agent-chat-ui behavior so the
  // back/forward buttons keep working).
  const [threadId, setThreadId] = useQueryState("threadId");
  const inChat = !!threadId || stream.messages.length > 0;

  const [inputFocused, setInputFocused] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const [lightOn, setLightOnState] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIGHT_STORAGE_KEY);
      if (raw === "0") setLightOnState(false);
      else if (raw === "1") setLightOnState(true);
    } catch {
      /* localStorage may throw in privacy mode */
    }
  }, []);
  const toggleLight = useCallback(() => {
    setLightOnState((v) => {
      const next = !v;
      try {
        localStorage.setItem(LIGHT_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* swallow */
      }
      return next;
    });
  }, []);

  // Effective chat count drives the "cave lights up over time" progression.
  const chatCount = threads.length;

  // Three-state light source machine. Mirrors the design's
  // `landing | thinking | reading`.
  const lightSource: LightSource = useMemo(() => {
    if (!inChat) return "cursor";
    return stream.isLoading ? "thinking" : "reading";
  }, [inChat, stream.isLoading]);

  // Surface stream errors as toasts (mirrors the upstream behavior).
  const lastError = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const msg = (stream.error as { message?: string }).message;
      if (!msg || lastError.current === msg) return;
      lastError.current = msg;
      toast.error(s.errors.generic, {
        description: msg,
        richColors: true,
        closeButton: true,
      });
    } catch {
      /* swallow */
    }
  }, [stream.error, s]);

  // Listen for "ask about this work" events fired by LibraryBrowser. We
  // prefill the monolith textarea rather than auto-submitting so the user
  // can edit before sending.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text: string }>;
      if (ce.detail?.text) setPrefill(ce.detail.text);
    };
    window.addEventListener("patristic:prefill-input", handler);
    return () => window.removeEventListener("patristic:prefill-input", handler);
  }, []);

  // Submit a user message — full history is sent because the backend is
  // stateless. Tool-call orphans (a previous run was stopped mid-turn) are
  // patched up with synthetic tool responses so the graph doesn't reject
  // the input.
  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || stream.isLoading) return;

      // Promote the home view to a real thread on first submit so localStorage
      // can persist this conversation. The URL is the carrier; Stream.tsx's
      // persist effect needs threadId !== null to fire.
      if (!threadId) setThreadId(newThreadId());

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
    [stream, threadId, setThreadId],
  );

  // Regenerate the last assistant turn by re-submitting the conversation
  // sliced to (and including) the last human message. No server-side
  // checkpoint involved — the frontend owns history.
  const handleRegenerate = useCallback(() => {
    const sliced = sliceForRegenerate(stream.messages);
    if (sliced.length === 0) return;
    stream.submit({ messages: sliced });
  }, [stream]);

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

  const goHome = useCallback(() => {
    setThreadId(null);
  }, [setThreadId]);

  // Auto-scroll the chat list when new content arrives — but only if the
  // user is already near the bottom. If they've scrolled up to re-read,
  // don't yank the viewport. The ScrollToBottom pill lets them re-engage.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtBottom(slack < 24);
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
    // Re-bind when the scroll container or the message count changes so the
    // initial `slack` reading picks up the new content height.
  }, [stream.messages.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !atBottom) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [stream.messages.length, stream.isLoading, atBottom]);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Sidebar entries from localStorage threads.
  const sidebarThreads: SidebarThread[] = useMemo(
    () =>
      threads.map((t) => {
        const meta = (t.metadata ?? {}) as { title?: string };
        return {
          id: t.thread_id,
          title: meta.title || s.sidebar.newChat,
        };
      }),
    [threads, s.sidebar.newChat],
  );

  // Group messages into design-shaped turns.
  const turns = useMemo(
    () => groupMessagesIntoTurns(stream.messages, stream.isLoading),
    [stream.messages, stream.isLoading],
  );

  // Library trigger styled to match the top chrome. We delegate the dialog
  // itself to the existing LibraryBrowser — only the trigger button is
  // rebuilt here, with the `asChild` slot wired to the design's pill.
  const librarySlot = (
    <LibraryBrowser
      onAskAboutWork={(author: string, work: string) => {
        window.dispatchEvent(
          new CustomEvent("patristic:prefill-input", {
            detail: { text: s.askAboutWork(author, work) },
          }),
        );
      }}
    />
  );

  return (
    <>
      <Background
        lightSource={lightSource}
        lightOn={lightOn}
        chatCount={chatCount}
        dimCursor={inputFocused && !inChat}
      />

      {inChat && <ChatBackdrop />}

      <Sidebar
        threads={sidebarThreads}
        activeId={threadId}
        onPick={(id) => setThreadId(id)}
        onNew={goHome}
      />

      <TopChrome
        inChat={inChat}
        onHome={goHome}
        lightOn={lightOn}
        onToggleLight={toggleLight}
        lang={lang}
        onLangChange={setLang}
        librarySlot={librarySlot}
      />
      {!inChat && <BottomChrome />}

      {!inChat ? (
        <main
          style={{
            position: "relative",
            zIndex: 5,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "120px 24px 100px",
            gap: 64,
            animation: "logos-rise 900ms cubic-bezier(.22,.61,.36,1) both",
          }}
        >
          <Logo />
          <Quote show={tweaks.showQuote} />
          <Monolith
            onSubmit={submit}
            busy={stream.isLoading}
            onStop={() => stream.stop()}
            onFocusChange={setInputFocused}
            prefill={prefill}
          />
          <Starters onPick={submit} />
        </main>
      ) : (
        <main
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            ref={scrollerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              padding: "100px 24px 32px",
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.10) transparent",
            }}
          >
            <div
              style={{
                width: "min(760px, 92vw)",
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: 36,
              }}
            >
              {turns.length === 0 && (
                <div
                  style={{
                    color: palette.faint,
                    fontFamily: type.ui,
                    fontSize: 13,
                    textAlign: "center",
                    padding: "40px 0",
                  }}
                >
                  {s.sidebar.empty}
                </div>
              )}
              {turns.map((turn, i) => (
                <ChatTurn
                  key={turn.key}
                  turn={turn}
                  isLastTurn={i === turns.length - 1}
                  onRegenerate={handleRegenerate}
                  onEditHuman={(newText) => handleEditHuman(turn.human?.id, newText)}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              position: "relative",
              padding: "12px 24px 28px",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <ScrollToBottom visible={!atBottom} onClick={scrollToBottom} />
            <Monolith
              onSubmit={submit}
              busy={stream.isLoading}
              onStop={() => stream.stop()}
              prefill={prefill}
            />
          </div>
        </main>
      )}
    </>
  );
}

function ChatTurn({
  turn,
  isLastTurn,
  onRegenerate,
  onEditHuman,
}: {
  turn: ReturnType<typeof groupMessagesIntoTurns>[number];
  isLastTurn: boolean;
  onRegenerate: () => void;
  onEditHuman: (newText: string) => void;
}) {
  const humanText = turn.human ? humanMessageText(turn.human) : "";
  const showAssistant =
    turn.toolCalls.length > 0 ||
    turn.answerText.trim().length > 0 ||
    turn.inProgress;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {humanText && <HumanLine text={humanText} onEdit={onEditHuman} />}
      {showAssistant && (
        <AssistantTurn
          turn={turn}
          showRegenerate={isLastTurn && !turn.inProgress}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}
