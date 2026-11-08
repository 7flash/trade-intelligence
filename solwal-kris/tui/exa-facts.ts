/** What the web really says about one exact coin. Exa reads the pages, so no raw page reaches the model that can read this
 * machine; only short cleaned fields do, and only from pages that carry this coin's full address, because tickers are reused. */
export type CoinFacts = { what: string; who: string; flags: string[]; siteNow?: string | null; site?: string | null; xPost?: string | null };

const clean = (s: unknown, max = 160) => String(s ?? "").replace(/(\d)\/(\d)/g, "$1 of $2").replace(/https?:\/\/\S+/g, " ").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, " ").replace(/[^\p{L}\p{N} .,'$%()\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Exa's answer into at most a sentence each, or null when it knows nothing about this coin. */
export function coinFacts(content: unknown): CoinFacts | null {
  const c = (typeof content === "string" ? JSON.parse(content) : content) as { what?: unknown; whoBehind?: unknown; redFlags?: unknown } | null;
  const nothing = (s: string) => /no (information|data|details)|not available|nothing (is )?known|unknown token/i.test(s) ? "" : s;
  const facts = { what: nothing(clean(c?.what)), who: clean(c?.whoBehind), flags: (Array.isArray(c?.redFlags) ? c!.redFlags : []).map(f => clean(f)).filter(f => f && !/^no\b.{0,40}\b(flags?|issues?|concerns?|reported)\b/i.test(f)).slice(0, 3) };
  return facts.what || facts.who || facts.flags.length ? facts : null;
}

export async function exaFacts(mint: string, symbol: string | null, key: string, get: typeof fetch = fetch, xHandle?: string | null) {
  const r = await get("https://api.exa.ai/search", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, signal: AbortSignal.timeout(9_000), body: JSON.stringify({
    query: `What is the Solana token ${symbol ?? ""} with address ${mint}, who is behind it, and is it a rug or scam`, type: "fast", numResults: 5, moderation: true, includeText: [mint],
    systemPrompt: "Return only what is known about the token with this exact address. If nothing is known about it, leave every field empty. Never guess.",
    outputSchema: { type: "object", required: ["what", "whoBehind", "redFlags"], properties: { what: { type: "string", description: "One sentence: what the project does or is." }, whoBehind: { type: "string", description: "Team or dev if known, or empty." }, redFlags: { type: "array", items: { type: "string" }, description: "Rug or scam warnings about this exact token." } } } }) });
  if (!r.ok) throw new Error(`Exa ${r.status}`);
  const j = await r.json() as { results?: unknown[]; output?: { content?: unknown } };
  const byAddress = j.results?.length ? coinFacts(j.output?.content) : null; // no page with this address: nothing is known
  void xHandle; // Exa cannot search x.com (400/403); the linked post is read by linkedPost instead
  return byAddress;
}

/** The coin's own X account, from the token metadata the creator set: posts that mention it are about this exact coin,
 * which a bare ticker is not. Posts rarely carry the full address, so the address search found nothing for MARS (8 Nov). */
export async function tweetFacts(symbol: string | null, handle: string, key: string, get: typeof fetch = fetch) {
  const h = handle.replace(/^@/, "");
  const r = await get("https://api.exa.ai/search", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, signal: AbortSignal.timeout(9_000), body: JSON.stringify({
    query: `${symbol ?? ""} @${h} solana token: what it is, the story people are posting, who is behind it`, type: "fast", category: "tweet", numResults: 8, moderation: true, includeText: [h],
    startPublishedDate: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    systemPrompt: `Return only what these posts say about the token whose X account is @${h}. If they say nothing about it, leave every field empty. Never guess.`,
    outputSchema: { type: "object", required: ["what", "whoBehind", "redFlags"], properties: { what: { type: "string", description: "One or two sentences: what the project is and the story people are posting about it." }, whoBehind: { type: "string", description: "Team or dev if known, or empty." }, redFlags: { type: "array", items: { type: "string" }, description: "Rug or scam warnings about this token." } } } }) });
  if (!r.ok) throw new Error(`Exa ${r.status}`);
  const j = await r.json() as { results?: unknown[]; output?: { content?: unknown } };
  return j.results?.length ? coinFacts(j.output?.content) : null;
}

/** A project's own site, not a social page, an explorer or pump.fun itself. */
export const isProjectSite = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//.test(url) && !/\/\/([^/]*\.)?(pump\.fun|x\.com|twitter\.com|t\.me|telegram\.[a-z]+|discord\.[a-z]+|solscan\.io|dexscreener\.com|youtube\.com|tiktok\.com|instagram\.com)(\/|$|\?)/i.test(url);

/** X accounts read from token metadata by coinWebsite, for tweetFacts. */
export const xHandles = new Map<string, string>(), xLinks = new Map<string, string>();
const GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];
/** The website the creator gave the coin, from its token metadata. It goes to Exa and nowhere else: this machine never opens it. */
export async function coinWebsite(mint: string, rpcUrls: string[], get: typeof fetch = fetch) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } });
  let uri: string | undefined;
  for (const u of rpcUrls) {
    const j = await get(u, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(6_000), body }).then(r => r.json() as Promise<{ result?: { content?: { json_uri?: string } } }>).catch(() => null);
    uri = j?.result?.content?.json_uri; if (uri) break;
  }
  if (!uri) return null;
  const cid = /ipfs\/([A-Za-z0-9]+)/.exec(uri)?.[1];
  for (const u of cid ? GATEWAYS.map(g => g + cid) : [uri]) {
    const m = await get(u, { signal: AbortSignal.timeout(5_000) }).then(r => r.json() as Promise<{ website?: unknown; twitter?: unknown }>).catch(() => null);
    if (m) { const x = typeof m.twitter === "string" ? /(?:x|twitter)\.com\/(?:@)?([A-Za-z0-9_]{1,15})(?:[/?]|$)/i.exec(m.twitter)?.[1] ?? null : null; if (x && !/^(i|home|search|intent)$/i.test(x)) { xHandles.set(mint, x); xLinks.set(mint, String(m.twitter)); } return isProjectSite(m.website) ? m.website : null; }
  }
  return null;
}

/** What the coin's own site shows right now, read live by Exa. */
export async function siteNow(url: string, key: string, get: typeof fetch = fetch, max = 420) {
  const r = await get("https://api.exa.ai/contents", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, signal: AbortSignal.timeout(14_000), body: JSON.stringify({ urls: [url], livecrawl: "always", livecrawlTimeout: 8_000, summary: { query: "What does this site actually do, and what live numbers does it show right now, like jobs, tasks, users, revenue or payouts? List each number exactly as shown, including counts like 5/10. Be specific and short." } }) });
  if (!r.ok) throw new Error(`Exa ${r.status}`);
  const j = await r.json() as { results?: { summary?: unknown }[] };
  return clean(String(j.results?.[0]?.summary ?? "").replace(/^summary:?/i, ""), max) || null;
}

type FxTweet = { text?: string; author?: { screen_name?: string; followers?: number }; likes?: number; views?: number; created_at?: string; quote?: FxTweet; raw_text?: { facets?: { type?: string; replacement?: string }[] } };
const fx = (handle: string, id: string, get: typeof fetch) => get(`https://api.fxtwitter.com/${handle}/status/${id}`, { signal: AbortSignal.timeout(8_000) })
  .then(r => r.json() as Promise<{ tweet?: FxTweet }>).then(j => j.tweet ?? null).catch(() => null);
const statusOf = (url: string) => /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i.exec(url);

/** The X post the creator linked in the token metadata, read through fxtwitter (Exa cannot read x.com): its text, the post
 * it quotes, and X posts it links, one level deep. MARS (8 Nov) linked a post pointing at an Elon Musk reply about Mars;
 * Kris knew nothing of it and skipped the callout. Plain text only; no page is opened on this machine. */
export async function linkedPost(url: string, get: typeof fetch = fetch, max = 700) {
  const s = statusOf(url); if (!s) return null;
  const t = await fx(s[1]!, s[2]!, get); if (!t?.text) return null;
  const line = (x: FxTweet) => `@${x.author?.screen_name ?? "?"}${x.author?.followers != null ? ` (${x.author.followers} followers)` : ""}: ${String(x.text ?? "").replace(/https?:\/\/\S+/g, "").trim()}${x.views ? ` [${x.views} views, ${x.likes ?? 0} likes]` : ""}`;
  const parts = [line(t)];
  if (t.quote?.text) parts.push(`quoting ${line(t.quote)}`);
  const links = (t.raw_text?.facets ?? []).map(f => f.replacement ?? "").filter(u => /^https?:\/\//.test(u) && !/\/photo\/|\/video\//.test(u));
  for (const u of links.slice(0, 3)) {
    const ls = statusOf(u);
    if (ls) { const lt = await fx(ls[1]!, ls[2]!, get); if (lt?.text) { parts.push(`links ${line(lt)}${lt.quote?.text ? `, which quotes ${line(lt.quote)}` : ""}`); continue; } }
    parts.push(`links ${u.replace(/^https?:\/\//, "").slice(0, 80)}`);
  }
  return parts.join(" | ").replace(/\s+/g, " ").slice(0, max);
}
