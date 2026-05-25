"use client";

import "./logos.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
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

import { tweaks } from "./tokens";
import { LangContext, useLangState, useStrings } from "./i18n";
import { useMonolithClearance } from "@/hooks/useMonolithClearance";
// Background stays eager: it IS the visual brand of the landing page
// (rock plate, cursor lighting, flames). Lazy-loading it left users
// staring at a flat dark rectangle until the dynamic chunk arrived,
// which on slow connections felt broken. Library/Connect remain lazy
// — they're dialogs the user opens later, invisible on first paint.
import { Background, type LightSource } from "./Background";

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
//
// `initialLightOn` comes from the server (page.tsx reads the `pat_light`
// cookie) so the very first render — both SSR and the first client
// commit — already matches the user's saved preference. Without this
// prop the old useState(true) → useEffect → setLightOnState dance flashed
// the lights on for ~1 frame even when the user had them turned off.
export function LogosShell({ initialLightOn = true }: { initialLightOn?: boolean }) {
  const langState = useLangState();
  return (
    <LangContext.Provider value={langState}>
      <LogosInner initialLightOn={initialLightOn} />
    </LangContext.Provider>
  );
}

function LogosInner({ initialLightOn }: { initialLightOn: boolean }) {
  const { s, lang, setLang } = useStrings();
  const stream = useStreamContext();
  const { threads } = useThreads();
  const { removeThread } = useThreadStore();

  // Keep `--monolith-clearance` on <html> equal to the live Monolith
  // card height + safety gaps. The home column's mobile padding-bottom
  // reads it (logos.css), so chip overlap with the fixed input is
  // impossible regardless of textarea growth or mobile URL-bar changes.
  useMonolithClearance();

  // URL-driven threadId — read from the same StreamProvider hook so both
  // the stream's history-loader and this shell stay in sync without a
  // second `useSearchParams` consumer (which would re-introduce the
  // Suspense bail-out we just removed).
  const { threadId, setThreadId } = stream;
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
  // The Monolith is rendered as a *single* React element that lives in
  // exactly one place in the JSX tree (as a flex child of the home
  // column). On home it's a normal in-flow flex child, so its vertical
  // position is whatever the flex layout naturally produces — which is
  // also what SSR emits. No JS measurement, no post-hydration jump.
  //
  // For chat mode we promote the wrapper to `position: fixed` pinned to
  // the bottom. To avoid a jarring snap between the two layout modes we
  // use the FLIP technique: capture the wrapper's rect just before the
  // mode flips, then after the mode change measure the new rect, set an
  // inverse transform to mask the jump, and on the next frame remove the
  // transform with a transition. The user sees a single smooth slide,
  // identical to the prior 480ms `top` animation but without the JS
  // measurement that caused the first-paint jump.
  const monoWrapperRef = useRef<HTMLDivElement | null>(null);
  const prevInChatRef = useRef<boolean>(inChat);
  const prevRectRef = useRef<DOMRect | null>(null);
  // Initialised from the server-known cookie value, so SSR HTML already
  // reflects the user's last toggle. No useEffect-driven flip after
  // hydration → no light-flash for users who had it turned off.
  const [lightOn, setLightOnState] = useState(initialLightOn);
  const toggleLight = useCallback(() => {
    setLightOnState((v) => {
      const next = !v;
      try {
        // Cookie so the server knows the value on the next page load
        // (eliminates the post-hydration flicker). max-age = 1 year.
        document.cookie = `pat_light=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
        // localStorage kept as a backup readable on the client even if
        // the cookie is stripped by privacy modes.
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

  // FLIP capture: BEFORE React applies the layout change that flips
  // home<->chat, snapshot the Monolith wrapper's current bounding rect.
  // This effect runs as a render-phase side effect via useState updater,
  // but we use a normal render-time read of refs.current — safe because
  // the wrapper exists on every render (the Monolith never unmounts).
  //
  // We compare the *previous* inChat we observed against the current one;
  // when they differ a mode flip has occurred. We capture the OLD rect
  // here (before the DOM mutates) so the post-mutation useLayoutEffect
  // can compute the delta. We deliberately read in the render body — refs
  // are populated from the prior commit, so `getBoundingClientRect()` here
  // returns the pre-flip geometry.
  if (typeof window !== "undefined" && prevInChatRef.current !== inChat) {
    prevRectRef.current = monoWrapperRef.current?.getBoundingClientRect() ?? null;
  }

  // FLIP play: AFTER the DOM has the new layout (chat -> fixed-bottom, or
  // home -> inline flex child), measure the new rect, set an inverse
  // transform, then on the next frame animate the transform to identity
  // with a 480ms ease. The user perceives a single smooth slide between
  // the two positions; intermediate frames are pure GPU-composited
  // transforms so it stays cheap.
  //
  // useLayoutEffect is required so the inverse transform is applied
  // before the browser paints — otherwise the user would see one frame
  // at the new position before the animation starts.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const prevInChat = prevInChatRef.current;
    prevInChatRef.current = inChat;
    if (prevInChat === inChat) return undefined;
    const el = monoWrapperRef.current;
    const oldRect = prevRectRef.current;
    prevRectRef.current = null;
    if (!el || !oldRect) return undefined;
    const newRect = el.getBoundingClientRect();
    const dy = oldRect.top - newRect.top;
    const dx = oldRect.left - newRect.left;
    if (Math.abs(dy) < 1 && Math.abs(dx) < 1) return undefined;
    // First frame: paint at the old position via an inverse transform,
    // no transition so the snap-back is invisible.
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    // Force a reflow so the browser commits the inverse before the
    // transition kicks in. Reading offsetWidth is the canonical trick.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetWidth;
    // Next frame: clear the transform with a transition. The browser
    // interpolates from the inverse back to identity, which visually
    // slides the wrapper from the old position to its new layout.
    requestAnimationFrame(() => {
      const node = monoWrapperRef.current;
      if (!node) return;
      node.style.transition = "transform 480ms cubic-bezier(.22,.61,.36,1)";
      node.style.transform = "translate(0, 0)";
    });
    return undefined;
  }, [inChat]);

  // (Narrow-viewport bottom-pin is now expressed as a CSS media query
  // on `.logos-monolith[data-mode="home"]` — deterministic from first
  // paint, no JS measurement, no SSR/CSR width mismatch.)

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
          switching to a chat. Hidden on `@media (max-width: 640px)`
          via `.logos-bottom-chrome-wrap` in logos.css (the bottom-
          pinned Monolith already occupies the same band on mobile).
          inChat is driven by data-attribute so the CSS owns the
          full visibility logic and there's no isNarrow-induced
          opacity flip after hydration. */}
      <div
        className="logos-bottom-chrome-wrap"
        data-in-chat={inChat ? "true" : "false"}
      >
        <BottomChrome />
      </div>

      {/* Unified <main>: both home and chat layers are mounted at all
          times. Visibility is opacity-driven so switching modes doesn't
          unmount/remount Logo/Quote/Starters or the chat scroller —
          which was the cause of the "everything flickers except input"
          report.

          The Monolith lives INSIDE the home flex column as a real flex
          child (replacing the previous absolute-positioned overlay +
          getBoundingClientRect measurement). On `inChat` we promote the
          Monolith wrapper to `position: fixed` via the CSS
          `data-mode="chat"` attribute — same DOM node, just floated out
          of the column. The FLIP useLayoutEffect above animates the
          transition. SSR HTML now contains the input AT its final
          flex-centered position, so there is no first-paint jump on
          hydration. */}
      <main
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 5,
        }}
      >
        {/* Home layer — designer's original flex-centered column. The
            decorations (Logo / Quote / Starters) each get their own
            opacity wrapper so they fade out individually on inChat,
            leaving the column itself at opacity:1 so the Monolith
            (a real flex child here) stays fully visible during and
            after the mode transition.

            The column's `pointer-events` toggles on inChat so chat-
            mode clicks fall through to the chat scroller behind. The
            Monolith escapes that toggle because `.logos-monolith` has
            its own `pointer-events: auto` on the inner card. */}
        <div
          className="logos-home-column"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 64,
            // Native scroll on both home and chat. Earlier we set
            // `touch-action: none` + `overflow-y: hidden` here to keep
            // pointermove streaming so the cursor light could follow a
            // finger drag on mobile — but the mobile background is now
            // a static cached bitmap (no rAF, no pointer tracking — see
            // Background.tsx::useStaticBackground), so there's nothing
            // left to protect and the browser's native scroll path is
            // both cheaper and more idiomatic.
            overflowY: "auto",
            overflowX: "hidden",
            scrollbarGutter: "stable",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.10) transparent",
            pointerEvents: inChat ? "none" : "auto",
          }}
        >
          <div
            aria-hidden={inChat}
            style={{
              opacity: inChat ? 0 : 1,
              transition: "opacity 360ms ease",
              pointerEvents: inChat ? "none" : "auto",
            }}
          >
            <Logo />
          </div>
          <div
            aria-hidden={inChat}
            style={{
              opacity: inChat ? 0 : 1,
              transition: "opacity 360ms ease",
              pointerEvents: inChat ? "none" : "auto",
            }}
          >
            <Quote show={tweaks.showQuote} />
          </div>
          {/* Monolith — the actual chat input. In-flow flex child on
              desktop home (SSR-paintable at its final position, no JS
              measurement); promoted to `position: fixed` at the bottom
              when inChat (or on narrow viewports, via CSS media query).
              See `.logos-monolith` rules in logos.css. */}
          <div
            ref={monoWrapperRef}
            className="logos-monolith"
            data-mode={inChat ? "chat" : "home"}
          >
            <div
              style={{
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
          <div
            aria-hidden={inChat}
            style={{
              opacity: inChat ? 0 : 1,
              transition: "opacity 360ms ease",
              pointerEvents: inChat ? "none" : "auto",
            }}
          >
            <Starters onPick={submit} />
          </div>
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
