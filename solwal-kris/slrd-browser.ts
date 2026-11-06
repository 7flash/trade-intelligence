/** A real browser window on pump.fun, shown on Kris's monitor. It looks around: Trending, Hot callouts and his own
 * positions, and jumps to a coin when it trades. It holds no wallet, never signs in and clicks only coin and home links.
 * Trades still go through the terminal. The Cloudflare check is left for a person to click. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KRIS_WALLET } from "./tui/kris-public.ts";
import { pickCoin, remember, safeFacts, safeName, TOUR, trendingRow, type TourStop } from "./tui/pump-tour.ts";

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

// A private window with no extensions and no sync, so nothing of the owner's can load into it.
Bun.spawn([EDGE, `--remote-debugging-port=${PORT}`, `--user-data-dir=${resolve(dot, "browser-clean")}`, "--inprivate", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--window-size=1320,860", "about:blank"], { stdout: "ignore", stderr: "ignore" });
let page: { webSocketDebuggerUrl: string } | null = null;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  // Our own tab, never one that was already open.
  page = await fetch(`http://127.0.0.1:${PORT}/json/new?${HOME}`, { method: "PUT" }).then(r => r.ok ? r.json() as Promise<{ webSocketDebuggerUrl: string }> : null).catch(() => null);
}
if (!page) throw new Error("browser did not open");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0;
const waits = new Map<number, (v: any) => void>();
ws.onmessage = e => { const m = JSON.parse(String(e.data)); waits.get(m.id)?.(m.result); waits.delete(m.id); };
const cdp = (method: string, params: Record<string, unknown> = {}) => new Promise<any>(r => { waits.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await cdp("Page.enable");
log("browser open on pump.fun");

let here = HOME, wasBlocked = false, lastTrade = 0, step = 0, recent: string[] = [];
const STOP_MS = 22_000, PORTFOLIO = `https://pump.fun/profile/${KRIS_WALLET}`;
const value = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;
const go = async (url: string) => { await cdp("Page.navigate", { url }); log(`looking at ${url}`); };
/** Clicks a link already on the page, as a person would, so the site does not reload. */
const click = (href: string) => value(`(() => { const a = [...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)}); if (!a) return false; a.scrollIntoView({ block: "center" }); a.click(); return true; })()`);
const scroll = () => cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 760, y: 430, deltaX: 0, deltaY: 500 });
async function latestTrade() {
  const ov: any = await fetch(`${view}/api/overview`, { headers: { cookie: `slrd_web=${bridgeToken}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json()).catch(() => null);
  const pump = (ov?.bots ?? []).filter((b: any) => !b.inactive && b.lastTradeAtMs).sort((a: any, b: any) => b.lastTradeAtMs - a.lastTradeAtMs)[0];
  return pump ? { mint: pump.mint as string, at: pump.lastTradeAtMs as number } : null;
}
lastTrade = (await latestTrade())?.at ?? 0;
async function visit() {
  const stop = TOUR[step++ % TOUR.length]!;
  if (stop === "portfolio") return go(PORTFOLIO);
  if (stop === "home") { if (!(await click("/"))) await go(HOME); return log("looking at the front page"); }
  const hrefs = JSON.parse(await value(`JSON.stringify([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))`) ?? "[]") as string[];
  const href = pickCoin(stop, hrefs, recent);
  if (!href) return visit();
  recent = remember(recent, href);
  posted = stop === "callout" ? await value(`(() => { let e = [...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === ${JSON.stringify(href)}); while (e && e.innerText.length < 80) e = e.parentElement; return e ? e.innerText : ""; })()`) ?? "" : "";
  if (await click(href)) log(`${stop}: ${href}`);
}
/** What this stop shows, for Kris to think about: see safeFacts for why it is only numbers and names. */
let posted = "";
async function read(stop: TourStop) {
  const seen = JSON.parse(await value(`JSON.stringify({ title: document.title, path: location.pathname, text: document.body.innerText, coins: [...document.querySelectorAll('a[href^="/coin/"]')].filter(a => !a.getAttribute("href").includes("highlight_callout")).slice(0, 6).map(a => a.innerText) })`) ?? "null") as { title: string; path: string; text: string; coins: string[] } | null;
  if (!seen || blocked(seen.title)) return;
  const coin = /^\/coin\//.test(seen.path), at = seen.text.indexOf("Market cap");
  writeFileSync(resolve(dot, "kris-browsing.json"), JSON.stringify({ at: Date.now(), stop, mint: coin ? seen.path.slice(6) : "",
    coin: coin ? safeName(seen.title.split(/ \$| \|/)[0] ?? "") : "",
    facts: coin ? safeFacts(at < 0 ? "" : seen.text.slice(at, at + 1_500)) : stop === "home" ? seen.coins.map(trendingRow) : [],
    callout: stop === "callout" ? safeFacts(posted, 10) : [] }));
}
setInterval(async () => {
  if (wasBlocked) return;
  const trade = await latestTrade();
  if (trade && trade.at > lastTrade) { lastTrade = trade.at; recent = remember(recent, `/coin/${trade.mint}`); return go(coinPage(trade.mint)); }
  const stop = TOUR[step % TOUR.length]!;
  await visit();
  setTimeout(() => { if (!wasBlocked) void read(stop).catch(e => log(`read: ${String(e).slice(0, 80)}`)); }, STOP_MS * 0.4);
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
      const r = await fetch(target, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg", "x-screen-url": here }, body: Buffer.from(shot.data, "base64"), signal: AbortSignal.timeout(8_000) }).catch(e => { log(`push: ${String(e).slice(0, 80)}`); return null; });
      if (r && !r.ok) log(`push: ${r.status}`);
    }
  }
  await sleep(1_500);
}
