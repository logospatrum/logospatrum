"use client";
import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  X,
} from "lucide-react";
import {
  useCatalog,
  type CatalogAuthor,
  type CatalogWork,
} from "./use-catalog";
import { reachGoal } from "@/lib/metrika";

interface Props {
  onAskAboutWork: (author: string, work: string) => void;
}

export function LibraryBrowser({ onAskAboutWork }: Props) {
  const [open, setOpen] = useState(false);
  const { data, loading, error } = useCatalog();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const matches = useMemo<CatalogAuthor[]>(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.authors;
    return data.authors
      .map((a) => {
        const authorMatches = a.name.toLowerCase().includes(q);
        const filteredWorks = a.works.filter(
          (w) =>
            w.title.toLowerCase().includes(q) ||
            (w.topics || []).some((t) => t.toLowerCase().includes(q)),
        );
        if (authorMatches || filteredWorks.length > 0) {
          return { ...a, works: authorMatches ? a.works : filteredWorks };
        }
        return null;
      })
      .filter((a): a is CatalogAuthor => a !== null);
  }, [data, search]);

  // When searching, auto-expand all matching authors so results are visible.
  const effectiveExpanded = useMemo<Set<string>>(() => {
    if (!search.trim()) return expanded;
    const out = new Set<string>();
    matches.forEach((a) => out.add(a.slug));
    return out;
  }, [matches, expanded, search]);

  const toggle = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next && !open) reachGoal("library_opened");
        setOpen(next);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Открыть библиотеку"
          title="Библиотека"
          className="logos-library-trigger"
        >
          <BookOpen
            className="h-3.5 w-3.5"
            aria-hidden="true"
          />
          <span>Корпус</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="logos-library-overlay" />
        <Dialog.Content className="logos-library-content">
          <div className="logos-library-header">
            <Dialog.Title className="logos-library-title">Корпус</Dialog.Title>
            <Dialog.Description className="sr-only">
              Каталог авторов и трудов
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                className="logos-library-close"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="logos-library-search">
            <input
              type="text"
              placeholder="Поиск по авторам, трудам, темам..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="logos-library-input"
            />
          </div>
          <div className="logos-library-list">
            {loading && (
              <div className="logos-library-info">Загрузка…</div>
            )}
            {error && (
              <div className="logos-library-error">Ошибка: {error}</div>
            )}
            {matches.map((a) => {
              const isOpen = effectiveExpanded.has(a.slug);
              return (
                <div
                  key={a.slug}
                  className="logos-library-author"
                >
                  <button
                    type="button"
                    className="logos-library-author-btn"
                    onClick={() => toggle(a.slug)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="logos-library-author-name">{a.name}</span>
                    {a.years && (
                      <span className="logos-library-meta">{a.years}</span>
                    )}
                    <span className="logos-library-count">{a.works.length} тр.</span>
                  </button>
                  {isOpen && (
                    <div className="logos-library-works">
                      {a.works.map((w) => (
                        <WorkRow
                          key={w.slug}
                          work={w}
                          onAsk={() => {
                            onAskAboutWork(a.name, w.title);
                            setOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && !error && matches.length === 0 && (
              <div className="logos-library-info">Ничего не найдено</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkRow({ work, onAsk }: { work: CatalogWork; onAsk: () => void }) {
  return (
    <div className="logos-library-work">
      <div className="logos-library-work-title">
        <span className="truncate">{work.title}</span>
        {work.creation_date && (
          <span className="logos-library-meta">({work.creation_date})</span>
        )}
        {work.paragraph_count > 0 && (
          <span className="logos-library-meta">· {work.paragraph_count} §</span>
        )}
      </div>
      <div className="logos-library-work-actions">
        <button
          type="button"
          onClick={onAsk}
          className="logos-library-work-action"
          title="Спросить агента про этот труд"
          aria-label="Спросить агента про этот труд"
        >
          <MessageSquare className="h-3 w-3" />
        </button>
        {work.source_url && (
          <a
            href={work.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="logos-library-work-action"
            title="Открыть на azbyka.ru"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
