/** One question to ChatGPT in its own small window, through the conversation files of chatgpt-bridge. The window is closed
 * after the reply. A browser window cannot read this machine's files, unlike the Codex runtime. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const BRIDGE = process.env.CHATGPT_BRIDGE ?? "C:/Code/chatgpt-bridge", WINDOW_LOADS_MS = 8_000, POLL_MS = 1_000;
const files = resolve(process.env.CONVERSATIONS_ROOT ?? resolve(homedir(), ".conversations"), "conversations");
type Row = { type?: string; role?: string; text?: string; status?: string; conversation?: string; error?: string };

async function bridge(...args: string[]) {
  const p = Bun.spawn(["bun", "run", "files", ...args], { cwd: BRIDGE, stdout: "pipe", stderr: "pipe" }), out = await new Response(p.stdout).text();
  if (await p.exited) throw new Error(`bridge ${args[0]}: ${(await new Response(p.stderr).text()).slice(0, 120)}`);
  return out.trim();
}
const rows = (file: string): Row[] => { try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
/** The chat a new window became, or null while the prompt is still being sent. A send that failed is never repeated: it may have gone through. */
export function boundChat(list: Row[]) {
  const bad = list.findLast(r => r.type === "receipt" && (r.status === "uncertain" || r.status === "rejected"));
  if (bad) throw new Error(`prompt not confirmed: ${bad.error ?? bad.status}`);
  return list.findLast(r => r.type === "receipt" && r.status === "accepted" && r.conversation)?.conversation ?? null;
}
export const lastReply = (list: Row[]) => list.findLast(r => r.type === "message" && r.role === "assistant")?.text ?? null;

export async function askChat(prompt: string, timeoutMs = 120_000) {
  const file = (await bridge("new")).split("\n").pop()!, id = file.replace(/^.*[\\/]/, "").replace(/\.jsonl$/, ""), askFile = resolve(import.meta.dir, "..", ".range-bots", "chat", `${id}.txt`), end = Date.now() + timeoutMs;
  try {
    await Bun.sleep(WINDOW_LOADS_MS);
    mkdirSync(dirname(askFile), { recursive: true }); writeFileSync(askFile, prompt);
    await bridge("send", id, askFile);
    while (Date.now() < end) {
      const chat = boundChat(rows(file)), reply = chat ? lastReply(rows(resolve(files, `${chat}.jsonl`))) : null;
      if (reply) return reply;
      await Bun.sleep(POLL_MS);
    }
    throw new Error("no reply in time");
  } finally {
    rmSync(askFile, { force: true });
    await bridge("close", id).catch(() => {});
  }
}
/** The same shape as jsx-ai's streamLLM: the whole reply arrives as one chunk. */
export async function* chatStream(messages: { role: string; content: string }[], o: { timeoutMs: number }) {
  yield await askChat(messages.map(m => m.content).join("\n\n"), Math.max(o.timeoutMs, 120_000));
}
