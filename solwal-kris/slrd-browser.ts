/** A real browser window on pump.fun, shown on Kris's monitor. It looks around: Trending, Hot callouts and his own
 * positions, and jumps to a coin when it trades. It clicks only coin and home links, and in agent mode the
 * trade box of the coin an order names (tui/agent-orders.ts). Signing in and the Cloudflare check are left for a person. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KRIS_WALLET } from "./tui/kris-public.ts";
import { pickCoin, refuseMain, remember, safeFacts, safeName, TOUR, afterPressScript, tradeBoxScript, trendingRow, type TourStop, type TradeBox } from "./tui/pump-tour.ts";
import { execution, nextOrder, readOrder, writeOrder, type AgentOrder } from "./tui/agent-orders.ts";

const dot = resolve(import.meta.dir, ".range-bots"), token = readFileSync(resolve(dot, "public-token"), "utf8").trim();
const bridgeToken = readFileSync(resolve(dot, "bridge-token"), "utf8").trim();
const target = process.env.SLRD_SCREEN_URL ?? "https://solard.xyz/live/api/screen", view = "http://127.0.0.1:5176";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", PORT = 9361, HOME = "https://pump.fun/";
/** SLRD_SCREEN_DRY=1 writes frames to .range-bots/screen.jpg and sends nothing, to check them first. */
const dry = process.env.SLRD_SCREEN_DRY === "1";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

/** Only pump.fun, and only a coin page or the front page. */
export const coinPage = (mint: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? `https://pump.fun/coin/${mint}` : HOME;
export const onPump = (url: string) => { try { return new URL(url).hostname === "pump.fun"; } catch { return false; } };
export const blocked = (title: string) => /just a moment|security verification|attention required/i.test(title);

// Its own profile with no extensions and no sync, so nothing of the owner's can load into it.
const openEdge = () => Bun.spawn([EDGE, `--remote-debugging-port=${PORT}`, `--user-data-dir=${resolve(dot, "browser-clean")}`, "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--window-size=1320,860", "about:blank"], { stdout: "ignore", stderr: "ignore" });
openEdge();
let page: { webSocketDebuggerUrl: string } | null = null;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  if (i === 30) openEdge(); // a restart can catch the last window still closing
  // Our own tab, never one that was already open.
  page = await fetch(`http://127.0.0.1:${PORT}/json/new?${HOME}`, { method: "PUT" }).then(r => r.ok ? r.json() as Promise<{ webSocketDebuggerUrl: string }> : null).catch(() => null);
}
if (!page) throw new Error("browser did not open");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0;
const waits = new Map<number, (v: any) => void>();
ws.onmessage = e => { const m = JSON.parse(String(e.data)); waits.get(m.id)?.(m.result); waits.delete(m.id); };
// A page load can swallow the reply to a call in flight, and one lost reply must not stop the stream.
const cdp = (method: string, params: Record<string, unknown> = {}) => new Promise<any>(r => {
  const n = ++id, timer = setTimeout(() => { waits.delete(n); r(undefined); }, 6_000);
  waits.set(n, v => { clearTimeout(timer); r(v); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
await cdp("Page.enable");
log("browser open on pump.fun");


const root = import.meta.dir; let ordering = false, readAt = 0;
let here = HOME, wasBlocked = false, lastTrade = 0, step = 0, recent: string[] = [];
const STOP_MS = 26_000, portfolio = () => `https://pump.fun/profile/${execution(root).address ?? KRIS_WALLET}`;
const value = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;
const go = async (url: string) => { await cdp("Page.navigate", { url }); log(`looking at ${url}`); };
/** Clicks a link already on the page, as a person would, so the site does not reload. */
const click = (href: string) => value(`(() => { const a = [...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)}); if (!a) return false; a.scrollIntoView({ block: "center" }); a.click(); return true; })()`);
/** Where Kris's cursor is, as a share of the window. It goes out with each frame and the site draws it. */
const pointer = { x: 0.5, y: 0.5, down: 0 };
async function pointAt(find: string) {
  const box = JSON.parse(await value(`(() => { const e = ${find}; if (!e) return "null"; const r = e.getBoundingClientRect(); return JSON.stringify({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight }); })()`) ?? "null") as { x: number; y: number } | null;
  if (!box) return false;
  pointer.x = box.x; pointer.y = box.y; await sleep(1_500);
  return true;
}
const press = async () => { pointer.down = 1; await sleep(1_050); pointer.down = 0; };
const scroll = () => cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 760, y: 430, deltaX: 0, deltaY: 500 });
async function latestTrade() {
  const ov: any = await fetch(`${view}/api/overview`, { headers: { cookie: `slrd_web=${bridgeToken}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json()).catch(() => null);
  const newest = (b: any) => Math.max(b.lastTradeAtMs ?? 0, b.addedAt ?? 0); // a new range counts too: he goes and looks
  const pump = (ov?.bots ?? []).filter((b: any) => !b.inactive && newest(b)).sort((a: any, b: any) => newest(b) - newest(a))[0];
  return pump ? { mint: pump.mint as string, at: newest(pump) as number } : null;
}
lastTrade = (await latestTrade())?.at ?? 0;
async function visit() {
  const stop = TOUR[step++ % TOUR.length]!;
  if (stop === "portfolio") return go(portfolio());
  if (stop === "home") { if (!(await click("/"))) await go(HOME); return log("looking at the front page"); }
  const hrefs = JSON.parse(await value(`JSON.stringify([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))`) ?? "[]") as string[];
  const href = pickCoin(stop, hrefs, recent);
  if (!href) return visit();
  recent = remember(recent, href);
  posted = stop === "callout" ? await value(`(() => { let e = [...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)}); while (e && e.innerText.length < 80) e = e.parentElement; return e ? e.innerText : ""; })()`) ?? "" : "";
  await value(`[...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)})?.scrollIntoView({ block: "center" })`);
  await pointAt(`[...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)})`);
  await press();
  if (await click(href)) log(`${stop}: ${href}`);
}
/** What this stop shows, for Kris to think about: see safeFacts for why it is only numbers and names. */
let posted = "";
async function read(stop: TourStop) {
  const seen = JSON.parse(await value(`JSON.stringify({ title: document.title, path: location.pathname, text: document.body.innerText, coins: [...document.querySelectorAll('a[href^="/coin/"]')].filter(a => !a.getAttribute("href").includes("highlight_callout")).slice(0, 6).map(a => { let e = a; for (let i = 0; i < 4 && e && !/\\$/.test(e.innerText); i++) e = e.parentElement; return e ? e.innerText : a.innerText; }) })`) ?? "null") as { title: string; path: string; text: string; coins: string[] } | null;
  if (!seen || blocked(seen.title)) return;
  const coin = /^\/coin\//.test(seen.path), at = seen.text.indexOf("Market cap");
  const readNow = Date.now(); readAt = coin ? readNow : 0;
  writeFileSync(resolve(dot, "kris-browsing.json"), JSON.stringify({ at: readNow, stop, mint: coin ? seen.path.slice(6) : "",
    coin: coin ? safeName(seen.title.split(/ \$| \|/)[0] ?? "") : "",
    facts: coin ? safeFacts(at < 0 ? "" : seen.text.slice(at, at + 1_500)) : stop === "home" ? seen.coins.map(trendingRow) : [],
    callout: stop === "callout" ? safeFacts(posted, 10) : [] }));
}
/** A real mouse click, with Kris's cursor on the stream going there first. */
async function realClick(at: { x: number; y: number }, box: TradeBox, travel = 1_100) {
  pointer.x = at.x / box.wide; pointer.y = at.y / box.high; await sleep(travel);
  const m = { x: at.x, y: at.y, button: "left", clickCount: 1 };
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  pointer.down = 1;
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...m, buttons: 1 }); await sleep(70);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...m, buttons: 0 }); await sleep(400);
  pointer.down = 0;
}
const readBox = async () => JSON.parse(await value(tradeBoxScript) ?? "null") as TradeBox | null;
/** Opens the coin and fills in the trade box. The main button is pressed only if every check passes. */
async function pressOrder(o: AgentOrder) {
  const fail = (note: string) => { writeOrder(root, { ...o, state: "failed", note }); log(`order ${o.side} ${o.mint.slice(0, 6)}: ${note}`); };
  writeOrder(root, { ...o, state: "pressing" });
  const url = coinPage(o.mint); if (url === HOME) return fail("bad coin");
  await go(url);
  let box: TradeBox | null = null;
  for (let i = 0; i < 24 && !box; i++) { await sleep(500); if ((await value("location.pathname")) === `/coin/${o.mint}`) box = await readBox(); }
  if (!box) return fail("no trade box");
  await value("scrollTo(0, 0)"); await sleep(300); box = await readBox() ?? box;
  const tab = box[o.side]; if (!tab) return fail(`no ${o.side} tab`);
  await realClick(tab, box); await sleep(400);
  box = await readBox(); if (!box) return fail("trade box went away");
  await realClick(box.input, box);
  await value(`document.querySelector('input[inputmode="decimal"]:focus')?.select()`);
  await cdp("Input.insertText", { text: o.amountUsd.toFixed(2) }); await sleep(600);
  await value("document.activeElement?.blur()"); await sleep(700); // leaving the field moves the box: a press taken mid-move goes nowhere
  box = await readBox(); if (!box) return fail("trade box went away");
  const first = refuseMain(box, o.side, o.amountUsd); if (first) return fail(first);
  pointer.x = box.main!.x / box.wide; pointer.y = box.main!.y / box.high; await sleep(1_100);
  // The quote adds rows and moves the button, and a press on a moved button hits the wrong one: wait for it to stay put.
  let last = -1, steady: TradeBox | null = null;
  for (let i = 0; i < 16 && !steady; i++) { const now = await readBox(); if (now?.main && now.main.y === last) steady = now; last = now?.main?.y ?? -1; if (!steady) await sleep(300); }
  if (!steady) return fail("trade button kept moving");
  const why = refuseMain(steady, o.side, o.amountUsd); if (why) return fail(why);
  if (o.dry) return fail(`dry: would press ${steady.main!.text} for $${steady.value}`);
  if (readOrder(root, o.id)?.state !== "pressing") return log("order ended before the press");
  await realClick(steady.main!, steady, 0);
  writeOrder(root, { ...o, state: "pressed" }); log(`pressed ${steady.main!.text}: ${o.side} $${o.amountUsd} of ${o.mint.slice(0, 6)}`);
  // Stays on the coin while the trade lands, and notes what the site says. This goes to the log only.
  for (const wait of [1_000, 2_000, 3_000, 6_000]) { await sleep(wait); log(`after press: ${await value(afterPressScript) ?? ""}`); }
}
setInterval(async () => {
  if (ordering || wasBlocked) return;
  const o = nextOrder(root); if (!o) return;
  ordering = true;
  await pressOrder(o).catch(e => writeOrder(root, { ...o, state: "failed", note: String(e).slice(0, 80) })).finally(() => { ordering = false; });
}, 1_000);
/** He stays on a coin until his analysis of it is written, at most 45s. */
const analysing = () => { if (!readAt || Date.now() - readAt > 45_000) return false; try { return JSON.parse(readFileSync(resolve(dot, "kris-analysed.json"), "utf8")).at !== readAt; } catch { return true; } };
setInterval(async () => {
  if (wasBlocked || ordering || analysing()) return;
  const trade = await latestTrade();
  if (trade && trade.at > lastTrade) { lastTrade = trade.at; recent = remember(recent, `/coin/${trade.mint}`); return go(coinPage(trade.mint)); }
  const stop = TOUR[step % TOUR.length]!;
  await visit();
  setTimeout(() => { if (!wasBlocked) void read(stop).catch(e => log(`read: ${String(e).slice(0, 80)}`)); }, 3_000);
  setTimeout(() => { if (!wasBlocked) void scroll(); }, STOP_MS / 2);
}, STOP_MS);

for (;;) {
  const seen = (await cdp("Runtime.evaluate", { expression: "JSON.stringify([document.title, location.href])", returnByValue: true }))?.result?.value ?? '["",""]';
  const [title, href] = JSON.parse(seen) as [string, string];
  const stop = blocked(title) || !onPump(href);
  if (stop !== wasBlocked) { wasBlocked = stop; log(stop ? "Cloudflare check showing: click it in the browser window" : "check passed, streaming"); }
  if (!stop) {
    const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 55 });
    here = href;
    if (shot?.data && dry) writeFileSync(resolve(dot, "screen.jpg"), Buffer.from(shot.data, "base64"));
    else if (shot?.data) {
      const r = await fetch(target, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg", "x-screen-url": here, "x-screen-cursor": `${pointer.x.toFixed(3)},${pointer.y.toFixed(3)},${pointer.down}` }, body: Buffer.from(shot.data, "base64"), signal: AbortSignal.timeout(8_000) }).catch(e => { log(`push: ${String(e).slice(0, 80)}`); return null; });
      if (r && !r.ok) log(`push: ${r.status}`);
    }
  }
  await sleep(1_000);
}
