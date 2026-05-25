"use client";

import { useEffect, useState, type ReactNode } from "react";
import { palette, type } from "./tokens";
import { useStrings } from "./i18n";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

export interface SidebarThread {
  id: string;
  title: string;
}

interface Props {
  threads: SidebarThread[];
  activeId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ threads, activeId, onPick, onNew, onExport, onDelete }: Props) {
  const { s } = useStrings();
  const [hover, setHover] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SidebarThread | null>(null);
  const isTouch = useMediaQuery("(hover: none)");
  const isNarrow = useMediaQuery("(max-width: 640px)");

  // Horizontal halo across the full sidebar width with a soft fade on the
  // right edge. Replaces the earlier radial ellipse, whose `closest-side`
  // radius collapsed to ~90px on a 300px-wide aside and let titles bleed
  // out of the dark zone on every viewport.
  const haloBg =
    "linear-gradient(90deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.92) 78%, rgba(0,0,0,0.55) 94%, rgba(0,0,0,0) 100%)";

  // Reveal the sidebar when the cursor approaches the left edge of the
  // viewport — a 24px "hot zone" wide enough to grab even on a trackpad.
  useEffect(() => {
    if (isTouch) return undefined;
    const onMove = (e: PointerEvent) => {
      if (e.clientX <= 24) setHover(true);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [isTouch]);

  return (
    <>
      {/* Tap-outside backdrop. On touch viewports the aside has no
          mouseleave to close it — the user reported the sidebar staying
          open until they tapped the aside then tapped outside (the second
          tap synthesised mouseleave). A transparent overlay below the
          aside (z 12, vs aside z 13) catches the tap and closes it. */}
      {hover && (isTouch || isNarrow) && (
        <div
          aria-hidden="true"
          onClick={() => setHover(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 12,
            background: "transparent",
          }}
        />
      )}

      {/* Collapsed icon — always visible, left edge, near the top.
          On touch, `onMouseEnter` would fire synthetically right
          before the click and the two setHover calls batched together
          (one to true, one functional toggle) flip the final state to
          false — so the first tap appeared as a no-op and the user
          had to tap a second time. Skip the hover side on touch. */}
      <button
        type="button"
        aria-label={s.sidebar.historyAria}
        onClick={() => setHover((v) => !v)}
        onMouseEnter={isTouch ? undefined : () => setHover(true)}
        style={{
          position: "fixed",
          left: 16,
          top: 24,
          zIndex: 14,
          appearance: "none",
          border: 0,
          cursor: "default",
          background: "transparent",
          color: palette.muted,
          width: 36,
          height: 36,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          transition: "color 240ms ease, background 240ms ease, opacity 240ms ease",
          opacity: hover ? 0 : 1,
          pointerEvents: hover ? "none" : "auto",
        }}
      >
        <svg width={18} height={14} viewBox="0 0 18 14" fill="none">
          <path
            d="M1 2h16M1 7h12M1 12h16"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        </svg>
      </button>

      <aside
        onMouseEnter={isTouch ? undefined : () => setHover(true)}
        onMouseLeave={isTouch ? undefined : () => setHover(false)}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 13,
          width: 300,
          transform: `translateX(${hover ? 0 : -320}px)`,
          transition: "transform 360ms cubic-bezier(.22,.61,.36,1)",
          background: haloBg,
          padding: "78px 24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          color: palette.text,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: type.mono,
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: palette.faint,
          }}
        >
          <span>{s.sidebar.history}</span>
          <span>{threads.length}</span>
        </div>

        <button
          type="button"
          onClick={onNew}
          style={{
            appearance: "none",
            border: 0,
            cursor: "default",
            background: "transparent",
            color: palette.text,
            fontFamily: type.ui,
            fontSize: 13.5,
            letterSpacing: "0.01em",
            textAlign: "left",
            padding: "8px 4px",
            borderTop: `0.5px solid ${palette.hairline}`,
            borderBottom: `0.5px solid ${palette.hairline}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            transition: "color 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.text;
          }}
        >
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <path
              d="M6 1v10M1 6h10"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
            />
          </svg>
          <span>{s.sidebar.newChat}</span>
        </button>

        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(255,255,255,0.1) transparent",
          }}
        >
          {threads.length === 0 && (
            <div
              style={{
                fontFamily: type.quote,
                fontStyle: "italic",
                color: palette.faint,
                fontSize: 13.5,
                lineHeight: 1.6,
                padding: "12px 4px",
              }}
            >
              {s.sidebar.empty}
            </div>
          )}
          {threads.map((c) => {
            const active = c.id === activeId;
            return (
              <ThreadRow
                key={c.id}
                thread={c}
                active={active}
                onPick={onPick}
                onExport={onExport}
                onRequestDelete={(t) => setPendingDelete(t)}
                exportAria={s.sidebar.exportAria}
                deleteAria={s.sidebar.deleteAria}
              />
            );
          })}
        </nav>
      </aside>

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        threadTitle={pendingDelete?.title ?? ""}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
        }}
      />
    </>
  );
}

interface RowProps {
  thread: SidebarThread;
  active: boolean;
  onPick: (id: string) => void;
  onExport: (id: string) => void;
  onRequestDelete: (t: SidebarThread) => void;
  exportAria: string;
  deleteAria: string;
}

function ThreadRow({
  thread,
  active,
  onPick,
  onExport,
  onRequestDelete,
  exportAria,
  deleteAria,
}: RowProps) {
  const [rowHover, setRowHover] = useState(false);
  const isTouch = useMediaQuery("(hover: none)");
  const isNarrow = useMediaQuery("(max-width: 640px)");
  // On touch / narrow viewports there is no reliable hover; the icons
  // should be permanently discoverable instead of fading in.
  const showActions = isTouch || isNarrow || rowHover;
  return (
    <div
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        borderRadius: 6,
        transition: "background 200ms ease",
      }}
    >
      <button
        type="button"
        onClick={() => onPick(thread.id)}
        style={{
          appearance: "none",
          border: 0,
          cursor: "default",
          background: "transparent",
          color: active ? palette.text : palette.muted,
          fontFamily: type.ui,
          fontSize: 13,
          lineHeight: 1.45,
          textAlign: "left",
          padding: "10px 10px",
          transition: "color 200ms ease",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.color = palette.text;
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.color = palette.muted;
        }}
      >
        {thread.title}
      </button>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          marginRight: 4,
          opacity: showActions ? 1 : 0,
          transition: "opacity 200ms ease",
        }}
      >
        <RowIconButton
          ariaLabel={exportAria}
          onClick={() => onExport(thread.id)}
        >
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <path
              d="M6 1v7M3 5l3 3 3-3M2 10h8"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </RowIconButton>
        <RowIconButton
          ariaLabel={deleteAria}
          onClick={() => onRequestDelete(thread)}
          danger
        >
          <svg width={12} height={12} viewBox="0 0 12 12" fill="none">
            <path
              d="M2 3h8M4.5 3V2.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V3M3 3l.6 7.2a.75.75 0 0 0 .75.7h3.3a.75.75 0 0 0 .75-.7L9 3M5 5.5v3.25M7 5.5v3.25"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </RowIconButton>
      </div>
    </div>
  );
}

interface RowIconButtonProps {
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}

function RowIconButton({ ariaLabel, onClick, children, danger }: RowIconButtonProps) {
  const hoverColor = danger ? "#e9b6a8" : palette.text;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        appearance: "none",
        border: 0,
        cursor: "default",
        background: "transparent",
        color: palette.faint,
        padding: 4,
        borderRadius: 4,
        display: "grid",
        placeItems: "center",
        transition: "color 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = palette.faint;
      }}
    >
      {children}
    </button>
  );
}
