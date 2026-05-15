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
      onOpenChange={setOpen}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="hover:bg-muted rounded p-2 transition"
          aria-label="Открыть библиотеку"
          title="Библиотека"
        >
          <BookOpen className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="bg-background fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(720px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border shadow-lg">
          <div className="flex items-center justify-between border-b p-3">
            <Dialog.Title className="font-semibold">Библиотека</Dialog.Title>
            <Dialog.Description className="sr-only">
              Каталог авторов и трудов
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                className="hover:bg-muted rounded p-1"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="border-b p-3">
            <input
              type="text"
              placeholder="Поиск по авторам, трудам, темам..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background w-full rounded border px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loading && (
              <div className="text-muted-foreground py-8 text-center">
                Загрузка...
              </div>
            )}
            {error && (
              <div className="py-8 text-center text-red-500">
                Ошибка: {error}
              </div>
            )}
            {matches.map((a) => {
              const isOpen = effectiveExpanded.has(a.slug);
              return (
                <div
                  key={a.slug}
                  className="mb-1"
                >
                  <button
                    type="button"
                    className="hover:bg-muted flex w-full items-center gap-1 rounded p-1 text-left"
                    onClick={() => toggle(a.slug)}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-medium">{a.name}</span>
                    {a.years && (
                      <span className="text-muted-foreground ml-1 text-xs">
                        {a.years}
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {a.works.length} тр.
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1 ml-6">
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
              <div className="text-muted-foreground py-8 text-center">
                Ничего не найдено
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WorkRow({ work, onAsk }: { work: CatalogWork; onAsk: () => void }) {
  return (
    <div className="group hover:bg-muted/50 flex items-center justify-between rounded px-2 py-1 text-sm">
      <div className="min-w-0 flex-1">
        <span className="truncate">{work.title}</span>
        {work.creation_date && (
          <span className="text-muted-foreground ml-1 text-xs">
            ({work.creation_date})
          </span>
        )}
        {work.paragraph_count > 0 && (
          <span className="text-muted-foreground ml-1 text-xs">
            · {work.paragraph_count} §
          </span>
        )}
      </div>
      <div className="flex gap-1 opacity-60 group-hover:opacity-100">
        <button
          type="button"
          onClick={onAsk}
          className="hover:bg-background rounded p-1"
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
            className="hover:bg-background rounded p-1"
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
