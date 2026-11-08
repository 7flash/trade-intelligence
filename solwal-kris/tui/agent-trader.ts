/** What lets the agent open positions on his own: callouts turned into numbers, and the limits he cannot pass. */
import { goodHolders, SLOT_CONFIG, slotRange } from "./kris-slots.ts";

export const AGENT_LIMITS = { maxPositions: 60, maxSizeSol: 0.2, minSizeSol: 0.07, reserveSol: 0.13, maxSteps: 6, minCapUsd: 3_000, stepMinSol: 0.012, reopenAfterMs: SLOT_CONFIG.reopenAfterMs,
  /** Only rules out extremes: the reading has shown over 100%, so it is not a precise line. To check. */
  maxEarlyPct: 60,
  /** 149 tracked coins: median -19% in the first 5 minutes, -3% from 5 to 10. */
  /** 0 since 8 Nov: fresh pairs are the focus, the runners (GATOGLITCH, HABIBI) made their move in the first minutes. */
  minAgeMs: 0,
  /** A coin our tracker never followed has no launch reading: fine once it has outlived its launch. */
  unknownEarlyAgeMs: 1_800_000,
  /** SOLMOURN, a rug, had 40%; clean coins read so far sit between 2% and 17%. A few examples, not yet a study. */
  maxTop10Pct: 30 };
export type Callout = { who: string; body: string; ageMin: number | null; positionUsd: number | null; profitUsd: number | null; likes: number; views: number };

const money = (s?: string) => { const m = /^([+\-−]?)\$([\d,.]+)([KMB]?)/.exec(s ?? ""); if (!m) return null; return (m[1] === "-" || m[1] === "−" ? -1 : 1) * Number(m[2]!.replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3]!] ?? 1); };
const count = (s?: string) => { const m = /^([\d,.]+)([KM]?)$/.exec(s ?? ""); return m ? Number(m[1]!.replace(/,/g, "")) * ({ K: 1e3, M: 1e6 }[m[2]!] ?? 1) : null; };
const ageOf = (s: string) => { const m = /^(\d+)([smhd])$/.exec(s); return m ? Number(m[1]) * ({ s: 1 / 60, m: 1, h: 60, d: 1440 }[m[2]!] ?? 1) : null; };

/** One post as the site lays it out: name, age, the words, then Position and Profit if they hold it, then its counts. */
export function parseCallout(text: string, who: string): Callout {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean), at = lines.findIndex(l => l === "Position"), profit = lines.indexOf("Profit");
  const ageAt = lines.findIndex(l => ageOf(l) != null), end = at >= 0 ? at : lines.length;
  const tail = lines.slice(ageAt + 1).filter((_, i, all) => all[i - 1] !== "Position" && all[i - 1] !== "Profit").map(count).filter((n): n is number => n != null); // likes, replies, views: on either side of Position
  return { who, body: lines.slice(ageAt + 1, end).filter(l => count(l) == null && money(l) == null && l !== "MC").join(" "), ageMin: ageAt >= 0 ? ageOf(lines[ageAt]!) : null,
    positionUsd: at >= 0 ? money(lines[at + 1]) : null, profitUsd: profit >= 0 ? money(lines[profit + 1]) : null, likes: tail[0] ?? 0, views: tail[2] ?? tail[tail.length - 1] ?? 0 };
}

/** The tab's text into posts: each starts with a name, maybe a handle, then the age. Pages of Holders have no ages. */
export function splitCallouts(text: string, max = 30) {
  const lines = text.split("\n"), ages = lines.flatMap((l, i) => ageOf(l.trim()) != null ? [i] : []), posts: Callout[] = [];
  const startOf = (at: number) => { let i = at - 1; while (i >= 0 && !lines[i]!.trim()) i--; if (lines[i]?.trim().startsWith("@")) { i--; while (i >= 0 && !lines[i]!.trim()) i--; } return Math.max(0, i); };
  for (let k = 0; k < ages.length && posts.length < max; k++) { const from = startOf(ages[k]!), to = k + 1 < ages.length ? startOf(ages[k + 1]!) : lines.length, who = lines[from]!.trim(); if (who) posts.push(parseCallout(lines.slice(from, to).join("\n"), who)); }
  return posts;
}

const THEMES: Record<string, RegExp> = { dev: /\b(dev|devs|founder|team)\b/i, hype: /\b(moon|gem|\d+x|milly|million|send(ing)? it|lfg|runner|ape)\b/i, warning: /\b(rug|rugged|scam|honeypot|bundled?|insiders?|jeet(ed|s)?|dump(ed|ing)?)\b/i, plan: /\b(roadmap|stream|partnership|launch|utility|product|app|airdrop)\b/i };
const shout = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Only counts leave here. A caller is real when they hold a position and their words are not a copy of someone else's. */
export function calloutSignals(posts: Callout[]) {
  if (!posts.length) return null;
  const authors = [...new Set(posts.map(p => p.who))], said = new Map<string, Set<string>>();
  for (const p of posts) { const k = shout(p.body); if (k.length > 8) (said.get(k) ?? said.set(k, new Set()).get(k)!).add(p.who); }
  const copied = new Set([...said.entries()].filter(([, w]) => w.size > 1).flatMap(([k]) => posts.filter(p => shout(p.body) === k).map(p => p.who)));
  const real = authors.filter(a => !copied.has(a) && posts.some(p => p.who === a && (p.positionUsd ?? 0) > 0));
  const most = Math.max(...authors.map(a => posts.filter(p => p.who === a).length));
  return { posts: posts.length, callers: authors.length, realCallersPct: Math.round(real.length / authors.length * 100), copiedCallers: copied.size, inProfit: posts.filter(p => (p.profitUsd ?? 0) > 0).length, heldUsd: Math.round(posts.reduce((a, p) => a + Math.max(0, p.positionUsd ?? 0), 0)),
    oneCallerSharePct: Math.round(most / posts.length * 100), topViews: Math.max(...posts.map(p => p.views)), themes: Object.fromEntries(Object.entries(THEMES).map(([k, re]) => [k, posts.filter(p => re.test(p.body)).length])) };
}

export type CoinRisk = { bundledPct: number; earlyBoughtPct: number | null; top10Pct: number | null; goodHolders: number; devFunded: number };
export function coinRisk(info: { recent?: unknown[]; earlyBoughtPct?: number | null; exact?: boolean; creator?: string | null; clusters?: { source?: string; members?: number }[]; transfers?: { from?: string[] }[]; wallets?: { pct: number; ours?: unknown; profile?: { coins?: number; wins?: number; realizedSol?: number } | null }[] }, share: number): CoinRisk {
  const tops = (info.wallets ?? []).filter(w => w.pct > 0 && !w.ours).map(w => w.pct).sort((a, b) => b - a).slice(0, 10);
  return { bundledPct: Math.round(share * 100), earlyBoughtPct: info.earlyBoughtPct == null || !(info.wallets ?? []).length ? null : Math.round(info.earlyBoughtPct), top10Pct: info.exact ? Math.round(tops.reduce((a, b) => a + b, 0)) : null, goodHolders: goodHolders(info.wallets ?? []),
    devFunded: (info.clusters ?? []).filter(c => c.source === info.creator).reduce((a, c) => a + (c.members ?? 0), 0) + (info.transfers ?? []).filter(t => info.creator && t.from?.includes(info.creator)).length };
}

/** The share of supply the top holders own, from the numbers in pump.fun's Holders tab: each row shows its percent, sometimes twice. */
export function topHoldersPct(text: string, top = 10) {
  const all = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => Number(m[1])), rows = all.filter((n, i) => n !== all[i - 1]).slice(0, top);
  return rows.length >= 3 ? Math.round(rows.reduce((a, b) => a + b, 0) * 10) / 10 : null;
}

/** Market cap and age from the coin's own page, for coins our tracker does not follow. The age sits just before the short address. */
export function pageFacts(text: string, mint: string) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean), m = /Market cap[\s\S]{0,12}?\$([\d,.]+)([KMB]?)/.exec(text);
  const capUsd = m ? Number(m[1]!.replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]!] ?? 1) : null;
  const short = lines.findIndex(l => l.startsWith(mint.slice(0, 4)) && l.includes("…"));
  const age = short > 0 ? lines.slice(Math.max(0, short - 4), short).reverse().find(l => ageOf(l) != null || /^\d+mo$/.test(l) || /^\d+y$/.test(l)) : undefined;
  const mo = age && /^(\d+)mo$/.exec(age), yr = age && /^(\d+)y$/.exec(age);
  return { capUsd, ageMs: mo ? Number(mo[1]) * 2_592_000_000 : yr ? Number(yr[1]) * 31_536_000_000 : age ? ageOf(age)! * 60_000 : null };
}

/** The whole balance over the slots left, above the reserve, never over the cap, and never so small a step cannot send. */
export function agentSize(freeSol: number, open: number, l = AGENT_LIMITS) {
  const slots = l.maxPositions - open; if (slots <= 0) return 0;
  const spare = freeSol - l.reserveSol;
  if (spare < l.minSizeSol) return 0;
  return Math.floor(Math.max(l.minSizeSol, Math.min(l.maxSizeSol, spare / slots)) * 1000) / 1000;
}
/** Why he may not open this coin, or null. No answer on bundles means no buy. */
export function refuseOpen(o: { risk: CoinRisk | null; capUsd: number | null; held: boolean; closedAgoMs: number | null; lastOpenAgoMs?: number | null; size: number; ageMs: number | null; callouts: number; top10HeldPct?: number | null }, l = AGENT_LIMITS) {
  if (o.held) return "already held";
  if (!o.size) return "no slot or no SOL";
  if (!o.capUsd || o.capUsd < l.minCapUsd) return "cap too small";
  if (!o.risk) return "no bundle read";
  if (o.risk.bundledPct >= SLOT_CONFIG.maxBundleShare * 100) return "bundled";
  if (o.risk.devFunded > 0) return "dev funded wallets"; // the creator seeded other wallets: the bundle the trades do not show
  if (o.risk.earlyBoughtPct != null && o.risk.earlyBoughtPct >= l.maxEarlyPct) return "bought early";
  if (o.risk.earlyBoughtPct == null && (o.ageMs == null || o.ageMs < l.unknownEarlyAgeMs)) return "no early read on a young coin"; // only survivors go unread
  if (o.top10HeldPct == null) return "no holder read";
  if (o.top10HeldPct >= l.maxTop10Pct) return "top heavy";
  if (o.ageMs == null || o.ageMs < l.minAgeMs) return "too new";
  if (!o.callouts) return "no callouts"; // nobody has put their name on it yet
  if (o.closedAgoMs != null && o.closedAgoMs < l.reopenAfterMs) return "closed recently";
  return null;
}
/** The last 30 minutes before an open. 74 closes from the last 30 hours: up 3x or more, 12 closes and none won (-0.38 SOL);
 * under 85% of the 30-minute high, 19 closes and one won (-0.54). Both together: 26 closes, 1 won, -0.73; the other 49 lost -0.47. */
export function chaseRefusal(r: { lowUsd: number; highUsd: number; nowUsd: number } | null) {
  if (!r || !(r.lowUsd > 0) || !(r.highUsd > 0)) return null; // no history: the other limits decide
  if (r.nowUsd / r.lowUsd >= 3) return "already up 3x in 30 minutes";
  if (r.nowUsd / r.highUsd < 0.85) return "falling from its high";
  return null;
}
/** Low and high of the last 30 minutes, from GeckoTerminal one-minute candles: only asked for a coin that passed everything else. */
export async function lastHalfHour(mint: string) {
  const SOL = "So11111111111111111111111111111111111111112";
  const pairs = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json() as Promise<{ pairAddress?: string; quoteToken?: { address?: string }; liquidity?: { usd?: number } }[]>);
  const pools = [...pairs].sort((a, b) => Number(b.quoteToken?.address === SOL) - Number(a.quoteToken?.address === SOL) || (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 2); // a pool quoted in another token often has no candles
  for (const p of pools) {
    const o = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p.pairAddress}/ohlcv/minute?aggregate=1&limit=31&currency=usd`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json() as Promise<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>);
    const c = o.data?.attributes?.ohlcv_list ?? [];
    if (c.length >= 5) return { lowUsd: Math.min(...c.map(x => x[3]!)), highUsd: Math.max(...c.map(x => x[2]!)), nowUsd: c[0]![4]! };
  }
  return null;
}
/** The range rule he already had. Each step stays over $1, because a callout needs that much of the coin held. */
/** The range starts low: coins he opens fall hard first (2373 seen: median -67% in 30 minutes at $10k-$100k).
 * Replayed on his 31 closed opens of Nov 6-8: 0.6x-1.9x even steps -0.48 SOL, 0.25x-1.5x percent steps -0.03 (better in both halves). */
/** Fresh pairs (owner, 8 Nov): about $2 per coin, 2 steps over a 3x range around the cap at open. */
export const AGENT_RANGE = { low: 0.6, high: 1.8 };
export const FRESH_USD = 2.3; // pump.fun posts a callout only with $2 held; 2.3 stays above it after fees
export const freshSize = (solUsd: number | null | undefined) => solUsd && solUsd > 0 ? Math.round(FRESH_USD / solUsd * 1e4) / 1e4 : 0.026;
const roundTwo = (v: number) => { const m = 10 ** (Math.floor(Math.log10(v)) - 1); return Math.round(v / m) * m; };
export function agentPlan(capUsd: number, size: number, l = AGENT_LIMITS) {
  const buy = roundTwo(capUsd * AGENT_RANGE.low), sell = roundTwo(capUsd * AGENT_RANGE.high);
  return { buy, sell, steps: Math.max(2, Math.min(l.maxSteps, Math.floor(size / l.stepMinSol))), budget: size, percentSteps: true };
}
/** A public post: no addresses and no links, whatever the model wrote. */
export const calloutText = (s: string) => s.replace(/https?:\/\/\S+/g, "").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, "").replace(/\s+/g, " ").trim().slice(0, 280);
/** No coin sits for hours without a trade. Nobody trades it after 2 hours, or it simply has not reached a level in 3: the SOL goes to a coin that moves. */
export const deadCoin = (hourVolumeUsd: number | null, lastTradeAtMs: number | null | undefined, nowMs: number) =>
  lastTradeAtMs != null && (nowMs - lastTradeAtMs >= 3 * 3_600_000 || (hourVolumeUsd != null && hourVolumeUsd < 100 && nowMs - lastTradeAtMs >= 2 * 3_600_000));
/** A callout has to be about this coin: it says the name, in plain letters. */
export const namesCoin = (text: string, symbol: string | null) => { const name = (symbol ?? "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase(); return name.length > 0 && text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").includes(name); };
/** Every automatic range has the same width, so the goal comes from what the coin is worth: small coins have more room. Most callouts name none. */
export const goalX = (capUsd?: number | null) => capUsd == null ? null : capUsd < 20_000 ? 5 : capUsd < 100_000 ? 4 : capUsd < 500_000 ? 3 : 2;
export const useGoal = (at = Math.random()) => at < 0.4;
/** Different moments call for different lines. The first is only for a site with live numbers; the rest take turns. */
export const CALLOUT_SHAPES = {
  number: "Lead with one live number from siteNow and what it tells you, in plain words.",
  observation: "Say what the coin does and what people here are doing with it, then the one thing your bet hangs on.",
  question: "Ask the chat the one sharp question that decides this coin, then answer it yourself in a few words.",
  contrast: "Set what the chat is talking about against what is actually there, in one or two short sentences.",
  next: "Say the next concrete thing that has to happen for this coin and why you are here before it.",
  punch: "One sentence, at most fourteen words, naming the single thing that makes this coin worth holding.",
  joke: "A dry joke that also tells the reader what this coin really is.",
} as const;
export type CalloutShape = keyof typeof CALLOUT_SHAPES;
export function pickShape(hasLiveNumbers: boolean, recent: CalloutShape[], at = Math.random()): CalloutShape {
  const all = (Object.keys(CALLOUT_SHAPES) as CalloutShape[]).filter(s => s !== "number");
  if (hasLiveNumbers && recent[recent.length - 1] !== "number") return "number";
  const fresh = all.filter(s => !recent.slice(-3).includes(s));
  return (fresh.length ? fresh : all)[Math.floor(at * (fresh.length ? fresh : all).length)]!;
}
export const goalLine = (goal: number, at = Math.random()) => [`easy ${goal}x from here.`, `${goal}x from here is not a stretch.`, `${goal}x from here feels fair.`, `i'm here for the ${goal}x.`][Math.floor(at * 4)]!;
/** Cash too low to open anything: the coin nobody trades goes first, and among equals the one that frees the most SOL. */
export function lowestVolume<T extends { hourVolumeUsd: number | null; valueSol: number }>(coins: T[]) {
  return coins.filter(x => x.hourVolumeUsd != null && x.valueSol > 0).sort((x, y) => x.hourVolumeUsd! - y.hourVolumeUsd! || y.valueSol - x.valueSol)[0] ?? null;
}
/** A position he opened that could never buy: nothing spent, nothing held, and the last try failed. It only blocks a slot. */
export function neverBought(b: { costSol?: number | null; valueSol?: number | null; amountRaw?: string | null; last?: string | null }, openedAtMs: number | undefined, nowMs: number) {
  return openedAtMs != null && nowMs - openedAtMs >= 600_000 && !b.costSol && !b.valueSol && (!b.amountRaw || b.amountRaw === "0") && /buy failed/.test(b.last ?? "");
}
/** An update reports a change, so it needs numbers, and each one must really be in the two reads of the site. */
export function backedByReads(text: string, before: string, now: string) {
  const nums = (s: string) => s.replace(/(\d)\s+of\s+(\d)/gi, "$1/$2").match(/\d+(?:[.,/]\d+)*/g) ?? [], known = new Set([...nums(before), ...nums(now)]), said = nums(text);
  return said.length > 0 && said.every(n => known.has(n));
}
/** Words that turn a callout back into a report, or put holders where a project should be. */
export const flatCallout = (text: string) => /\b(callers?|holders?|ownership|launch stays|appears? to|seems?|might|potentially|i bought|same-ticker|copycat|isn't|solana (meme|token)|metadata|mutable|mint authority|liquidity|lower range|top wallets|overtake selling|creator sold)\b|my bet is,/i.test(text); // chain trivia is not a story (knight, 8 Nov)
/** A live counter reads 0 until its page has loaded, and readers of a site see it before that. A count of nothing is never worth saying. */
export const zeroCount = (text: string) => /(^|[^\d.,$])(0|zero)\s+[a-z]/i.test(text);
/** A reply that opens carries the post for other traders after its verdict: his read stays his read, the post is kept apart. */
export function splitCallout(text: string) {
  const m = /\n\s*\**CALLOUT:\**\s*([\s\S]*)$/i.exec(text);
  const said = m?.[1]?.replace(/\*+/g, "").trim() ?? "";
  return { read: m ? text.slice(0, m.index) : text, callout: said && !/^SKIP\b/i.test(said) ? said : null };
}
/** The model ends an analysis with OPEN or PASS on its own line. */
export const verdictOf = (text: string) => /(^|\n)\s*OPEN\s*$/.test(text);
export const withoutVerdict = (text: string) => text.replace(/\s*\n?\s*(OPEN|OPE|OP|PASS|PAS|PA)\s*$/, "").trimEnd();

/** Pacing by choice, not by a clock: coins he would open wait in a pool, and once 5 are in, or 20 minutes after the
 * first, he opens the best one and drops the rest. Opening every good coin was 13 an hour, each losing 0.017 on average;
 * a 12-minute gap fixed the rate but took whichever coin came first. Bigger caps held up best in 30-minute outcomes
 * (2373 coins: $10-30k median -67%, $100k-1M about 0%), so the biggest cap is the best of the pool. */
export const OPEN_POOL = { size: 3, waitMs: 10 * 60_000 }; // 5 and 20 min left good coins waiting with nothing opening (8 Nov)
export type PoolEntry = { mint: string; addedAtMs: number };
export function poolReady(pool: readonly PoolEntry[], nowMs: number, p = OPEN_POOL) {
  return pool.length >= p.size || (pool.length > 0 && nowMs - Math.min(...pool.map(e => e.addedAtMs)) >= p.waitMs);
}
/** Candidates weighed again at choosing time: only those still clear, biggest cap first. */
export function rankPool<T extends { mint: string; refused: string | null; capUsd: number | null; picked?: boolean }>(weighed: readonly T[]): T[] {
  // Coins he said OPEN to come first; a coin he passed on is taken only when none of the pool got an OPEN (8 Nov: with
  // OPEN-only pools two clear coins an hour reached the pool and nothing opened for over an hour).
  return weighed.filter(w => w.refused === null && (w.capUsd ?? 0) > 0)
    .sort((a, b) => Number(!!b.picked) - Number(!!a.picked) || (b.capUsd ?? 0) - (a.capUsd ?? 0));
}
