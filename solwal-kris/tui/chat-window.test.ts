import { expect, test } from "bun:test";
import { boundChat, chatOfPrompt, lastReply } from "./chat-window.ts";

test("a new window's chat is known once its prompt is accepted", () => {
  expect(boundChat([{ type: "receipt", status: "queued" }])).toBeNull();
  expect(boundChat([{ type: "receipt", status: "queued" }, { type: "receipt", status: "accepted", conversation: "abc" }])).toBe("abc");
});
test("a prompt that may or may not have gone through is not retried", () => {
  expect(() => boundChat([{ type: "receipt", status: "uncertain", error: "lost" }])).toThrow("lost");
});
test("only the assistant's message is the reply", () => {
  expect(lastReply([{ type: "message", role: "user", text: "hi" }])).toBeNull();
  expect(lastReply([{ type: "message", role: "user", text: "hi" }, { type: "message", role: "assistant", text: "first" }, { type: "message", role: "assistant", text: "second" }])).toBe("second");
});
test("a window whose send was not confirmed can still be found and closed", () => {
  const prompt = "x".repeat(500), list = [{ name: "a", rows: [{ type: "message", role: "user", text: "other" }] }, { name: "b", rows: [{ type: "message", role: "user", text: "x".repeat(300) + "\n\n\u2026\nShow more" }] }];
  expect(chatOfPrompt(prompt, list)).toBe("b");
  expect(chatOfPrompt("nothing like it", list)).toBeNull();
});
test("a prompt is found even when the page dropped its punctuation", () => {
  const prompt = `${"words ".repeat(50)}"list":["one (holds $5)","two"]`;
  const shown = `${"words ".repeat(50)}"list":"one (holds $5)\n\n\u2026\nShow more`;
  expect(chatOfPrompt(prompt, [{ name: "c", rows: [{ type: "message", role: "user", text: shown }] }])).toBe("c");
});
