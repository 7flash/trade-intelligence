/** What the web really says about one exact coin. Exa reads the pages, so no raw page reaches the model that can read this
 * machine; only short cleaned fields do, and only from pages that carry this coin's full address, because tickers are reused. */
export type CoinFacts = { what: string; who: string; flags: string[] };

const clean = (s: unknown, max = 160) => String(s ?? "").replace(/https?:\/\/\S+/g, " ").replace(/[1-9A-HJ-NP-Za-km-z]{32,}/g, " ").replace(/[^\p{L}\p{N} .,'$%()\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Exa's answer into at most a sentence each, or null when it knows nothing about this coin. */
export function coinFacts(content: unknown): CoinFacts | null {
  const c = (typeof content === "string" ? JSON.parse(content) : content) as { what?: unknown; whoBehind?: unknown; redFlags?: unknown } | null;
  const nothing = (s: string) => /no (information|data|details)|not available|nothing (is )?known|unknown token/i.test(s) ? "" : s;
  const facts = { what: nothing(clean(c?.what)), who: clean(c?.whoBehind), flags: (Array.isArray(c?.redFlags) ? c!.redFlags : []).map(f => clean(f)).filter(Boolean).slice(0, 3) };
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
