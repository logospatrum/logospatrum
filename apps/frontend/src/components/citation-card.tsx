"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

export interface ReadPassageResult {
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

export function CitationCard({ data }: { data: ReadPassageResult }) {
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
