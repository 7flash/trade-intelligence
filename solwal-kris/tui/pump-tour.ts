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

/** Market cap from the page's stat text, "$236K" to 236000. */
export function capOf(text: string) {
  const m = /\$([\d.,]+) ?([KMB]?)/i.exec(text);
  return m ? Number(m[1]!.replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]!.toUpperCase()] ?? 1) : null;
}
export type Panel = { coin: string; cap: number | null; buy: number; sell: number; steps: number; live: boolean };
export const usd = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`;
/** Where the cap sits in the range, 0 to 100. Steps are spaced by percent, so this is measured the same way. */
export const rangeAt = (p: Panel) => p.cap ? Math.max(0, Math.min(100, Math.log(p.cap / p.buy) / Math.log(p.sell / p.buy) * 100)) : 0;
/** Script that draws Kris's range card on the page and types its values in, or removes it. It only shows: no controls,
 * no token, and values go in as text, never as HTML. */
export function panelScript(p: Panel | null) {
  const rows = p ? [["buy", "Buy from", usd(p.buy)], ["sell", "Sell to", usd(p.sell)], ["steps", "Steps", String(p.steps)], ["now", "Now", p.cap ? usd(p.cap) : "-"]] : [];
  return `(() => { document.getElementById("kris-range")?.remove(); ${p ? `
    const d = document.createElement("div"); d.id = "kris-range";
    d.style.cssText = "position:fixed;left:56%;top:230px;z-index:2147483647;width:230px;padding:14px;background:#111418f5;color:#e8eaed;border:1px solid #2a3038;border-radius:12px;font:13px/1.6 ui-monospace,monospace;pointer-events:none;box-shadow:0 8px 30px #0009";
    const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px"; const name = document.createElement("span"); name.textContent = ${JSON.stringify(p.coin || "Coin")}; const state = document.createElement("span"); state.textContent = ${JSON.stringify(p.live ? "LIVE" : "PLAN")}; state.style.color = ${JSON.stringify(p.live ? "#22c55e" : "#8b95a1")}; head.append(name, state); d.append(head);
    const cells = ${JSON.stringify(rows)}.map(([id, label, value]) => { const r = document.createElement("div"); r.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:3px"; const l = document.createElement("span"); l.style.color = "#8b95a1"; l.textContent = label; const v = document.createElement("span"); v.id = "kris-" + id; v.style.cssText = id === "now" ? "" : "min-width:74px;text-align:right;padding:0 6px;border:1px solid #2a3038;border-radius:6px;background:#0b0e11"; r.append(l, v); d.append(r); return [v, value]; });
    const bar = document.createElement("div"); bar.style.cssText = "position:relative;height:6px;margin-top:10px;border-radius:3px;background:linear-gradient(90deg,#22c55e66,#ef444466)"; const mark = document.createElement("div"); mark.id = "kris-mark"; mark.style.cssText = "position:absolute;top:-2px;left:0;width:3px;height:10px;background:#fff;border-radius:1px;transition:left 1.2s"; bar.append(mark); d.append(bar);
    const set = document.createElement("div"); set.id = "kris-set"; set.textContent = "Set range"; set.style.cssText = "margin-top:12px;padding:5px;text-align:center;font-weight:700;border-radius:8px;background:#22c55e;color:#0b0e11;transition:background .3s"; d.append(set);
    document.body.append(d);
    let i = 0, c = 0; const t = setInterval(() => { const cell = cells[i]; if (!cell) { clearInterval(t); mark.style.left = "calc(${rangeAt(p).toFixed(1)}% - 1px)"; return; } cell[0].textContent = cell[1].slice(0, ++c); if (c >= cell[1].length) { i++; c = 0; } }, 90);` : ""} })()`;
}

/** A coin above his starting range gets a range around its own cap, as his rules do for migrated coins. */
export function nextRange(p: Panel, steps: (buy: number, sell: number) => number) {
  if (p.live || !p.cap || (p.cap >= p.buy && p.cap <= p.sell)) return null;
  const buy = Math.round(p.cap * 0.6), sell = Math.round(p.cap * 1.9);
  return { ...p, buy, sell, steps: steps(buy, sell) };
}

