/** A real browser window on pump.fun, shown on Kris's monitor. It looks around: Trending, Hot callouts and his own
 * positions, and jumps to a coin when it trades. It clicks only coin and home links, and in agent mode the
 * trade box of the coin an order names (tui/agent-orders.ts). Signing in and the Cloudflare check are left for a person. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KRIS_WALLET } from "./tui/kris-public.ts";
import { pickCoin, pickScreener, refuseMain, remember, safeFacts, safeName, TOUR, afterPressScript, buttonScript, calloutFormScript, calloutsScript, holdersScript, tradeBoxScript, trendingRow, type TourStop, type TradeBox } from "./tui/pump-tour.ts";
import { execution, nextCallout, nextOrder, readOrder, writeCallout, writeOrder, type AgentOrder, type CalloutJob } from "./tui/agent-orders.ts";
import { calloutSignals, splitCallouts, topHoldersPct, type Callout } from "./tui/agent-trader.ts";
import { safeQuotes } from "./tui/callout-words.ts";

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
  // Only a new range sends him to a coin: trades run in the background and the stream stays on discovery.
  const pump = (ov?.bots ?? []).filter((b: any) => !b.inactive && b.addedAt).sort((a: any, b: any) => b.addedAt - a.addedAt)[0];
  return pump ? { mint: pump.mint as string, at: pump.addedAt as number } : null;
}
lastTrade = (await latestTrade())?.at ?? 0;
const seenPath = resolve(dot, "kris-seen.json");
try { recent = JSON.parse(readFileSync(seenPath, "utf8")); } catch {}
const noted = (href: string) => { recent = remember(recent, href); try { writeFileSync(seenPath, JSON.stringify(recent)); } catch {} };
async function visit(tries = 0): Promise<void> {
  if (tries > 3) return go(HOME);
  const stop = TOUR[step++ % TOUR.length]!;
  if (stop === "portfolio") return go(portfolio());
  const ov: any = await fetch(`${view}/api/overview`, { headers: { cookie: `slrd_web=${bridgeToken}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json()).catch(() => null);
  const skip = [...recent, ...(ov?.bots ?? []).map((b: any) => b.mint as string)]; // what he holds is not news
  if (stop === "screener") {
    const mint = pickScreener([...(ov?.young ?? []), ...(ov?.coins ?? [])], skip);
    if (!mint) return visit(tries + 1);
    noted(`/coin/${mint}`); await go(coinPage(mint)); return log(`screener: ${mint}`);
  }
  if (stop === "hot" && new URL(here).pathname !== "/") { if (!(await click("/"))) await go(HOME); await sleep(2_500); } // Trending is on the front page
  const hrefs = JSON.parse(await value(`JSON.stringify([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))`) ?? "[]") as string[];
  const href = pickCoin(stop, hrefs, skip);
  if (!href) return visit(tries + 1);
  noted(href);
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
  let holders: number | null = null; // the site stays on the last tab used, so he opens Holders himself
  if (coin) { await tap("/^Holders/").catch(() => false); for (let i = 0; i < 6 && holders == null; i++) { await sleep(500); holders = topHoldersPct(await value(holdersScript) ?? ""); } }
  const callouts = coin ? await readCallouts().catch(() => null) : null;
  writeFileSync(resolve(dot, "kris-browsing.json"), JSON.stringify({ at: readNow, stop, mint: coin ? seen.path.slice(6) : "",
    coin: coin ? safeName(seen.title.split(/ \$| \|/)[0] ?? "") : "",
    facts: coin ? safeFacts(at < 0 ? "" : seen.text.slice(at, at + 1_500)) : stop === "home" ? seen.coins.map(trendingRow) : [],
    callout: stop === "callout" ? safeFacts(posted, 10) : [], callouts, top10HeldPct: holders }));
}
/** A real mouse click, with Kris's cursor on the stream going there first. */
async function realClick(at: { x: number; y: number }, box: Pick<TradeBox, "wide" | "high">, travel = 1_100) {
  pointer.x = at.x / box.wide; pointer.y = at.y / box.high; await sleep(travel);
  const m = { x: at.x, y: at.y, button: "left", clickCount: 1 };
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  pointer.down = 1;
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...m, buttons: 1 }); await sleep(70);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...m, buttons: 0 }); await sleep(400);
  pointer.down = 0;
}
/** Presses a button only once it has stopped moving and is really what is under the cursor. The page shifts as it loads. */
async function tap(pattern: string) {
  const first = JSON.parse(await value(buttonScript(pattern)) ?? "null"); if (!first) return false;
  pointer.x = first.x / first.wide; pointer.y = first.y / first.high; await sleep(1_100);
  let last = -1, steady: { x: number; y: number; wide: number; high: number; hit: boolean } | null = null;
  for (let i = 0; i < 16 && !steady; i++) { const now = JSON.parse(await value(buttonScript(pattern)) ?? "null"); if (now?.hit && now.y === last) steady = now; last = now?.y ?? -1; if (!steady) await sleep(300); }
  if (!steady) return false;
  await realClick(steady, steady, 0); return true;
}
/** He opens the coin's Callouts tab in front of viewers and reads every post. Only counts leave here. */
async function readCallouts() {
  if (!(await tap("/^Callouts/"))) return null;
  let posts: Callout[] = [];
  for (let i = 0; i < 8 && !posts.length; i++) { await sleep(700); posts = splitCallouts(await value(calloutsScript) ?? ""); } // they load after the tab opens
  log(`read ${posts.length} callouts`);
  return posts.length ? { ...calloutSignals(posts)!, whatCallersSay: safeQuotes(posts) } : null;
}
/** One public post, in the site's own box, from the words Kris already wrote. A dry job stops before the post. */
async function postCallout(job: CalloutJob) {
  const url = coinPage(job.mint); if (url === HOME) return;
  await go(url);
  for (let i = 0; i < 24; i++) { await sleep(500); if ((await value("location.pathname")) === `/coin/${job.mint}` && await readBox()) break; }
  let open = false;
  for (let i = 0; i < 12 && !open; i++) { await sleep(700); open = await tap("/^Add your callout/"); } // the holder's card loads after the trade box
  if (!open) { // right after a buy the page may not know he holds it yet
    if ((job.tries ?? 0) < 3) setTimeout(() => writeCallout(root, { ...job, tries: (job.tries ?? 0) + 1 }), 30_000);
    return log(`callout ${job.mint.slice(0, 6)}: no button, try ${(job.tries ?? 0) + 1}`);
  }
  let form: any = null;
  for (let i = 0; i < 12 && !form?.input; i++) { await sleep(500); form = JSON.parse(await value(calloutFormScript) ?? "null"); } // the box takes a moment to open
  log(`callout form: ${JSON.stringify(form).slice(0, 300)}`);
  if (!form?.input) { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); return log(`callout ${job.mint.slice(0, 6)}: no box`); }
  await realClick(form.input, form);
  await cdp("Input.insertText", { text: job.text }); await sleep(700);
  form = JSON.parse(await value(calloutFormScript) ?? "null");
  log(`callout filled: ${JSON.stringify(form).slice(0, 300)}`);
  if (job.dry || !form?.send || form.send.off || form.written < 5) { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); return log(`callout ${job.mint.slice(0, 6)}: ${job.dry ? "dry, not posted" : "no send button"}`); }
  await realClick(form.send, form);
  log(`callout posted on ${job.mint.slice(0, 6)}`); await sleep(3_000);
  log(`after callout: ${await value(afterPressScript) ?? ""}`);
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
  const o = nextOrder(root);
  if (o) {
    ordering = true;
    await pressOrder(o).catch(e => writeOrder(root, { ...o, state: "failed", note: String(e).slice(0, 80) })).finally(() => { ordering = false; });
    return;
  }
  const job = nextCallout(root); if (!job) return;
  ordering = true;
  await postCallout(job).catch(e => log(`callout: ${String(e).slice(0, 80)}`)).finally(() => { ordering = false; });
}, 1_000);
/** He stays on a coin until his analysis of it is written, at most 45s. */
const analysing = () => { if (!readAt || Date.now() - readAt > 45_000) return false; try { return JSON.parse(readFileSync(resolve(dot, "kris-analysed.json"), "utf8")).at !== readAt; } catch { return true; } };
setInterval(async () => {
  if (wasBlocked || ordering || analysing()) return;
  const trade = await latestTrade();
  if (trade && trade.at > lastTrade) { lastTrade = trade.at; noted(`/coin/${trade.mint}`); return go(coinPage(trade.mint)); }
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
