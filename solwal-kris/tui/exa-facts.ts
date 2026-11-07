/** What the web really says about one exact coin. Exa reads the pages, so no raw page reaches the model that can read this
 * machine; only short cleaned fields do, and only from pages that carry this coin's full address, because tickers are reused. */
export type CoinFacts = { what: string; who: string; flags: string[]; siteNow?: string | null; site?: string | null };

const clean = (s: unknown, max = 160) => String(s ?? "").replace(/(\d)\/(\d)/g, "$1 of $2").replace(/https?:\/\/\S+/g, " ").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, " ").replace(/[^\p{L}\p{N} .,'$%()\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Exa's answer into at most a sentence each, or null when it knows nothing about this coin. */
export function coinFacts(content: unknown): CoinFacts | null {
  const c = (typeof content === "string" ? JSON.parse(content) : content) as { what?: unknown; whoBehind?: unknown; redFlags?: unknown } | null;
  const nothing = (s: string) => /no (information|data|details)|not available|nothing (is )?known|unknown token/i.test(s) ? "" : s;
  const facts = { what: nothing(clean(c?.what)), who: clean(c?.whoBehind), flags: (Array.isArray(c?.redFlags) ? c!.redFlags : []).map(f => clean(f)).filter(f => f && !/^no\b.{0,40}\b(flags?|issues?|concerns?|reported)\b/i.test(f)).slice(0, 3) };
  return facts.what || facts.who || facts.flags.length ? facts : null;
}

export async function exaFacts(mint: string, symbol: string | null, key: string, get: typeof fetch = fetch) {
  const r = await get("https://api.exa.ai/search", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, signal: AbortSignal.timeout(9_000), body: JSON.stringify({
    query: `What is the Solana token ${symbol ?? ""} with address ${mint}, who is behind it, and is it a rug or scam`, type: "fast", numResults: 5, moderation: true, includeText: [mint],
    systemPrompt: "Return only what is known about the token with this exact address. If nothing is known about it, leave every field empty. Never guess.",
    outputSchema: { type: "object", required: ["what", "whoBehind", "redFlags"], properties: { what: { type: "string", description: "One sentence: what the project does or is." }, whoBehind: { type: "string", description: "Team or dev if known, or empty." }, redFlags: { type: "array", items: { type: "string" }, description: "Rug or scam warnings about this exact token." } } } }) });
  if (!r.ok) throw new Error(`Exa ${r.status}`);
  const j = await r.json() as { results?: unknown[]; output?: { content?: unknown } };
  return j.results?.length ? coinFacts(j.output?.content) : null; // no page with this address: nothing is known
}

/** A project's own site, not a social page, an explorer or pump.fun itself. */
export const isProjectSite = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//.test(url) && !/\/\/([^/]*\.)?(pump\.fun|x\.com|twitter\.com|t\.me|telegram\.[a-z]+|discord\.[a-z]+|solscan\.io|dexscreener\.com|youtube\.com|tiktok\.com|instagram\.com)(\/|$|\?)/i.test(url);

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
    const m = await get(u, { signal: AbortSignal.timeout(5_000) }).then(r => r.json() as Promise<{ website?: unknown }>).catch(() => null);
    if (m) return isProjectSite(m.website) ? m.website : null;
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
