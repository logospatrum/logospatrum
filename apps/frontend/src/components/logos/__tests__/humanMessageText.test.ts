import { describe, it, expect } from "vitest";
import type { Message } from "@langchain/langgraph-sdk";
import { humanMessageText } from "../markdown/content";

describe("humanMessageText", () => {
  it("returns string content as-is", () => {
    const m = { type: "human", content: "вопрос" } as Message;
    expect(humanMessageText(m)).toBe("вопрос");
  });

  it("joins text blocks with newline", () => {
    const m = {
      type: "human",
      content: [
        { type: "text", text: "первая строка" },
        { type: "text", text: "вторая строка" },
      ],
    } as Message;
    expect(humanMessageText(m)).toBe("первая строка\nвторая строка");
  });

  it("skips non-text blocks (images, files)", () => {
    const m = {
      type: "human",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
        { type: "text", text: "только текст" },
      ],
    } as unknown as Message;
    expect(humanMessageText(m)).toBe("только текст");
  });

  it("returns empty string for empty array", () => {
    const m = { type: "human", content: [] } as Message;
    expect(humanMessageText(m)).toBe("");
  });

  it("returns empty string for unexpected content shape", () => {
    const m = { type: "human", content: undefined } as unknown as Message;
    expect(humanMessageText(m)).toBe("");
  });
});
