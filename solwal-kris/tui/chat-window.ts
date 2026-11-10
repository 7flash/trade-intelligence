import { askCodex } from "./codex-ask.ts";
/** One question to ChatGPT in its own small window, through the conversation files of chatgpt-bridge. The window is closed
 * after the reply. A browser window cannot read this machine's files, unlike the Codex runtime. */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const BRIDGE = process.env.CHATGPT_BRIDGE ?? "C:/Code/chatgpt-bridge", POLL_MS = 1_000, MAX_IMAGE_BYTES = 4 * 1024 * 1024;
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

/** The chat a prompt landed in, for closing its window when the send was never confirmed. Long messages show only their start. */
/** Only the first 1,500 letters count: ChatGPT's page drops some text when it shows a message ("@solana/" vanished, 9 Nov). */
export function chatOfPrompt(prompt: string, list: { name: string; rows: Row[] }[]) {
  const flat = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, ""), sent = flat(prompt), shown = (r: Row) => flat((r.text ?? "").replace(/\s*\u2026\n[^\n]*$/, ""));
  return list.find(c => c.rows.some(r => r.type === "message" && r.role === "user" && shown(r).slice(0, 1_500).length >= 200 && sent.startsWith(shown(r).slice(0, 1_500)) && sent.includes(shown(r).slice(-300))))?.name ?? null;
}
const recentChats = () => readdirSync(files).filter(f => /^[0-9a-f]{8}-.*\.jsonl$/.test(f)).map(f => ({ f, at: statSync(resolve(files, f)).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, 30)
  .map(({ f }) => ({ name: f.replace(/\.jsonl$/, ""), rows: rows(resolve(files, f)) }));

/** ChatGPT folds a long message, so the bridge may fail to recognise a prompt that did go through: the chat it landed in still has the reply. */
function chatNow(file: string, prompt: string) {
  try { return boundChat(rows(file)); } catch (e) { if (!/Send was clicked|Timed out|uncertain|not confirmed/i.test(String(e))) throw e; return chatOfPrompt(prompt, recentChats()); }
}
/** One retry, in a fresh window, when the prompt never landed (owner, 8 Nov: "in case if send fails just try again"). */
export async function askChat(prompt: string, timeoutMs = 120_000, image?: string) {
  // Codex first when it is available (tui/codex-ask.ts, owner 10 Nov); the ChatGPT window otherwise.
  const viaCodex = await askCodex(prompt, Math.max(timeoutMs, 120_000), image);
  if (viaCodex?.trim()) return viaCodex;
  // Every request starts with its own id (10 Nov): agent prompts share long templated starts and ends, so a recovered
  // "uncertain" send matched an older chat and took its reply. With a unique first line no two requests can match.
  prompt = `Request ${crypto.randomUUID().slice(0, 8)}.

${prompt}`;
  try { return await askChatOnce(prompt, timeoutMs, image); }
  catch (e) {
    if (!/composer not found|prompt not confirmed/i.test(String(e))) throw e;
    await Bun.sleep(15_000);
    return askChatOnce(prompt, timeoutMs, image);
  }
}
/** A minimized pop-up window stopped rendering ChatGPT's composer after a Chrome restart (9 Nov: "composer not found"
 * on every send, while a normal tab worked). Tabs by default; CHATGPT_HIDDEN=1 brings the pop-up windows back. */
const newArgs = () => process.env.CHATGPT_HIDDEN === "0" ? ["new"] : ["new", "--hidden"];
async function askChatOnce(prompt: string, timeoutMs = 120_000, image?: string) {
  const file = (await bridge(...newArgs())).split("\n").pop()!, id = file.replace(/^.*[\\/]/, "").replace(/\.jsonl$/, ""), askFile = resolve(import.meta.dir, "..", ".range-bots", "chat", `${id}.txt`), end = Date.now() + timeoutMs;
  let chat: string | null = null;
  try {
    mkdirSync(dirname(askFile), { recursive: true }); writeFileSync(askFile, prompt);
    const fits = !!image && statSync(image).size <= MAX_IMAGE_BYTES;
    await bridge("send", id, askFile, ...(fits ? [image!] : []));
    while (Date.now() < end) {
      const reply = (chat ??= chatNow(file, prompt)) ? lastReply(rows(resolve(files, `${chat}.jsonl`))) : null;
      if (reply) return reply;
      await Bun.sleep(POLL_MS);
    }
    throw new Error("no reply in time");
  } finally {
    rmSync(askFile, { force: true });
    await bridge("close", chat ?? id).catch(async () => { const found = chatOfPrompt(prompt, recentChats()); if (found) await bridge("close", found).catch(() => {}); });
    // Also by the request's own reference: a close by chat id can miss the tab, and every open tab costs memory
    // (10 Nov: 538 finished chat tabs piled up to 8.6 GB).
    if (chat) await bridge("close", id).catch(() => {});
  }
}
/** A hidden window can lack its file picker; the thought still matters more than the picture. */
async function askWithPicture(prompt: string, timeoutMs: number, image?: string) {
  try { return await askChat(prompt, timeoutMs, image); }
  catch (e) { if (image && /file picker/i.test(String(e))) return askChat(prompt.replace(/\n\nThe attached picture is this coin's own website\.$/, ""), timeoutMs); throw e; }
}
/** The same shape as jsx-ai's streamLLM: the whole reply arrives as one chunk. */
export async function* chatStream(messages: { role: string; content: string }[], o: { timeoutMs: number; image?: string }) {
  const said = messages.map(m => m.content).join("\n\n");
  // A background tab does not finish an upload and it blocks every thought behind it, so the picture stays out until that works.
  const attach = process.env.CHAT_PICTURES === "1";
  yield await askWithPicture(attach && o.image ? `${said}\n\nThe attached picture is this coin's own website.` : said, Math.max(o.timeoutMs, 120_000), attach ? o.image : undefined);
}
