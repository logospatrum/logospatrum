import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { groupMessagesIntoTurns } from "../turns";

const human = (id: string, text: string): Message => ({
  id, type: "human", content: [{ type: "text", text }],
} as Message);

const ai = (id: string, text: string, toolCalls: Array<{name: string; id: string; args: Record<string, unknown>}> = []): Message => ({
  id, type: "ai", content: text,
  tool_calls: toolCalls.map((tc) => ({ ...tc, type: "tool_call" as const })),
} as Message);

const tool = (id: string, name: string, callId: string, result: unknown): Message => ({
  id, type: "tool", name, tool_call_id: callId,
  content: typeof result === "string" ? result : JSON.stringify(result),
} as Message);

describe("groupMessagesIntoTurns", () => {
  it("returns empty array for empty messages", () => {
    expect(groupMessagesIntoTurns([], false)).toEqual([]);
  });

  it("groups one human + one ai answer into one turn with no tool calls", () => {
    const turns = groupMessagesIntoTurns(
      [human("h1", "Что говорит Дамаскин?"), ai("a1", "Учение о латрии…")],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].human?.id).toBe("h1");
    expect(turns[0].ais).toHaveLength(1);
    expect(turns[0].toolCalls).toEqual([]);
    expect(turns[0].answerText).toBe("Учение о латрии…");
    expect(turns[0].inProgress).toBe(false);
  });

  it("pairs tool calls with their tool results by tool_call_id", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "найди про иконы"),
        ai("a1", "", [{ name: "search", id: "tc1", args: { q: "иконы" } }]),
        tool("t1", "search", "tc1", { hits: 3 }),
        ai("a2", "Найдено 3 фрагмента…"),
      ],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].toolCalls).toHaveLength(1);
    const tc = turns[0].toolCalls[0];
    expect(tc.id).toBe("tc1");
    expect(tc.name).toBe("search");
    expect(tc.args).toEqual({ q: "иконы" });
    expect(tc.pending).toBe(false);
    expect(tc.jsonResult).toEqual({ hits: 3 });
    expect(turns[0].answerText).toBe("Найдено 3 фрагмента…");
  });

  it("marks a tool call as pending if no matching tool message yet", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "?"),
        ai("a1", "", [{ name: "search", id: "tc1", args: {} }]),
      ],
      true,
    );
    expect(turns[0].toolCalls[0].pending).toBe(true);
    expect(turns[0].toolCalls[0].jsonResult).toBeNull();
    expect(turns[0].toolCalls[0].rawResult).toBeNull();
  });

  it("flags the latest turn as inProgress when isLoading=true", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "first"), ai("a1", "answered"),
        human("h2", "second"), ai("a2", "..."),
      ],
      true,
    );
    expect(turns[0].inProgress).toBe(false);
    expect(turns[1].inProgress).toBe(true);
  });

  it("uses the latest non-empty AI content as answerText (skips empty shells)", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "?"),
        // Empty AI shell (only contained tool_calls)
        ai("a1", "", [{ name: "search", id: "tc1", args: {} }]),
        tool("t1", "search", "tc1", "ok"),
        ai("a2", "финальный ответ"),
      ],
      false,
    );
    expect(turns[0].answerText).toBe("финальный ответ");
  });

  it("falls back to a synthesized key when the human message has no id", () => {
    const turns = groupMessagesIntoTurns(
      [{ type: "human", content: "?" } as Message],
      false,
    );
    expect(turns[0].key).toBeDefined();
    expect(turns[0].key.length).toBeGreaterThan(0);
  });

  it("handles a leading tool/ai message before any human (interrupt resume)", () => {
    const turns = groupMessagesIntoTurns(
      [ai("a1", "продолжаю с чекпойнта")],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].human).toBeNull();
    expect(turns[0].answerText).toBe("продолжаю с чекпойнта");
  });

  it("parses Anthropic-streamed tool_use blocks inside AI content array", () => {
    const aiAnthropic: Message = {
      id: "a1", type: "ai",
      content: [
        { type: "text", text: "ищу…" },
        { type: "tool_use", id: "tc1", name: "search", input: '{"q":"палама"}' },
      ],
    } as Message;
    const turns = groupMessagesIntoTurns(
      [human("h1", "?"), aiAnthropic],
      true,
    );
    expect(turns[0].toolCalls).toHaveLength(1);
    expect(turns[0].toolCalls[0].id).toBe("tc1");
    expect(turns[0].toolCalls[0].name).toBe("search");
    expect(turns[0].toolCalls[0].args).toEqual({ q: "палама" });
  });

  it("filters out invoke_skill tool calls from the ThinkingTrace", () => {
    const turns = groupMessagesIntoTurns(
      [
        human("h1", "ислам?"),
        ai("a1", "Отвечаю...", [
          { name: "invoke_skill", id: "tc1", args: { name: "apologetics" } },
          { name: "semantic_search", id: "tc2", args: { query: "ислам" } },
        ]),
        tool("t1", "invoke_skill", "tc1", "BODY..."),
        tool("t2", "semantic_search", "tc2", "[]"),
      ],
      false,
    );
    expect(turns).toHaveLength(1);
    // Only semantic_search survives; invoke_skill is filtered.
    expect(turns[0].toolCalls).toHaveLength(1);
    expect(turns[0].toolCalls[0].name).toBe("semantic_search");
  });
});
