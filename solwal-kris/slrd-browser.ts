/** A real browser window on pump.fun, shown on Kris's monitor. It looks around: Trending, Hot callouts and his own
 * positions, and jumps to a coin when it trades. It clicks only coin and home links, and in agent mode the
 * trade box of the coin an order names (tui/agent-orders.ts). Signing in and the Cloudflare check are left for a person. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { KRIS_WALLET } from "./tui/kris-public.ts";
import { calloutCountOf, pickCoin, pickScreener, screenerCandidates, refuseMain, remember, safeFacts, safeName, TOUR, afterPressScript, buttonScript, calloutFormScript, headerLinksScript, calloutsScript, calloutsMoreScript, holdersScript, tradeBoxScript, trendingRow, type TourStop, type TradeBox } from "./tui/pump-tour.ts";
import { isProjectSite } from "./tui/exa-facts.ts";
import { doneCallout, execution, failCallout, nextCallout, nextOrder, requeueClaimedCallouts, readOrder, writeCallout, writeOrder, type AgentOrder, type CalloutJob } from "./tui/agent-orders.ts";
import { calloutSignals, pageFacts, splitCallouts, topHoldersPct, type Callout } from "./tui/agent-trader.ts";

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
// One of these at a time: a copy left behind by a restart must not stay around.
const pidPath = resolve(dot, "browser.pid");
try { process.kill(Number(readFileSync(pidPath, "utf8"))); } catch {}
writeFileSync(pidPath, String(process.pid));
let ws!: WebSocket, id = 0;
const waits = new Map<number, (v: any) => void>();
/** Our own tab, never one that was already open. Also the way back after the tab or the browser goes away. */
async function connect() {
  openEdge();
  let page: { webSocketDebuggerUrl: string } | null = null;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    if (i === 30) openEdge(); // a restart can catch the last window still closing
    page = await fetch(`http://127.0.0.1:${PORT}/json/new?${HOME}`, { method: "PUT" }).then(r => r.ok ? r.json() as Promise<{ webSocketDebuggerUrl: string }> : null).catch(() => null);
  }
  if (!page) throw new Error("browser did not open");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); waits.get(m.id)?.(m.result); waits.delete(m.id); };
}
await connect();
// A page load can swallow the reply to a call in flight, and one lost reply must not stop the stream.
const cdp = (method: string, params: Record<string, unknown> = {}) => new Promise<any>(r => {
  const n = ++id, timer = setTimeout(() => { waits.delete(n); r(undefined); }, 6_000);
  waits.set(n, v => { clearTimeout(timer); r(v); });
  try { ws.send(JSON.stringify({ id: n, method, params })); } catch {}
});
await cdp("Page.enable");
log("browser open on pump.fun");


const root = import.meta.dir; let ordering = false, readAt = 0;
let here = HOME, wasBlocked = false, lastTrade = 0, step = 0, recent: string[] = [];
const STOP_MS = 26_000, portfolio = () => `https://pump.fun/profile/${execution(root).address ?? KRIS_WALLET}`;
const value = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;
const noCallout = new Map<string, number>();
const valueAsync = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
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
  // A position opened by hand: he goes and reads that coin before anything else.
  const asked = nextAsked(); askedMint = asked;
  if (asked) { noted(`/coin/${asked}`); await go(coinPage(asked)); return log(`asked to read: ${asked}`); }
  if (stop === "portfolio") return go(portfolio());
  const ov: any = await fetch(`${view}/api/overview`, { headers: { cookie: `slrd_web=${bridgeToken}` }, signal: AbortSignal.timeout(10_000) }).then(r => r.json()).catch(() => null);
  const skip = [...recent, ...(ov?.bots ?? []).map((b: any) => b.mint as string)]; // what he holds is not news
  if (stop === "screener") {
    // Fresh pairs from our own trade stream, checked for callouts through pump.fun's API from inside this page (the
    // session is already there, no page visit per coin): only one that has a callout is opened (owner, 8 Nov).
    const pool = [...(ov?.young ?? []), ...(ov?.coins ?? [])];
    let mint: string | null = null;
    const now = Date.now();
    for (const m of screenerCandidates(pool, [...skip, ...[...noCallout].filter(([, at]) => now - at < 300_000).map(([k]) => k)], 8)) {
      const body = await valueAsync(`fetch("https://frontend-api-v3.pump.fun/mint-positions/${m}?sortBy=TOP&withThesis=true&pageSize=20", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null)`);
      const n = calloutCountOf(body);
      if (n > 0) { mint = m; log(`screener: ${m.slice(0, 6)} has ${n} callout(s)`); break; }
      noCallout.set(m, now); // looked again in 5 minutes: a callout may come
      if (noCallout.size > 2000) noCallout.clear();
      await sleep(1_200);
    }
    mint ??= pickScreener(pool, skip);
    if (!mint) return visit(tries + 1);
    noted(`/coin/${mint}`); await go(coinPage(mint)); return log(`screener: ${mint}`);
  }
  if (stop === "hot" || stop === "movers" || stop === "new") { // Trending, Movers and New are tabs on the front page
    if (new URL(here).pathname !== "/") { if (!(await click("/"))) await go(HOME); await sleep(2_500); }
    const tab = stop === "movers" ? "Movers" : stop === "new" ? "New" : "Trending";
    await value(`[...document.querySelectorAll("button,[role=tab]")].find(b => (b.textContent || "").trim() === ${JSON.stringify(tab)})?.click()`); await sleep(1_500);
  }
  const hrefs = JSON.parse(await value(`JSON.stringify([...document.querySelectorAll("a[href]")].map(a => a.getAttribute("href")))`) ?? "[]") as string[];
  const href = pickCoin(stop === "movers" || stop === "new" ? "hot" : stop, hrefs, skip);
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
let askedMint: string | null = null;
function nextAsked() {
  const path = resolve(dot, "kris-read-next.json");
  try { const [first, ...rest] = JSON.parse(readFileSync(path, "utf8")) as string[]; if (first) writeFileSync(path, JSON.stringify(rest)); return first ?? null; } catch { return null; }
}
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
    callout: stop === "callout" ? safeFacts(posted, 10) : [], callouts, asked: coin && seen.path.slice(6) === askedMint, top10HeldPct: holders, page: coin ? { ...pageFacts(seen.text, seen.path.slice(6)), site: await headerSite() } : null }));
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
/** He opens the coin's Callouts tab in front of viewers and reads every post, scrolling while more load. */
const MAX_CALLOUTS = 300, calloutLine = (p: Callout) => `${p.who}${p.positionUsd != null ? ` (holds $${Math.round(p.positionUsd)}, profit $${Math.round(p.profitUsd ?? 0)})` : ""}${p.ageMin != null ? `, ${Math.round(p.ageMin)} min ago` : ""}: ${p.body}`;
async function readCallouts() {
  if (!(await tap("/^Callouts/"))) return null;
  const seen = new Map<string, Callout>(), read = async () => { for (const p of splitCallouts(await value(calloutsScript) ?? "", MAX_CALLOUTS)) seen.set(`${p.who}|${p.body}`, p); return seen.size; };
  for (let i = 0; i < 8 && !seen.size; i++) { await sleep(700); await read(); } // they load after the tab opens
  for (let i = 0, still = 0; seen.size >= 30 && seen.size < MAX_CALLOUTS && still < 2 && i < 30; i++) { const had = seen.size; await value(calloutsMoreScript); await sleep(700); still = await read() > had ? 0 : still + 1; }
  if (seen.size >= 30) await value("scrollTo(0, 0)");
  const posts = [...seen.values()];
  log(`read ${posts.length} callouts`);
  return posts.length ? { ...calloutSignals(posts)!, whatCallersSay: posts.map(calloutLine) } : null;
}
/** One public post, in the site's own box, from the words Kris already wrote. A dry job stops before the post. */
/** Hands the file straight to the form's own input, the one behind its photo button. */
async function attachImage(path: string) {
  const found = await cdp("Runtime.evaluate", { expression: `[...document.querySelectorAll('[role=dialog] input[type=file]')].pop()` });
  const objectId = found?.result?.objectId; if (!objectId) return false;
  await cdp("DOM.enable");
  const done = await cdp("DOM.setFileInputFiles", { files: [path], objectId });
  if (!done) return false;
  await sleep(3_500); // it uploads before the post button is ready
  return true;
}
async function headerSite() {
  try { return (JSON.parse(await value(headerLinksScript) ?? "[]") as unknown[]).find(isProjectSite) ?? null; } catch { return null; }
}
async function postCallout(job: CalloutJob) {
  const url = coinPage(job.mint); if (url === HOME) { doneCallout(root, job.mint); return; }
  await go(url);
  for (let i = 0; i < 24; i++) { await sleep(500); if ((await value("location.pathname")) === `/coin/${job.mint}` && await readBox()) break; }
  let open = false;
  if (job.update) { for (let i = 0; i < 8; i++) { await sleep(700); if (await tap("/^Yours/")) break; } await sleep(1_500); } // his own post sits on that tab
  for (let i = 0; i < 12 && !open; i++) { await sleep(700); open = await tap(job.update ? "/^Update callout/" : "/^Add your callout/"); } // the holder's card loads after the trade box
  if (!open) { // right after a buy the page may not know he holds it yet
    doneCallout(root, job.mint);
    if ((job.tries ?? 0) < 3) setTimeout(() => writeCallout(root, { ...job, tries: (job.tries ?? 0) + 1 }), 30_000);
    return log(`callout ${job.mint.slice(0, 6)}: no button, try ${(job.tries ?? 0) + 1}`);
  }
  let form: any = null;
  for (let i = 0; i < 12 && !form?.input; i++) { await sleep(500); form = JSON.parse(await value(calloutFormScript) ?? "null"); } // the box takes a moment to open
  log(`callout form: ${JSON.stringify(form).slice(0, 300)}`);
  if (!form?.input) { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); failCallout(root, job); return log(`callout ${job.mint.slice(0, 6)}: no box`); }
  await realClick(form.input, form);
  await cdp("Input.insertText", { text: job.text }); await sleep(700);
  if (job.image) log(`callout ${job.mint.slice(0, 6)}: picture ${await attachImage(job.image) ? "attached" : "not attached"}`);
  form = JSON.parse(await value(calloutFormScript) ?? "null");
  log(`callout filled: ${JSON.stringify(form).slice(0, 300)}`);
  if (job.dry || !form?.send || form.send.off || form.written < 5) { if (job.dry) doneCallout(root, job.mint); else failCallout(root, job); await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); return log(`callout ${job.mint.slice(0, 6)}: ${job.dry ? "dry, not posted" : "no send button"}`); }
  await realClick(form.send, form);
  log(`callout posted on ${job.mint.slice(0, 6)}: ${job.text}`); await sleep(3_000);
  const after = await value(afterPressScript) ?? "";
  log(`after callout: ${after}`);
  // Only pump.fun's own notice counts as posted; anything else goes back in the queue.
  if (/Callout (posted|updated)/i.test(after)) doneCallout(root, job.mint);
  else { log(`callout ${job.mint.slice(0, 6)}: no confirmation, queued again`); failCallout(root, job); }
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
log(`callouts left half-posted, queued again: ${requeueClaimedCallouts(root)}`);
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
  await postCallout(job).catch(e => { log(`callout: ${String(e).slice(0, 80)}`); failCallout(root, job); }).finally(() => { ordering = false; });
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

let lost = 0;
for (;;) {
  const seen = (await cdp("Runtime.evaluate", { expression: "JSON.stringify([document.title, location.href])", returnByValue: true }))?.result?.value;
  if (!seen) { // no answer is a lost connection, not a check on the page
    if (++lost >= 5) { log("browser connection lost, reconnecting"); lost = 0; await connect().catch(e => log(`reconnect: ${String(e).slice(0, 80)}`)); await cdp("Page.enable"); }
    await sleep(1_000); continue;
  }
  lost = 0;
  const [title, href] = JSON.parse(seen) as [string, string];
  const stop = blocked(title) || !onPump(href);
  if (stop !== wasBlocked) { wasBlocked = stop; log(stop ? (blocked(title) ? "Cloudflare check showing: click it in the browser window" : `off pump.fun: ${href.slice(0, 60)}`) : "back on pump.fun, streaming"); }
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
