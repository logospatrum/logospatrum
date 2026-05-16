import type { Message } from "@langchain/langgraph-sdk";

/**
 * Slice the chat history so a regenerate can be re-submitted. Drops everything
 * after the last human message (the assistant turn we want to redo). Returns
 * an empty array if there is no human message.
 */
export function sliceForRegenerate(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "human") {
      return messages.slice(0, i + 1);
    }
  }
  return [];
}

/**
 * Slice the chat history so an edited human message can be re-submitted.
 * Replaces the content of the message with `humanId` and drops every message
 * after it. Returns the original array (same reference) if the id is not
 * found, so callers can no-op cheaply.
 */
export function sliceForEdit(
  messages: Message[],
  humanId: string,
  newText: string,
): Message[] {
  const idx = messages.findIndex((m) => m.id === humanId);
  if (idx < 0) return messages;
  const target = messages[idx];
  const replaced: Message = { ...target, content: newText } as Message;
  return [...messages.slice(0, idx), replaced];
}
