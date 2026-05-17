"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { palette, type } from "@/components/logos/tokens";
import { useStrings } from "@/components/logos/i18n";
import { Copyable } from "./Copyable";

const PLUGIN_REPO = "https://github.com/logospatrum/patristic-plugin";

/** Tool catalogue shown in the JSON-tab footer. Bilingual descriptions. */
const TOOLS: ReadonlyArray<{ name: string; ru: string; en: string }> = [
  { name: "read_passage",    ru: "Verbatim параграф по слугу + метаданные",                en: "Verbatim paragraph by slug, with metadata" },
  { name: "lexical_search",  ru: "Postgres tsvector + ts_rank — для дословных терминов",    en: "Postgres tsvector + ts_rank — best for verbatim terms" },
  { name: "semantic_search", ru: "bge-m3 + pgvector cosine — для смысловых запросов",       en: "bge-m3 + pgvector cosine — best for conceptual queries" },
  { name: "list_authors",    ru: "Список всех 86 авторов",                                  en: "All 86 authors with slugs and metadata" },
  { name: "list_works",      ru: "Работы одного автора по slug",                            en: "Works of one author by slug" },
  { name: "expand_concept",  ru: "Расширение церковнославянизмов через глоссарий",          en: "Resolve Church-Slavonic synonyms via glossary" },
];

/**
 * Trigger pill + modal that gives a third-party agent author the commands
 * they need to plug into our MCP server.
 *
 * Two tabs:
 * - Claude Code: `/plugin marketplace add + /plugin install patristic`
 *   (full bundle with teo-search subagent + theology-router skill), plus
 *   `claude mcp add` fallback for MCP-only.
 * - JSON: copyable mcpServers config for Cursor / Cline / langchain agents.
 *
 * Self-contained — owns its own Radix dialog. Slotted into TopChrome as
 * `connectSlot` (mirroring the LibraryBrowser pattern).
 *
 * Spec: docs/superpowers/specs/2026-05-17-mcp-feature-and-prod-rollout-design.md section 5
 */
export function ConnectAgent() {
  const { s, lang } = useStrings();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"claude" | "json">("claude");

  // Build the MCP URL once the dialog opens — on SSR `window` is undefined,
  // so we read it lazily on the client. Falls back to the prod domain for
  // the first render so the JSON tab isn't empty if someone reads it before
  // any open event.
  const [mcpUrl, setMcpUrl] = useState("https://logospatrum.com/api/mcp");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setMcpUrl(`${window.location.origin}/api/mcp`);
    }
  }, [open]);

  const pluginInstall =
    `/plugin marketplace add ${PLUGIN_REPO}\n/plugin install patristic`;
  const rawMcpInstall =
    `claude mcp add --transport http patristic ${mcpUrl}`;
  const genericJson = JSON.stringify(
    { patristic: { type: "http", url: mcpUrl } },
    null,
    2,
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          aria-label={s.connect.triggerAria}
          style={{
            padding: "6px 14px",
            background: "transparent",
            border: `1px solid ${palette.faint}`,
            borderRadius: 999,
            color: palette.text,
            fontFamily: type.mono,
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {s.connect.trigger}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className="logos-library-overlay"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 50 }}
        />
        <Dialog.Content
          className="logos-library-content"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 51,
            width: "min(640px, 92vw)",
            maxHeight: "85vh",
            overflowY: "auto",
            background: palette.bg,
            border: `1px solid ${palette.faint}`,
            borderRadius: 8,
            padding: "28px 32px",
            color: palette.text,
            fontFamily: type.ui,
          }}
        >
          <Dialog.Title
            style={{ fontFamily: type.logo, fontSize: 22, marginBottom: 8 }}
          >
            {s.connect.title}
          </Dialog.Title>
          <Dialog.Description
            style={{ fontSize: 13, marginBottom: 24, color: palette.muted }}
          >
            {s.connect.blurb}
          </Dialog.Description>

          <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button
              role="tab"
              aria-selected={tab === "claude"}
              onClick={() => setTab("claude")}
              style={tabBtnStyle(tab === "claude")}
            >
              {s.connect.tabClaude}
            </button>
            <button
              role="tab"
              aria-selected={tab === "json"}
              onClick={() => setTab("json")}
              style={tabBtnStyle(tab === "json")}
            >
              {s.connect.tabJson}
            </button>
          </div>

          {tab === "claude" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, marginBottom: 8 }}>{s.connect.fullPluginLabel}</p>
                <Copyable text={pluginInstall} />
              </div>
              <div>
                <p style={{ fontSize: 13, marginBottom: 8 }}>{s.connect.rawMcpLabel}</p>
                <Copyable text={rawMcpInstall} />
              </div>
            </div>
          )}

          {tab === "json" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13 }}>{s.connect.jsonBlurb}</p>
              <Copyable text={genericJson} />
              <div>
                <p style={{ fontSize: 13, marginBottom: 8, marginTop: 8 }}>{s.connect.toolsList}</p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12.5 }}>
                  {TOOLS.map((t) => (
                    <li
                      key={t.name}
                      style={{ padding: "4px 0", borderBottom: `1px solid ${palette.faint}` }}
                    >
                      <code style={{ fontFamily: type.mono, color: palette.text }}>{t.name}</code>
                      &nbsp;—&nbsp;
                      <span style={{ color: palette.muted }}>{lang === "ru" ? t.ru : t.en}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, fontSize: 12, color: palette.muted }}>
            <a
              href={PLUGIN_REPO}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.connect.sourcesAria}
              style={{ color: palette.text, textDecoration: "underline" }}
            >
              {s.connect.sourcesLink}
            </a>
          </div>

          <Dialog.Close asChild>
            <button
              aria-label="Close"
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                background: "transparent",
                border: 0,
                color: palette.text,
                fontSize: 20,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    background: active ? palette.text : "transparent",
    border: `1px solid ${palette.faint}`,
    borderRadius: 4,
    color: active ? palette.bg : palette.text,
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    cursor: "pointer",
  };
}
