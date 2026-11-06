/** What lets the agent open positions on his own: callouts turned into numbers, and the limits he cannot pass.
 * Callout text is written by strangers and never reaches the model: this code reads it and he gets counts. */
import { goodHolders, SLOT_CONFIG, slotRange } from "./kris-slots.ts";

export const AGENT_LIMITS = { maxPositions: 30, maxSizeSol: 0.2, minSizeSol: 0.025, reserveSol: 0.1, maxSteps: 6, minCapUsd: 5_000, stepMinSol: 0.012, reopenAfterMs: SLOT_CONFIG.reopenAfterMs,
  /** 100 tracked coins: at 25%+ bought in the first 3s, 43% fell 30% without first rising 30%, against 14% of the rest. */
  maxEarlyPct: 25,
  /** 149 tracked coins: median -19% in the first 5 minutes, -3% from 5 to 10. */
  minAgeMs: 300_000 };
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

export type CoinRisk = { bundledPct: number; earlyBoughtPct: number; top10Pct: number | null; goodHolders: number };
export function coinRisk(info: { recent?: unknown[]; earlyBoughtPct?: number | null; exact?: boolean; wallets?: { pct: number; ours?: unknown; profile?: { coins?: number; wins?: number; realizedSol?: number } | null }[] }, share: number): CoinRisk {
  const tops = (info.wallets ?? []).filter(w => w.pct > 0 && !w.ours).map(w => w.pct).sort((a, b) => b - a).slice(0, 10);
  return { bundledPct: Math.round(share * 100), earlyBoughtPct: Math.round(info.earlyBoughtPct ?? 100), top10Pct: info.exact ? Math.round(tops.reduce((a, b) => a + b, 0)) : null, goodHolders: goodHolders(info.wallets ?? []) };
}

/** The share of supply the top holders own, from the numbers in pump.fun's Holders tab: each row shows its percent, sometimes twice. */
export function topHoldersPct(text: string, top = 10) {
  const all = [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => Number(m[1])), rows = all.filter((n, i) => n !== all[i - 1]).slice(0, top);
  return rows.length >= 3 ? Math.round(rows.reduce((a, b) => a + b, 0) * 10) / 10 : null;
}

/** The whole balance over the slots left, above the reserve, never over the cap, and never so small a step cannot send. */
export function agentSize(freeSol: number, open: number, l = AGENT_LIMITS) {
  const slots = l.maxPositions - open; if (slots <= 0) return 0;
  const spare = freeSol - l.reserveSol;
  if (spare < l.minSizeSol) return 0;
  return Math.floor(Math.max(l.minSizeSol, Math.min(l.maxSizeSol, spare / slots)) * 1000) / 1000;
}
/** Why he may not open this coin, or null. No answer on bundles means no buy. */
export function refuseOpen(o: { risk: CoinRisk | null; capUsd: number | null; held: boolean; closedAgoMs: number | null; size: number; ageMs: number | null }, l = AGENT_LIMITS) {
  if (o.held) return "already held";
  if (!o.size) return "no slot or no SOL";
  if (!o.capUsd || o.capUsd < l.minCapUsd) return "cap too small";
  if (!o.risk) return "no bundle read";
  if (o.risk.bundledPct >= SLOT_CONFIG.maxBundleShare * 100) return "bundled";
  if (o.risk.earlyBoughtPct >= l.maxEarlyPct) return "bought early";
  if (o.ageMs == null || o.ageMs < l.minAgeMs) return "too new";
  if (o.closedAgoMs != null && o.closedAgoMs < l.reopenAfterMs) return "closed recently";
  return null;
}
/** The range rule he already had. Each step stays over $1, because a callout needs that much of the coin held. */
export function agentPlan(capUsd: number, size: number, l = AGENT_LIMITS) {
  const { buy, sell } = slotRange(capUsd);
  return { buy, sell, steps: Math.max(2, Math.min(l.maxSteps, Math.floor(size / l.stepMinSol))), budget: size };
}
/** A public post: no addresses and no links, whatever the model wrote. */
export const calloutText = (s: string) => s.replace(/https?:\/\/\S+/g, "").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, "").replace(/\s+/g, " ").trim().slice(0, 280);
/** The model ends an analysis with OPEN or PASS on its own line. */
export const verdictOf = (text: string) => /(^|\n)\s*OPEN\s*$/.test(text);
export const withoutVerdict = (text: string) => text.replace(/\s*\n?\s*(OPEN|OPE|OP|PASS|PAS|PA)\s*$/, "").trimEnd();
