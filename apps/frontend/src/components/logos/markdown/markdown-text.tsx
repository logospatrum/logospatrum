"use client";

import "./markdown-styles.css";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { remarkCitation } from "@/lib/remark-citation";
import { CitationPill } from "@/components/logos/CitationPill";
import {
  FC,
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { SyntaxHighlighter } from "./syntax-highlighter";

import "katex/dist/katex.min.css";

/** Minimal className merger — avoids importing cn/@/lib/utils. */
function cx(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base;
}

interface CodeHeaderProps {
  language?: string;
  code: string;
}

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => { if (!code || isCopied) return; copyToClipboard(code); };
  return (
    <div className="flex items-center justify-between gap-4 rounded-t-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
      <span className="lowercase [&>span]:text-xs">{language}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={isCopied ? "Скопировано" : "Копировать"}
        className="text-white/60 hover:text-white"
      >
        {!isCopied && <CopyIcon className="h-4 w-4" />}
        {isCopied && <CheckIcon className="h-4 w-4" />}
      </button>
    </div>
  );
};

const defaultComponents: any = {
  "citation-marker": ({
    n,
    slug,
    quote,
  }: {
    n?: string;
    slug?: string;
    quote?: string;
  }) => (
    <CitationPill n={n ?? "0"} slug={slug} quote={quote} />
  ),
  h1: ({ className, ...props }: { className?: string }) => (
    <h1
      className={cx(
        "mb-8 scroll-m-20 text-4xl font-extrabold tracking-tight last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: { className?: string }) => (
    <h2
      className={cx(
        "mt-8 mb-4 scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: { className?: string }) => (
    <h3
      className={cx(
        "mt-6 mb-4 scroll-m-20 text-2xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: { className?: string }) => (
    <h4
      className={cx(
        "mt-6 mb-4 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }: { className?: string }) => (
    <h5
      className={cx(
        "my-4 text-lg font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }: { className?: string }) => (
    <h6
      className={cx("my-4 font-semibold first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: { className?: string }) => (
    <p
      className={cx("mt-5 mb-5 leading-7 first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }: { className?: string }) => (
    <a
      className={cx(
        "text-primary font-medium underline underline-offset-4",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }: { className?: string }) => (
    <blockquote
      className={cx("border-l-2 pl-6 italic", className)}
      {...props}
    />
  ),
  ul: ({ className, ...props }: { className?: string }) => (
    <ul
      className={cx("my-5 ml-6 list-disc [&>li]:mt-2", className)}
      {...props}
    />
  ),
  ol: ({ className, ...props }: { className?: string }) => (
    <ol
      className={cx("my-5 ml-6 list-decimal [&>li]:mt-2", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }: { className?: string }) => (
    <hr
      className={cx("my-5 border-b", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }: { className?: string }) => (
    <table
      className={cx(
        "my-5 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }: { className?: string }) => (
    <th
      className={cx(
        "bg-muted px-4 py-2 text-left font-bold first:rounded-tl-lg last:rounded-tr-lg [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: { className?: string }) => (
    <td
      className={cx(
        "border-b border-l px-4 py-2 text-left last:border-r [&[align=center]]:text-center [&[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }: { className?: string }) => (
    <tr
      className={cx(
        "m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  sup: ({ className, ...props }: { className?: string }) => (
    <sup
      className={cx("[&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }: { className?: string }) => (
    <pre
      className={cx(
        "max-w-4xl overflow-x-auto rounded-lg bg-black text-white",
        className,
      )}
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: {
    className?: string;
    children: React.ReactNode;
  }) => {
    const match = /language-(\w+)/.exec(className || "");

    if (match) {
      const language = match[1];
      const code = String(children).replace(/\n$/, "");

      return (
        <>
          <CodeHeader
            language={language}
            code={code}
          />
          <SyntaxHighlighter
            language={language}
            className={className}
          >
            {code}
          </SyntaxHighlighter>
        </>
      );
    }

    return (
      <code
        className={cx("rounded font-semibold", className)}
        {...props}
      >
        {children}
      </code>
    );
  },
};

// Stable plugin refs — inline arrays would create new identities every render
// and defeat memoization downstream.
const remarkPlugins = [remarkGfm, remarkMath, remarkCitation];
const rehypePlugins = [rehypeKatex];

/**
 * Smoothly catches up a displayed string to a moving target, character by
 * character, via rAF. Without this the text lands in chunks — SDK throttle
 * (50 ms) plus provider chunking make the stream arrive in ~200 ms bursts.
 * Visually replaying those bursts as a typewriter hides the batching.
 *
 * - If target shrinks (thread switch, edit) → snap.
 * - If target is far ahead → catch-up multiplier so we don't drift behind.
 * - Steady-state ~110 chars/sec ≈ fast-but-readable typewriter.
 */
function useSmoothText(target: string): string {
  const [displayed, setDisplayed] = useState(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    const BASE_CHARS_PER_SEC = 110;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setDisplayed((current) => {
        const t = targetRef.current;
        if (t.length < current.length) return t; // shrink/switch → snap
        if (current.length >= t.length) return current; // caught up
        const gap = t.length - current.length;
        const mult = gap > 600 ? 4 : gap > 250 ? 2 : 1;
        const add = Math.max(
          1,
          Math.floor((delta / 1000) * BASE_CHARS_PER_SEC * mult),
        );
        return t.slice(0, current.length + add);
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return displayed;
}

/**
 * Split streaming markdown into block-level chunks for fine-grained memoization.
 * Fenced code blocks are kept intact so paragraph splits inside them don't tear
 * the fence. During streaming only the trailing block changes, so earlier
 * blocks skip re-parse entirely.
 */
function splitMarkdownBlocks(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/\n{2,}/);
  const blocks: string[] = [];
  let buffer = "";
  let inFence = false;
  for (const part of parts) {
    const fenceCount = (part.match(/```/g) ?? []).length;
    if (inFence) {
      buffer += "\n\n" + part;
      if (fenceCount % 2 === 1) {
        inFence = false;
        blocks.push(buffer);
        buffer = "";
      }
    } else if (fenceCount % 2 === 1) {
      inFence = true;
      buffer = part;
    } else {
      blocks.push(part);
    }
  }
  if (buffer) blocks.push(buffer);
  return blocks;
}

const MarkdownBlock = memo(function MarkdownBlock({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={defaultComponents}
    >
      {content}
    </ReactMarkdown>
  );
});

const MarkdownTextImpl: FC<{ children: string }> = ({ children }) => {
  // Smooth typewriter playback over batched SDK chunks.
  const smoothed = useSmoothText(children);
  // Defer markdown re-parse so React can yield to high-priority work
  // (scroll, animations, input) during streaming.
  const deferredChildren = useDeferredValue(smoothed);
  const blocks = useMemo(
    () => splitMarkdownBlocks(deferredChildren),
    [deferredChildren],
  );
  return (
    <div className="markdown-content">
      {blocks.map((block, i) => (
        <MarkdownBlock
          key={i}
          content={block}
        />
      ))}
    </div>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);
