"use client";

import { BookOpen } from "lucide-react";

const EXAMPLES: string[] = [
  "Что Лествичник говорит о послушании?",
  "Найди цитаты про осуждение ближнего",
  "Августин о благодати и свободной воле",
  "Как святые отцы понимали обожение",
];

export function PatristicWelcome({
  onPick,
}: {
  onPick: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12 text-center">
      <div className="flex items-center gap-3">
        <BookOpen
          className="h-8 w-8 text-amber-700"
          aria-hidden="true"
        />
        <h1 className="text-3xl font-semibold tracking-tight">
          Патристический помощник
        </h1>
      </div>
      <p className="text-muted-foreground max-w-xl text-base leading-relaxed">
        Спроси о святоотеческой литературе, греческой философии или Писании.
        Ответы — с точными цитатами и ссылками на оригинал.
      </p>
      <div className="mt-2 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLES.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-lg border bg-white px-4 py-3 text-left text-sm leading-snug shadow-sm transition hover:bg-amber-50 hover:shadow"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
