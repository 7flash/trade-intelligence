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
