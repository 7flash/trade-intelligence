/** Records every pump.fun callout as it appears (bgrun slrd-callouts). Trades nothing.
 *
 * pump.fun drops a callout once its caller sells the whole position, so a coin's Callouts tab (and the mint-positions API)
 * only ever shows callers still holding. To study every caller, including the ones who sold, we keep our own copy:
 * pump.fun's site-wide feed of new callouts (frontend-api-v3 /home-feed/new, newest first, 25 per page) is read every
 * minute until it reaches callouts already saved. On start it also pages back as far as the feed goes (about 4 hours).
 *
 * The API sits behind Cloudflare and needs the logged-in browser session, so requests run inside our own tab of the
 * slrd-browser Edge window (DevTools port SLRD_BROWSER_PORT, default 9361); Kris's tab is never navigated or touched.
 * Output: .range-bots/callout-feed.jsonl, one line per callout: { seenAt, coinMint, symbol, coinName, marketCap, position }.
 */
import { appendFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";

const PORT = Number(process.env.SLRD_BROWSER_PORT ?? 9361);
const OUT = resolve(import.meta.dir, "..", ".range-bots", "callout-feed.jsonl");
const FEED = "https://frontend-api-v3.pump.fun/home-feed/new?pageSize=25&chain=all&minCostBasisUsd=1&minCalloutMarketCapUsd=1";
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

const keyOf = (c: any) => c?.position?.callout?.calloutId ?? `${c?.coinMint}|${c?.position?.walletAddress}|${c?.position?.callout?.calloutTimestamp}`;
const seen = new Set<string>();
if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) { if (!l) continue; try { seen.add(keyOf(JSON.parse(l))); } catch {} }
log(`${seen.size} callouts already saved`);

let ws: WebSocket | null = null, tabId: string | null = null, id = 0;
const wait = new Map<number, (v: any) => void>();
async function connect() {
  if (tabId) await fetch(`http://127.0.0.1:${PORT}/json/close/${tabId}`).catch(() => {}); // never leave old tabs behind
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?https://pump.fun/robots.txt`, { method: "PUT" })).json() as { id: string; webSocketDebuggerUrl: string };
  tabId = t.id; ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws!.addEventListener("open", r, { once: true }); ws!.addEventListener("error", j, { once: true }); });
  ws.addEventListener("message", e => { const m = JSON.parse(String(e.data)); wait.get(m.id)?.(m); wait.delete(m.id); });
  ws.addEventListener("close", () => { ws = null; });
  await Bun.sleep(3000);
  log(`own tab ${tabId} open`);
}
const evaluate = (expression: string) => new Promise<any>(r => {
  if (!ws) return r(undefined);
  const i = ++id, to = setTimeout(() => { wait.delete(i); r(undefined); }, 30_000);
  wait.set(i, m => { clearTimeout(to); r(m.result?.result?.value); });
  ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});
async function page(token: string | null): Promise<{ coins: any[]; next: string | null } | null> {
  const url = FEED + (token ? `&pageToken=${encodeURIComponent(token)}` : "");
  const r = await evaluate(`fetch(${JSON.stringify(url)}, { credentials: "include" }).then(async r => ({ s: r.status, j: r.ok ? await r.json() : null })).catch(() => ({ s: 0 }))`);
  if (r?.s !== 200 || !r.j) return null;
  return { coins: r.j.coins ?? [], next: r.j.nextPageToken ?? null };
}

/** Reads pages until a page holds only saved callouts (or maxPages). Returns how many were new. */
async function sweep(maxPages: number) {
  let token: string | null = null, added = 0;
  for (let p = 0; p < maxPages; p++) {
    const r = await page(token);
    if (!r) { log(`feed page ${p} failed`); break; }
    const now = Date.now(); let fresh = 0;
    for (const c of r.coins) {
      const k = keyOf(c); if (seen.has(k)) continue; seen.add(k); fresh++;
      appendFileSync(OUT, JSON.stringify({ seenAt: now, coinMint: c.coinMint, symbol: c.symbol, coinName: c.coinName, marketCap: c.marketCap, program: c.program, position: { ...c.position, profileImage: undefined } }) + "\n");
    }
    added += fresh;
    if (!r.next || !r.coins.length || (fresh === 0 && maxPages < 1000)) break;
    token = r.next; await Bun.sleep(800);
  }
  return added;
}

let backfilled = false;
while (true) {
  try {
    if (!ws) await connect();
    const n = await sweep(backfilled ? 40 : 1000);
    if (!backfilled) { backfilled = true; log(`backfill: ${n} callouts`); } else if (n) log(`+${n} callouts`);
  } catch (e) { log(`error ${String(e).slice(0, 160)}`); try { (ws as WebSocket | null)?.close(); } catch {} ws = null; }
  await Bun.sleep(60_000);
}
