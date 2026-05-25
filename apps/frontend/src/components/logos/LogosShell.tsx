"use client";

import "./logos.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { useQueryState } from "nuqs";
import type { Message } from "@langchain/langgraph-sdk";

import { useStreamContext } from "@/providers/Stream";
import { useThreads, useThreadStore } from "@/providers/Thread";
import { ensureToolCallsHaveResponses } from "@/lib/ensure-tool-responses";
import { sliceForRegenerate, sliceForEdit } from "@/lib/chat-history-slice";
import { loadThreads, newThreadId } from "@/lib/local-thread-store";
import { reachGoal } from "@/lib/metrika";
import {
  downloadMarkdown,
  exportFilename,
  messagesToMarkdown,
} from "@/lib/export-markdown";

import { palette, tweaks } from "./tokens";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { LangContext, useLangState, useStrings } from "./i18n";
import type { LightSource } from "./Background";

// Heavy / interactive-only modules are deferred so they don't bloat the
// initial bundle. Background has heavy SVG filter init + two rAF loops;
// LibraryBrowser/ConnectAgent are dialogs the user opens later.
// `ssr: false` is safe here because none of them participate in SSR
// content — the page is fully client-driven via streaming + localStorage.
const Background = dynamic(
  () => import("./Background").then((m) => ({ default: m.Background })),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: palette.bg,
          zIndex: 0,
        }}
      />
    ),
  },
);
const LibraryBrowser = dynamic(
  () =>
    import("@/components/library/LibraryBrowser").then((m) => ({
      default: m.LibraryBrowser,
    })),
  { ssr: false },
);
const ConnectAgent = dynamic(
  () =>
    import("@/components/connect/ConnectAgent").then((m) => ({
      default: m.ConnectAgent,
    })),
  { ssr: false },
);
import { TopChrome } from "./TopChrome";
import { BottomChrome } from "./BottomChrome";
import { Sidebar, type SidebarThread } from "./Sidebar";
import { ChatBackdrop } from "./ChatBackdrop";
import { BudgetBanner } from "./BudgetBanner";
import { Logo } from "./Logo";
import { Quote } from "./Quote";
import { Monolith } from "./Monolith";
import { useStyle, type StyleId } from "./styles";
import { ScrollToBottom } from "./ScrollToBottom";
import { PerfPanel } from "./PerfPanel";
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
  const { removeThread } = useThreadStore();
  const isNarrow = useMediaQuery("(max-width: 640px)");

  // URL-driven threadId (matches upstream agent-chat-ui behavior so the
  // back/forward buttons keep working).
  const [threadId, setThreadId] = useQueryState("threadId");
  const inChat = !!threadId || stream.messages.length > 0;

  const [inputFocused, setInputFocused] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  // Anti-abuse RUB-budget UX state. Populated by useStatelessStream when API
  // responses carry the X-Budget-Warning header (>=80% of daily limit) or
  // when the proxy returns 503 (global month kill-switch).
  // See: docs/superpowers/specs/2026-05-16-anti-abuse-rate-limits-design.md
  const [budgetWarning, setBudgetWarning] = useState<
    { used: number; limit: number } | null
  >(null);
  const [globalPaused, setGlobalPaused] = useState<boolean>(false);
  useEffect(() => {
    function onWarn(e: Event) {
      const d = (e as CustomEvent<{ used: number; limit: number }>).detail;
      if (d) setBudgetWarning(d);
    }
    function onPause() {
      setGlobalPaused(true);
    }
    window.addEventListener("patristic:budget-warning", onWarn);
    window.addEventListener("patristic:global-paused", onPause);
    return () => {
      window.removeEventListener("patristic:budget-warning", onWarn);
      window.removeEventListener("patristic:global-paused", onPause);
    };
  }, []);
  // Monolith is rendered once as a fixed-positioned overlay. On home it
  // visually sits where a placeholder div would land inside the flex-
  // centered home layout — we measure that placeholder's top to keep the
  // overlay pixel-aligned with the designer's original layout (Logo /
  // Quote / Monolith / Starters, all flex-column centered).
  //
  // `monolithTop` starts as `null` (no measurement yet); the render uses a
  // CSS fallback (`top: 50vh` on desktop home, bottom-pinned on chat/narrow
  // via the explicit chat/narrow branch in the layout effect) so the input
  // is VISIBLE from the very first paint, including SSR HTML before
  // hydration. Once the layout effect measures the slot, the 480ms `top`
  // transition smoothly nudges the input into pixel-perfect alignment.
  const monoSlotRef = useRef<HTMLDivElement | null>(null);
  const [monolithTop, setMonolithTop] = useState<number | null>(null);
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

  // Global response-style selection — written to localStorage by useStyle on
  // every change. Forwarded as config.configurable.style_id on every submit
  // (new message, regenerate, edit-and-resubmit) so the backend's
  // StyleMiddleware can append the right SystemMessage suffix.
  const { styleId, setStyleId } = useStyle();
  const styleIdRef = useRef<StyleId>(styleId);
  useEffect(() => {
    styleIdRef.current = styleId;
  }, [styleId]);
  const buildSubmitConfig = useCallback(
    () => ({ config: { configurable: { style_id: styleIdRef.current } } }),
    [],
  );

  // Effective chat count drives the "cave lights up over time" progression.
  const chatCount = threads.length;

  // Pixel-align the fixed Monolith with its in-flow slot on home, or with
  // a 28px gap from the viewport bottom on chat. Runs synchronously
  // before paint so the initial frame has the right `top` and we don't
  // see the input snap into place.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const MONOLITH_H = 115;
    const compute = () => {
      // On narrow viewports the home column overflows and the user has to
      // scroll past Starters to read everything. A fixed-mid-viewport input
      // would slide over the chips. Bottom-pin it like the chat-mode input.
      if (inChat || isNarrow) {
        setMonolithTop(window.innerHeight - MONOLITH_H - 28);
        return;
      }
      const r = monoSlotRef.current?.getBoundingClientRect();
      if (r) setMonolithTop(r.top);
      else setMonolithTop(window.innerHeight / 2 - MONOLITH_H / 2);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [inChat, isNarrow]);

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
      stream.submit(
        {
          messages: [...stream.messages, ...toolStubs, newHumanMessage],
        },
        buildSubmitConfig(),
      );
      reachGoal("question_asked");
      setPrefill(undefined);
    },
    [stream, threadId, setThreadId, buildSubmitConfig],
  );

  // Regenerate the last assistant turn by re-submitting the conversation
  // sliced to (and including) the last human message. No server-side
  // checkpoint involved — the frontend owns history.
  const handleRegenerate = useCallback(() => {
    const sliced = sliceForRegenerate(stream.messages);
    if (sliced.length === 0) return;
    stream.submit({ messages: sliced }, buildSubmitConfig());
  }, [stream, buildSubmitConfig]);

  // Edit a previous human message: replace its content and drop every
  // message after it, then re-submit the sliced history.
  const handleEditHuman = useCallback(
    (humanId: string | undefined, newText: string) => {
      if (!humanId) return;
      const sliced = sliceForEdit(stream.messages, humanId, newText);
      if (sliced === stream.messages) return; // id not found
      stream.submit({ messages: sliced }, buildSubmitConfig());
    },
    [stream, buildSubmitConfig],
  );

  const goHome = useCallback(() => {
    setThreadId(null);
  }, [setThreadId]);

  // Export the *active* chat (in-chat pill).
  const handleExportActive = useCallback(() => {
    if (stream.messages.length === 0) return;
    const meta = (threads.find((t) => t.thread_id === threadId)?.metadata ?? {}) as {
      title?: string;
    };
    const title = meta.title;
    const md = messagesToMarkdown(stream.messages, { lang, title });
    downloadMarkdown(exportFilename(title ?? "chat"), md);
  }, [stream.messages, threads, threadId, lang]);

  // Export *any* thread from the sidebar by id, without switching the active
  // thread. Reads directly from localStorage so non-active threads work too.
  const handleExportThread = useCallback(
    (id: string) => {
      const stored = loadThreads().find((t) => t.id === id);
      if (!stored) return;
      const md = messagesToMarkdown(stored.messages, { lang, title: stored.title });
      downloadMarkdown(exportFilename(stored.title), md);
    },
    [lang],
  );

  // Delete a thread from sidebar. If it's the active one, also clear the
  // URL threadId so Stream.tsx unmounts the messages and we land back on home.
  const handleDeleteThread = useCallback(
    (id: string) => {
      removeThread(id);
      if (id === threadId) setThreadId(null);
    },
    [removeThread, threadId, setThreadId],
  );

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
  const connectSlot = <ConnectAgent />;

  return (
    <>
      <PerfPanel />
      <Background
        lightSource={lightSource}
        lightOn={lightOn}
        chatCount={chatCount}
        dimCursor={inputFocused && !inChat}
      />

      {/* ChatBackdrop — always mounted; visibility fades with inChat so
          the column doesn't pop in or out abruptly. */}
      <div
        style={{
          opacity: inChat ? 1 : 0,
          transition: "opacity 360ms ease",
          pointerEvents: "none",
        }}
      >
        <ChatBackdrop />
      </div>

      <Sidebar
        threads={sidebarThreads}
        activeId={threadId}
        onPick={(id) => setThreadId(id)}
        onNew={goHome}
        onExport={handleExportThread}
        onDelete={handleDeleteThread}
      />

      <TopChrome
        inChat={inChat}
        onHome={goHome}
        lightOn={lightOn}
        onToggleLight={toggleLight}
        lang={lang}
        onLangChange={setLang}
        librarySlot={librarySlot}
        connectSlot={connectSlot}
      />

      {budgetWarning && !globalPaused && (
        <BudgetBanner
          used={budgetWarning.used}
          limit={budgetWarning.limit}
          onClose={() => setBudgetWarning(null)}
        />
      )}

      {globalPaused && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            padding: "12px 24px",
            background: "rgba(120,30,30,0.18)",
            borderBottom: "1px solid rgba(180,60,60,0.6)",
            color: "#e8a8a8",
            fontSize: 14,
            textAlign: "center",
            fontFamily: "Inter, sans-serif",
          }}
        >
          {s.budget.globalPaused}
        </div>
      )}

      {/* BottomChrome — always mounted; visibility fades with home mode
          so the corpus/clock strip doesn't flash on mount/unmount when
          switching to a chat. Hidden on narrow viewports where the
          bottom-pinned Monolith already occupies the same band. */}
      <div
        style={{
          opacity: !inChat && !isNarrow ? 1 : 0,
          transition: "opacity 360ms ease",
          pointerEvents: "none",
        }}
      >
        <BottomChrome />
      </div>

      {/* Unified <main>: both home and chat layers are mounted at all
          times. Visibility is opacity-driven so switching modes doesn't
          unmount/remount Logo/Quote/Starters or the chat scroller —
          which was the cause of the "everything flickers except input"
          report. */}
      <main
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 5,
        }}
      >
        {/* Home layer — designer's original flex-centered column.
            Monolith itself is rendered separately as a fixed overlay,
            but a same-sized placeholder lives here so the rest of the
            layout (Logo / Quote / Starters) keeps its designed spacing.
            We measure the placeholder's getBoundingClientRect to align
            the fixed overlay onto it. */}
        <div
          aria-hidden={inChat}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: isNarrow ? "120px 24px 175px" : "120px 24px 100px",
            gap: 64,
            overflowY: "auto",
            overflowX: "hidden",
            scrollbarGutter: "stable",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.10) transparent",
            opacity: inChat ? 0 : 1,
            pointerEvents: inChat ? "none" : "auto",
            transition: "opacity 360ms ease",
          }}
        >
          <Logo />
          <Quote show={tweaks.showQuote} />
          <div
            ref={monoSlotRef}
            aria-hidden
            style={{ height: 115, width: "min(720px, 92vw)" }}
          />
          <Starters onPick={submit} />
        </div>

        {/* Chat layer */}
        <div
          ref={scrollerRef}
          aria-hidden={!inChat}
          style={{
            position: "absolute",
            inset: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "100px 24px 175px",
            scrollbarGutter: "stable",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.10) transparent",
            opacity: inChat ? 1 : 0,
            pointerEvents: inChat ? "auto" : "none",
            transition: "opacity 360ms ease",
            transform: "translateZ(0)",
            willChange: "transform",
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
            {turns.map((turn, i) => (
              <ChatTurn
                key={turn.key}
                turn={turn}
                isLastTurn={i === turns.length - 1}
                onRegenerate={handleRegenerate}
                onExport={handleExportActive}
                onEditHuman={(newText) => handleEditHuman(turn.human?.id, newText)}
              />
            ))}
          </div>
        </div>
      </main>

      {/* Unified Monolith — single React instance, fixed-positioned.
          Smoothly transitions between mid-viewport (home) and just-above-
          bottom (chat) via CSS `top` transition. Previously there were two
          separate Monoliths inside the !inChat / inChat branches; switching
          mode unmounted one and mounted the other, which the user saw as a
          ~400px jump (and rerendered focus state). One instance with one
          transition is the whole fix. */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          zIndex: 6,
          pointerEvents: "none",
          display: "flex",
          justifyContent: "center",
          // Pre-measurement fallback: bottom-pinned for chat/narrow (matches
          // the layout-effect's narrow/inChat branch), centered for desktop
          // home (matches the slot's natural flex-center position closely
          // enough that any post-measurement correction animates via the
          // 480ms transition rather than a visible snap).
          ...(monolithTop != null
            ? { top: `${monolithTop}px` }
            : inChat || isNarrow
              ? { top: "auto", bottom: 28 }
              : { top: "50vh", transform: "translateY(-50%)" }),
          opacity: 1,
          transition: "top 480ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            position: "relative",
            width: "min(720px, 92vw)",
          }}
        >
          {inChat && (
            <ScrollToBottom visible={!atBottom} onClick={scrollToBottom} />
          )}
          <Monolith
            onSubmit={submit}
            busy={stream.isLoading}
            onStop={() => stream.stop()}
            onFocusChange={setInputFocused}
            prefill={prefill}
            styleId={styleId}
            onStyleChange={setStyleId}
          />
        </div>
      </div>
    </>
  );
}

function ChatTurn({
  turn,
  isLastTurn,
  onRegenerate,
  onExport,
  onEditHuman,
}: {
  turn: ReturnType<typeof groupMessagesIntoTurns>[number];
  isLastTurn: boolean;
  onRegenerate: () => void;
  onExport: () => void;
  onEditHuman: (newText: string) => void;
}) {
  const humanText = turn.human ? humanMessageText(turn.human) : "";
  const showAssistant =
    turn.toolCalls.length > 0 ||
    turn.answerText.trim().length > 0 ||
    turn.inProgress;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {humanText && <HumanLine text={humanText} onEdit={onEditHuman} />}
      {showAssistant && (
        <AssistantTurn
          turn={turn}
          showRegenerate={isLastTurn && !turn.inProgress}
          onRegenerate={onRegenerate}
          onExport={onExport}
        />
      )}
    </div>
  );
}
