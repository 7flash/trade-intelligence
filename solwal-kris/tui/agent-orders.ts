/** Who sends a range bot's trades. The file .range-bots/execution holds "agent <address>", the wallet signed into the
 * agent's browser: bots on that wallet go through him, who presses the site's buttons. "cli <address>" or no file leaves
 * every trade with the solard CLI path, and a bot on any other wallet always stays there. Read before each trade. */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type OrderState = "open" | "pressing" | "pressed" | "failed" | "cancelled";
export type AgentOrder = { id: string; wallet: string; mint: string; side: "buy" | "sell"; amountUsd: number; at: number; state: OrderState; note?: string; dry?: boolean };
export type OrderDesk = { keyless?: boolean; on(): boolean; place(o: Pick<AgentOrder, "wallet" | "mint" | "side" | "amountUsd">): string; read(id: string): AgentOrder | null; close(id: string): void; cancel(id: string): void };
/** From the bot's trigger to the fill showing on chain. After this a sell goes back to the CLI path. */
export const ORDER_MS = 45_000;
const dirOf = (root: string) => join(root, ".range-bots", "agent-orders");
const fileOf = (root: string, id: string) => join(dirOf(root), `${id}.json`);

/** The wallet name for the browser's wallet, which solard holds no key for. */
export const AGENT_WALLET = "agent";
export function execution(root: string) {
  try { const [mode, address] = readFileSync(join(root, ".range-bots", "execution"), "utf8").trim().split(/\s+/); return { on: mode === "agent" && !!address, address: address ?? null }; }
  catch { return { on: false, address: null }; }
}
export function readOrder(root: string, id: string): AgentOrder | null { try { return JSON.parse(readFileSync(fileOf(root, id), "utf8")); } catch { return null; } }
export function writeOrder(root: string, o: AgentOrder) {
  mkdirSync(dirOf(root), { recursive: true });
  const tmp = `${fileOf(root, o.id)}.tmp`; writeFileSync(tmp, JSON.stringify(o)); renameSync(tmp, fileOf(root, o.id));
}
/** The oldest order still waiting. An old one is never pressed: its price and its bot have moved on. */
export function nextOrder(root: string, now = Date.now()): AgentOrder | null {
  let names: string[] = []; try { names = readdirSync(dirOf(root)); } catch { return null; }
  const open = names.filter(n => n.endsWith(".json")).map(n => readOrder(root, n.slice(0, -5))).filter((o): o is AgentOrder => o?.state === "open" && now - o.at < ORDER_MS - 10_000);
  return open.sort((a, b) => a.at - b.at)[0] ?? null;
}
export function orderDesk(root: string, address: string, keyless = false): OrderDesk {
  return {
    keyless,
    on: () => { const e = execution(root); return e.on && e.address === address; },
    place: o => { const id = randomUUID(); writeOrder(root, { ...o, id, at: Date.now(), state: "open" }); return id; },
    read: id => readOrder(root, id),
    close: id => rmSync(fileOf(root, id), { force: true }),
    cancel: id => { const o = readOrder(root, id); if (o && o.state === "open") writeOrder(root, { ...o, state: "cancelled" }); },
  };
}

/** A public callout waiting for the browser: one per position, written once and then gone. */
export type CalloutJob = { mint: string; text: string; dry?: boolean; tries?: number };
const calloutDir = (root: string) => join(root, ".range-bots", "agent-callouts");
export function writeCallout(root: string, job: CalloutJob) { mkdirSync(calloutDir(root), { recursive: true }); const p = join(calloutDir(root), `${job.mint}.json`); writeFileSync(`${p}.tmp`, JSON.stringify(job)); renameSync(`${p}.tmp`, p); }
export function nextCallout(root: string): CalloutJob | null {
  let names: string[] = []; try { names = readdirSync(calloutDir(root)).filter(n => n.endsWith(".json")); } catch { return null; }
  const name = names[0]; if (!name) return null;
  const p = join(calloutDir(root), name); try { const job = JSON.parse(readFileSync(p, "utf8")) as CalloutJob; rmSync(p, { force: true }); return job; } catch { rmSync(p, { force: true }); return null; }
}

export type OrderResult = { result: "filled" | "not-pressed" | "no-fill"; note: string };
/** Places the order and watches the chain, which alone says whether it filled. */
export async function runOrder(desk: OrderDesk, order: Parameters<OrderDesk["place"]>[0], chain: { before: bigint; tokens: () => Promise<bigint> },
  wait: { ms?: number; every?: number; now?: () => number; sleep?: (ms: number) => Promise<unknown> } = {}): Promise<OrderResult> {
  const now = wait.now ?? Date.now, sleep = wait.sleep ?? Bun.sleep, end = now() + (wait.ms ?? ORDER_MS), every = wait.every ?? 3_000;
  const id = desk.place(order), filled = (raw: bigint) => order.side === "buy" ? raw > chain.before : raw < chain.before;
  try {
    while (now() < end) {
      await sleep(every);
      const o = desk.read(id);
      if (!o || o.state === "failed" || o.state === "cancelled") return { result: "not-pressed", note: o?.note ?? "order gone" };
      if (o.state === "pressed" && filled(await chain.tokens())) return { result: "filled", note: "" };
    }
    desk.cancel(id);
    return desk.read(id)?.state === "pressed" ? { result: "no-fill", note: "pressed, nothing on chain" } : { result: "not-pressed", note: "not pressed in time" };
  } finally { desk.close(id); }
}
