/** Where Kris's browser goes next on pump.fun. Only the front page, Kris's own profile, and coin pages are allowed. */
export type TourStop = "hot" | "movers" | "callout" | "screener" | "portfolio" | "home";
/** Coins are where he thinks, so nearly every stop is one. The front page is only passed through to pick the next. */
// Fresh pairs with a callout are the focus (8 Nov): callouts and the screener come up three times each per tour.
export const TOUR: TourStop[] = ["callout", "screener", "hot", "callout", "screener", "movers", "callout", "screener", "portfolio"];
import { slotQualifies, type SlotCoin } from "./kris-slots.ts";
const COIN = /^\/coin\/[1-9A-HJ-NP-Za-km-z]{32,44}(\?highlight_callout=[\w-]+)?$/;

export const isCallout = (href: string) => href.includes("?highlight_callout=");
const mintOf = (href: string) => href.slice("/coin/".length).split("?")[0]!;

/** The first coin of that section not looked at lately. A coin's callout link and its trending link count as one coin. */
export function pickCoin(kind: "hot" | "callout", hrefs: string[], recent: string[]) {
  const seen = new Set(recent);
  return hrefs.find(h => COIN.test(h) && isCallout(h) === (kind === "callout") && !seen.has(mintOf(h))) ?? null;
}

/** From the terminal's own list of live coins: one he could really open, not looked at lately, among the busiest few so it varies. */
export function pickScreener(coins: SlotCoin[], recent: string[], at = Math.random(), minAgeMs = 0, minCapUsd = 3_000) {
  const seen = new Set(recent), fresh = coins.filter(c => !seen.has(c.mint) && (c.ageMs ?? 0) >= minAgeMs && (c.capUsd ?? 0) >= minCapUsd && slotQualifies(c, c.migrated ? "migrated" : "new")).sort((a, b) => (b.traders ?? 0) - (a.traders ?? 0)).slice(0, 12);
  const onCurve = fresh.filter(c => !c.migrated), from = onCurve.length ? onCurve : fresh; // fresh pairs first
  return from[Math.floor(at * from.length)]?.mint ?? null;
}

export function remember(recent: string[], href: string, keep = 200) {
  return [...recent.filter(m => m !== mintOf(href)), mintOf(href)].slice(-keep);
}

/** Kris's model can read files on this machine, so nothing anyone typed on the site reaches it: only numbers, known
 * stat labels and coin names stripped to letters and digits. */
const STAT = /^(market cap|mc|mcap|vol(ume)?( 24h)?|24h vol(ume)?|price|5m|1h|4h|6h|12h|24h|holders|liquidity|position|profit|ath|txns|buys|sells|bonding curve( progress)?)$/i;
const NUMBER = /^[+\-\u2191\u2193 ]*\$?[\d.,]+ ?[KMB%]?$/i;
export const safeName = (s: string) => s.replace(/[^\p{L}\p{N}$ ]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
export const safeFacts = (text: string, max = 24) => text.split("\n").map(l => l.trim()).filter(l => STAT.test(l) || NUMBER.test(l)).slice(0, max);
/** One coin row from Trending: its name, then its numbers. */
export function trendingRow(text: string) {
  const [name = "", ...rest] = text.split("\n").map(l => l.trim()).filter(Boolean);
  return `${safeName(name)}: ${safeFacts(rest.join("\n"), 4).join(" ")}`;
}

/** Market cap from the page's stat text, "$236K" to 236000. */
/** Where the site's trade box is on a coin page, in window pixels. Text from the page is only ever matched here. */
export const tradeBoxScript = `(() => {
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const at = e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const input = [...document.querySelectorAll('input[inputmode="decimal"]')].find(shown); if (!input) return "null";
  let box = input; while (box.parentElement && !(box.innerText || "").split("\\n").some(l => l.trim() === "Sell")) box = box.parentElement;
  const tab = word => [...box.querySelectorAll("button,[role=tab],div,span")].filter(shown).find(e => e.children.length === 0 && e.textContent.trim() === word);
  const after = [...box.querySelectorAll("button")].filter(b => shown(b) && input.compareDocumentPosition(b) & 4 && b.getBoundingClientRect().width > 150);
  const main = after.find(b => b.hasAttribute("data-trade-cta")) ?? after.find(b => /^(buy|sell|place|connect|log in|sign in)/i.test(b.textContent.trim()));
  const hit = main ? (() => { const p = at(main); return document.elementFromPoint(p.x, p.y)?.closest("button") === main; })() : false;
  const buy = tab("Buy"), sell = tab("Sell");
  return JSON.stringify({ wide: innerWidth, high: innerHeight, dollars: (box.innerText || "").split("\\n").some(l => l.trim() === "$"), value: input.value, input: at(input),
    buy: buy && at(buy), sell: sell && at(sell), main: main ? { ...at(main), text: main.textContent.trim().slice(0, 40), off: main.disabled, hit } : null });
})()`;
/** What the site shows right after a press: open dialogs, notices, and the trade button. */
export const afterPressScript = `JSON.stringify({ dialogs: [...document.querySelectorAll("[role=dialog]")].map(e => (e.innerText || "").slice(0, 200)),
  notices: [...document.querySelectorAll("[role=status],[role=alert],[data-sonner-toast]")].map(e => (e.textContent || "").trim().slice(0, 120)).filter(Boolean).slice(0, 4),
  buttons: [...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().width > 150 && b.getBoundingClientRect().left > innerWidth * 0.6).map(b => b.textContent.trim().slice(0, 40)).filter(Boolean).slice(0, 4) })`;
export type TradeBox = { wide: number; high: number; dollars: boolean; value: string; input: { x: number; y: number }; buy: { x: number; y: number } | null; sell: { x: number; y: number } | null; main: { x: number; y: number; text: string; off: boolean; hit: boolean } | null };
/** Why the main button must not be pressed, or null when it may. Only a button that says this side's trade qualifies. */
export function refuseMain(box: TradeBox, side: "buy" | "sell", amountUsd: number) {
  if (!box.dollars) return "amount is not in dollars";
  if (Math.abs(Number(box.value) - amountUsd) > 0.005) return `amount shows ${box.value}`;
  if (!box.main) return "no trade button";
  if (/connect|log in|sign in/i.test(box.main.text)) return "not signed in";
  if (box.main.off) return "trade button is off";
  if (!box.main.hit) return "something covers the trade button";
  if (!new RegExp(`^(${side}|place)`, "i").test(box.main.text)) return `button says ${box.main.text}`;
  return null;
}

/** A button by its words, in window pixels. */
export const buttonScript = (pattern: string) => `(() => { const b = [...document.querySelectorAll("button")].filter(e => ${pattern}.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0)[0]; if (!b) return "null"; b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return JSON.stringify({ x, y, wide: innerWidth, high: innerHeight, hit: document.elementFromPoint(x, y)?.closest("button") === b }); })()`;
/** The words of the Holders tab, for the top holders' share. Only the percents are used. */
export const holdersScript = `(() => { const tab = [...document.querySelectorAll("button")].find(b => /^Holders/.test((b.textContent || "").trim()) && b.getBoundingClientRect().width > 0); const panel = tab?.getAttribute("aria-selected") === "true" ? document.getElementById(tab.getAttribute("aria-controls") ?? "") : null; return panel?.innerText ?? ""; })()`;
/** The words of the open Callouts tab, for tui/agent-trader.ts to split into posts. */
export const calloutsScript = `(() => { const tab = [...document.querySelectorAll("button")].find(b => /^Callouts/.test((b.textContent || "").trim()) && b.getBoundingClientRect().width > 0); const panel = tab?.getAttribute("aria-selected") === "true" ? document.getElementById(tab.getAttribute("aria-controls") ?? "") : null; return panel?.innerText ?? ""; })()`;
/** Scrolls the open Callouts tab, whichever element holds the scroll, so the site loads more. */
export const calloutsMoreScript = `(() => { const tab = [...document.querySelectorAll("button")].find(b => /^Callouts/.test((b.textContent || "").trim()) && b.getBoundingClientRect().width > 0); for (let e = tab && document.getElementById(tab.getAttribute("aria-controls") ?? ""); e; e = e.parentElement) if (/auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight) e.scrollTop = e.scrollHeight; scrollTo(0, document.documentElement.scrollHeight); })()`;
/** The callout box, wherever the site opens it. */
/** The links beside the coin's name at the top of its page. Callouts have links too, so anything lower or in the left pane does not count. */
export const headerLinksScript = `JSON.stringify([...document.querySelectorAll('a[href^="http"]')].filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.top < 200 && r.left > 420 && r.left < 1500; }).map(a => a.href))`;
export const calloutFormScript = `(() => { const at = e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }; const shown = e => e.getBoundingClientRect().width > 0; const root = [...document.querySelectorAll("[role=dialog]")].filter(shown).pop() || null; if (!root) return JSON.stringify({ dialog: false });
  const input = [...root.querySelectorAll("textarea,[contenteditable=true]")].find(shown); const buttons = [...root.querySelectorAll("button")].filter(b => shown(b) && (b.textContent || "").trim()); const send = buttons.filter(b => /^(post|share|publish|send|call|update)/i.test(b.textContent.trim())).pop();
  return JSON.stringify({ dialog: true, wide: innerWidth, high: innerHeight, words: (root.innerText || "").slice(0, 120), input: input ? at(input) : null, written: input ? (input.value ?? input.innerText ?? "").length : 0, buttons: buttons.map(b => b.textContent.trim().slice(0, 24)).slice(0, 10), send: send ? { ...at(send), text: send.textContent.trim().slice(0, 24), off: send.disabled } : null }); })()`;
