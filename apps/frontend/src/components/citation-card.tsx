"use client";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

export interface ReadPassageSuccess {
  found: true;
  text: string;
  context_before: string;
  context_after: string;
  author: string | null;
  work_title: string | null;
  source_url: string | null;
  chapter_title: string | null;
  chapter_num: number;
  para_start: number;
  window_size: number;
  citation: string;
}

export interface ReadPassageFailure {
  found: false;
  error: string;
  citation: string;
  work_exists?: boolean;
}

export type ReadPassageResult = ReadPassageSuccess | ReadPassageFailure;

export function CitationCard({ data }: { data: ReadPassageResult }) {
  if (data.found === false) {
    return <CitationCardError data={data} />;
  }
  return <CitationCardSuccess data={data} />;
}

function CitationCardSuccess({ data }: { data: ReadPassageSuccess }) {
  const [showContext, setShowContext] = useState(false);
  const paraLabel =
    data.window_size === 1
      ? `§${data.para_start}`
      : `§${data.para_start}-${data.para_start + data.window_size - 1}`;
  const header = [
    data.author,
    data.work_title,
    data.chapter_title || (data.chapter_num ? `гл. ${data.chapter_num}` : null),
    paraLabel,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="bg-muted/40 my-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{header}</div>
        {data.source_url && (
          <a
            href={data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            azbyka <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="mt-2 text-sm whitespace-pre-wrap">{data.text}</div>
      {(data.context_before || data.context_after) && (
        <>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs"
            onClick={() => setShowContext((v) => !v)}
          >
            {showContext ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showContext ? "скрыть контекст" : "развернуть контекст"}
          </button>
          {showContext && (
            <div className="text-muted-foreground mt-2 border-l-2 pl-2 text-xs whitespace-pre-wrap">
              {data.context_before && (
                <div className="italic">{data.context_before}</div>
              )}
              {data.context_before && data.context_after && (
                <div className="h-2" />
              )}
              {data.context_after && (
                <div className="italic">{data.context_after}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CitationCardError({ data }: { data: ReadPassageFailure }) {
  // Diagnostic from the backend tool (read_passage.py):
  //   work_exists === false -> agent hallucinated the work_slug
  //   work_exists === true  -> work is there, but no paragraph at that
  //                            (chapter_num, para_start)
  //   undefined             -> citation didn't even parse
  const explain =
    data.work_exists === false
      ? "Похоже, агент сократил slug. Попроси: «возьми citation из результатов поиска буква-в-букву»."
      : data.work_exists === true
        ? "Труд найден, но такого параграфа нет — глава/номер ошибочны."
        : "Citation не разобрался — нужен формат author_slug/work_slug/NNNN/pX.";
  return (
    <div className="my-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 text-sm">
          <div className="font-medium">Цитата не найдена</div>
          <div className="mt-1 text-xs break-all opacity-80">
            <code>{data.citation}</code>
          </div>
          <div className="mt-1 text-xs">{explain}</div>
          {data.error && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer opacity-70">подробнее</summary>
              <div className="mt-1 break-words opacity-80">{data.error}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
