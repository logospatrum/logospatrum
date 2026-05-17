import { describe, it, expect } from "vitest";
import type { AIMessage, Message, ToolMessage } from "@langchain/langgraph-sdk";
import {
  messagesToMarkdown,
  exportFilename,
  slugifyTitle,
  fmtDate,
} from "../export-markdown";

function human(id: string, text: string): Message {
  return {
    id,
    type: "human",
    content: [{ type: "text", text }],
  } as Message;
}

function ai(
  id: string,
  text: string,
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [],
): AIMessage {
  return {
    id,
    type: "ai",
    content: text,
    tool_calls: toolCalls.map((tc) => ({ ...tc, type: "tool_call" })),
  } as unknown as AIMessage;
}

function toolMsg(id: string, callId: string, json: unknown): ToolMessage {
  return {
    id,
    type: "tool",
    tool_call_id: callId,
    name: "read_passage",
    content: JSON.stringify(json),
  } as unknown as ToolMessage;
}

const NOW = new Date(2026, 4, 17, 12, 30); // 2026-05-17 12:30 local

describe("slugifyTitle", () => {
  it("transliterates Russian, lowercases, collapses to hyphens", () => {
    expect(slugifyTitle("Сущность и энергия — Палама")).toBe("sushhnost-i-energija-palama");
  });

  it("caps at 40 chars", () => {
    const s = slugifyTitle("a".repeat(60));
    expect(s.length).toBe(40);
  });

  it("falls back to 'chat' for empty / pure-punctuation titles", () => {
    expect(slugifyTitle("!!! ??? ...")).toBe("chat");
    expect(slugifyTitle("")).toBe("chat");
  });
});

describe("exportFilename", () => {
  it("builds 'logos-<slug>-<date>.md'", () => {
    expect(exportFilename("Палама о свете", NOW)).toBe("logos-palama-o-svete-2026-05-17.md");
  });
});

describe("fmtDate", () => {
  it("zero-pads month and day", () => {
    expect(fmtDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("messagesToMarkdown — patristic + Bible + error citations", () => {
  const messages: Message[] = [
    human("h1", "Расскажи про свет Преображения"),
    ai("a1", "Сначала ищу.", [
      {
        id: "t1",
        name: "read_passage",
        args: { citation: "palama_grigorij/triady/0001/p3" },
      },
      {
        id: "t2",
        name: "read_passage",
        args: { citation: "svjashhennoe_pisanie/bible_evangelie_ot_matfeja/0017/p2" },
      },
      {
        id: "t3",
        name: "read_passage",
        args: { citation: "bad/slug/0001/p1" },
      },
    ]) as unknown as Message,
    toolMsg("t1", "t1", {
      found: true,
      text: "Тварный свет — это…",
      context_before: "",
      context_after: "",
      author: "Свт. Григорий Палама",
      work_title: "Триады",
      source_url: "https://azbyka.ru/otechnik/Grigorij_Palama/triady/",
      chapter_title: null,
      chapter_num: 1,
      para_start: 3,
      window_size: 1,
      citation: "palama_grigorij/triady/0001/p3",
    }) as unknown as Message,
    toolMsg("t2", "t2", {
      found: true,
      text: "И преобразился пред ними…",
      context_before: "",
      context_after: "",
      author: "Священное Писание",
      work_title: "Евангелие от Матфея",
      source_url: null,
      chapter_title: null,
      chapter_num: 17,
      para_start: 2,
      window_size: 1,
      citation: "svjashhennoe_pisanie/bible_evangelie_ot_matfeja/0017/p2",
    }) as unknown as Message,
    toolMsg("t3", "t3", {
      found: false,
      error: "passage not found",
      citation: "bad/slug/0001/p1",
      work_exists: false,
    }) as unknown as Message,
    ai(
      "a2",
      "Свет Преображения нетварный [[palama_grigorij/triady/0001/p3|«нетварная слава»]]. См. также [[svjashhennoe_pisanie/bible_evangelie_ot_matfeja/0017/p2|«просияло лице Его»]]. Ложная ссылка [[bad/slug/0001/p1|«пропавшая»]].",
    ) as unknown as Message,
  ];

  const md = messagesToMarkdown(messages, { lang: "ru", title: "Свет Преображения", now: NOW });

  it("emits a title header with the exported timestamp", () => {
    expect(md).toMatch(/^# Свет Преображения/);
    expect(md).toContain("_Экспорт: 2026-05-17 12:30 · ΛΟΓΟΣ_");
  });

  it("emits Вопрос and Ответ sections", () => {
    expect(md).toContain("## Вопрос");
    expect(md).toContain("## Ответ");
    expect(md).toContain("Расскажи про свет Преображения");
  });

  it("rewrites inline markers to [N] in order", () => {
    expect(md).toContain("нетварный [1]");
    expect(md).toContain("[2].");
    expect(md).toContain("Ложная ссылка [3].");
    expect(md).not.toContain("[[");
  });

  it("appends a Цитаты block with one row per marker", () => {
    expect(md).toContain("**Цитаты:**");
    expect(md).toContain("1. *«нетварная слава»* — Свт. Григорий Палама. Триады");
    expect(md).toContain("[azbyka](https://azbyka.ru/otechnik/Grigorij_Palama/triady/)");
  });

  it("renders Scripture rows as 'Мф 17:2' with a built azbyka URL", () => {
    expect(md).toContain("2. *«просияло лице Его»* — Священное Писание. Евангелие от Матфея (Мф 17:2)");
    expect(md).toContain("[azbyka](https://azbyka.ru/biblia/?Mt.17:2)");
  });

  it("renders error citations with the not-found tag and raw slug", () => {
    expect(md).toContain("3. *«пропавшая»* — `bad/slug/0001/p1` _(цитата не найдена)_");
  });

  it("does not include tool-call detail in the output", () => {
    expect(md).not.toContain("Сначала ищу");
    expect(md).not.toContain("read_passage");
    expect(md).not.toContain("Тварный свет — это");
  });
});

describe("messagesToMarkdown — English locale", () => {
  const messages: Message[] = [
    human("h1", "Tell me about the Light of Tabor"),
    ai("a1", "", [
      {
        id: "t1",
        name: "read_passage",
        args: { citation: "palama_grigorij/triady/0001/p3" },
      },
    ]) as unknown as Message,
    toolMsg("t1", "t1", {
      found: true,
      text: "...",
      context_before: "",
      context_after: "",
      author: "St. Gregory Palamas",
      work_title: "Triads",
      source_url: "https://azbyka.ru/otechnik/Grigorij_Palama/triady/",
      chapter_title: null,
      chapter_num: 1,
      para_start: 3,
      window_size: 2,
      citation: "palama_grigorij/triady/0001/p3-4",
    }) as unknown as Message,
    ai("a2", "Uncreated [[palama_grigorij/triady/0001/p3|«uncreated glory»]].") as unknown as Message,
  ];
  const md = messagesToMarkdown(messages, { lang: "en", title: "Tabor", now: NOW });

  it("uses English labels", () => {
    expect(md).toContain("## Question");
    expect(md).toContain("## Answer");
    expect(md).toContain("**Citations:**");
    expect(md).toContain("_Exported: 2026-05-17 12:30 · ΛΟΓΟΣ_");
  });
});

describe("messagesToMarkdown — empty / no markers", () => {
  it("omits Цитаты when the answer has no markers", () => {
    const messages: Message[] = [
      human("h", "Кто такой Палама?"),
      ai("a", "Это византийский богослов XIV в.") as unknown as Message,
    ];
    const md = messagesToMarkdown(messages, { lang: "ru", title: "test", now: NOW });
    expect(md).not.toContain("**Цитаты:**");
    expect(md).toContain("Это византийский богослов XIV в.");
  });
});
