/** Where Kris's browser goes next on pump.fun. Only the front page, Kris's own profile, and coin pages are allowed. */
export type TourStop = "hot" | "callout" | "portfolio" | "home";
export const TOUR: TourStop[] = ["hot", "callout", "portfolio", "home"];
const COIN = /^\/coin\/[1-9A-HJ-NP-Za-km-z]{32,44}(\?highlight_callout=[\w-]+)?$/;

export const isCallout = (href: string) => href.includes("?highlight_callout=");
const mintOf = (href: string) => href.slice("/coin/".length).split("?")[0]!;

/** The first coin of that section not looked at lately. A coin's callout link and its trending link count as one coin. */
export function pickCoin(kind: "hot" | "callout", hrefs: string[], recent: string[]) {
  const seen = new Set(recent);
  return hrefs.find(h => COIN.test(h) && isCallout(h) === (kind === "callout") && !seen.has(mintOf(h))) ?? null;
}

export function remember(recent: string[], href: string, keep = 12) {
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

