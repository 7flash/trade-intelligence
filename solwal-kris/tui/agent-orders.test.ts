import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastFill } from "../webapp/public/kris-events.ts";
import { tradedFromLog } from "./fill-log.ts";
import { executionOn, nextOrder, ORDER_MS, orderDesk, readOrder, runOrder, writeOrder, type OrderDesk } from "./agent-orders.ts";

const roots: string[] = [];
const root = () => { const r = mkdtempSync(join(tmpdir(), "orders-")); mkdirSync(join(r, ".range-bots")); roots.push(r); return r; };
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const buy = { wallet: "w", mint: "m", side: "buy" as const, amountUsd: 5 };
/** A clock that moves only when the order loop sleeps. */
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

test("the CLI path is the default; only the word agent switches it", () => {
  const r = root(); expect(executionOn(r)).toBe(false);
  writeFileSync(join(r, ".range-bots", "execution"), "agent\n"); expect(executionOn(r)).toBe(true);
  writeFileSync(join(r, ".range-bots", "execution"), "cli"); expect(executionOn(r)).toBe(false);
});
test("filled only once the press shows on chain, for each side", async () => {
  const desk = orderDesk(root());
  const pressed: OrderDesk = { ...desk, read: id => { const o = desk.read(id); return o ? { ...o, state: "pressed" } : o; } };
  expect((await runOrder(pressed, buy, { before: 100n, tokens: async () => 150n }, clock())).result).toBe("filled");
  expect((await runOrder(pressed, { ...buy, side: "sell" }, { before: 100n, tokens: async () => 40n }, clock())).result).toBe("filled");
});
test("a balance moving the wrong way is not a fill", async () => {
  const pressed: OrderDesk = { ...orderDesk(root()), read: id => ({ ...buy, id, at: 0, side: "sell", state: "pressed" }) };
  expect((await runOrder(pressed, { ...buy, side: "sell" }, { before: 100n, tokens: async () => 120n }, clock())).result).toBe("no-fill");
});
test("a pressed order with nothing on chain is reported, never called filled", async () => {
  const pressed: OrderDesk = { ...orderDesk(root()), read: id => ({ ...buy, id, at: 0, state: "pressed" }) };
  expect(await runOrder(pressed, buy, { before: 100n, tokens: async () => 100n }, clock())).toEqual({ result: "no-fill", note: "pressed, nothing on chain" });
});
test("an order nobody picked up is cancelled, so a late browser cannot press it", async () => {
  const r = root(), desk = orderDesk(r); let seen = "";
  const watch: OrderDesk = { ...desk, cancel: id => { desk.cancel(id); seen = readOrder(r, id)?.state ?? ""; } };
  expect((await runOrder(watch, buy, { before: 0n, tokens: async () => 0n }, clock())).result).toBe("not-pressed");
  expect(seen).toBe("cancelled");
});
test("a failed press ends at once and says why", async () => {
  const failed: OrderDesk = { ...orderDesk(root()), read: id => ({ ...buy, id, at: 0, state: "failed", note: "not signed in" }) };
  expect(await runOrder(failed, buy, { before: 0n, tokens: async () => 0n }, clock())).toEqual({ result: "not-pressed", note: "not signed in" });
});
test("no order file is left behind", async () => {
  const r = root(); await runOrder(orderDesk(r), buy, { before: 0n, tokens: async () => 0n }, clock());
  expect(readdirSync(join(r, ".range-bots", "agent-orders"))).toEqual([]);
});
test("the browser takes the oldest open order and never a stale one", () => {
  const r = root(), base = { ...buy, state: "open" as const };
  writeOrder(r, { ...base, id: "new", at: 5_000 }); writeOrder(r, { ...base, id: "old", at: 1_000 }); writeOrder(r, { ...base, id: "gone", at: 0, state: "cancelled" });
  expect(nextOrder(r, 6_000)?.id).toBe("old");
  expect(nextOrder(r, 5_000 + ORDER_MS)).toBeNull();
});
test("an agent fill reads as a normal fill, so thoughts and volume count it", () => {
  const line = "2026-11-06T12:00:00.000Z annotation target w m: BUY confirmed CONFIRMED -0.0110 SOL  ";
  expect(lastFill(line)?.side).toBe("BUY");
  expect(tradedFromLog(line).trades).toBe(1);
});
