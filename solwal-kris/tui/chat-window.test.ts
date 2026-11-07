import { expect, test } from "bun:test";
import { boundChat, lastReply } from "./chat-window.ts";

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
