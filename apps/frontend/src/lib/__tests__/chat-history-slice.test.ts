import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { sliceForRegenerate, sliceForEdit } from "../chat-history-slice";

function human(id: string, text: string): Message {
  return { id, type: "human", content: text } as Message;
}
function ai(id: string, text: string): Message {
  return { id, type: "ai", content: text } as Message;
}
function tool(id: string, callId: string): Message {
  return { id, type: "tool", tool_call_id: callId, content: "ok" } as Message;
}

describe("sliceForRegenerate", () => {
  it("returns input through the last human (drops trailing assistant turn)", () => {
    const msgs: Message[] = [
      human("h1", "first question"),
      ai("a1", "first answer"),
      human("h2", "second question"),
      ai("a2", "second answer"),
    ];
    expect(sliceForRegenerate(msgs)).toEqual([
      human("h1", "first question"),
      ai("a1", "first answer"),
      human("h2", "second question"),
    ]);
  });

  it("drops tool messages between the last human and the trailing assistant", () => {
    const msgs: Message[] = [
      human("h1", "q"),
      ai("a1", "calling tool"),
      tool("t1", "call-1"),
      ai("a2", "final answer"),
    ];
    expect(sliceForRegenerate(msgs)).toEqual([human("h1", "q")]);
  });

  it("returns empty array when there is no human message", () => {
    expect(sliceForRegenerate([])).toEqual([]);
    expect(sliceForRegenerate([ai("a", "stray")])).toEqual([]);
  });
});

describe("sliceForEdit", () => {
  it("replaces target human content and drops everything after", () => {
    const msgs: Message[] = [
      human("h1", "first"),
      ai("a1", "first answer"),
      human("h2", "second"),
      ai("a2", "second answer"),
    ];
    const out = sliceForEdit(msgs, "h2", "second edited");
    expect(out).toEqual([
      human("h1", "first"),
      ai("a1", "first answer"),
      { id: "h2", type: "human", content: "second edited" },
    ]);
  });

  it("returns the original array when target id is not found", () => {
    const msgs: Message[] = [human("h1", "q"), ai("a1", "a")];
    expect(sliceForEdit(msgs, "missing", "new")).toBe(msgs);
  });

  it("works when target is the first message", () => {
    const msgs: Message[] = [
      human("h1", "first"),
      ai("a1", "answer"),
    ];
    expect(sliceForEdit(msgs, "h1", "edited")).toEqual([
      { id: "h1", type: "human", content: "edited" },
    ]);
  });
});
