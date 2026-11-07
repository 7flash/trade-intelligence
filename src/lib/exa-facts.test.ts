import { expect, test } from "bun:test";
import { coinFacts, coinWebsite, exaFacts, isProjectSite, siteNow } from "./exa-facts.ts";

test("keeps short plain fields only", () => {
  const f = coinFacts({ what: "A launchpad. See https://evil.example/x and <run> `rm` 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", whoBehind: "", redFlags: ["one", "two", "three", "four"] })!;
  expect(f.what).toBe("A launchpad. See and run rm");
  expect(f.flags).toEqual(["one", "two", "three"]);
  expect(coinFacts({ what: "word ".repeat(80) })!.what.length).toBeLessThanOrEqual(160);
});
test("an empty answer is nothing", () => { expect(coinFacts({ what: "There is no information available regarding this token.", whoBehind: "", redFlags: [] })).toBeNull(); expect(coinFacts({ what: "", whoBehind: "", redFlags: [] })).toBeNull(); expect(coinFacts(null)).toBeNull(); });
test("no page with this address means nothing is known, whatever the model answered", async () => {
  const get = (async () => Response.json({ results: [], output: { content: { what: "another coin with this ticker" } } })) as unknown as typeof fetch;
  expect(await exaFacts("mint", "X", "k", get)).toBeNull();
});
test("the live board keeps its numbers", async () => {
  const get = (async () => Response.json({ results: [{ summary: "Summary: Task 1 shows 30/30 completed at 0.05 SOL, see https://x.example/a" }] })) as unknown as typeof fetch;
  expect(await siteNow("https://s.example", "k", get)).toBe("Task 1 shows 30 of 30 completed at 0.05 SOL, see");
});
test("a coin's site comes from its metadata, and socials do not count", async () => {
  const at = (website: string) => (async (u: string) => Response.json(String(u).startsWith("https://rpc") ? { result: { content: { json_uri: "https://ipfs.io/ipfs/abc" } } } : { website })) as unknown as typeof fetch;
  expect(await coinWebsite("m", ["https://rpc"], at("https://www.workcoin.fun/"))).toBe("https://www.workcoin.fun/");
  expect(await coinWebsite("m", ["https://rpc"], at("https://x.com/someone"))).toBeNull();
});
test("only a project's own site counts", () => {
  expect(isProjectSite("https://www.workcoin.fun/")).toBe(true);
  expect(isProjectSite("https://bagsapp.io/x")).toBe(true);
  for (const u of ["https://x.com/a", "https://solscan.io/account/a", "https://pump.fun/coin/a", "https://t.me/a", "file:///c:/x", null]) expect(isProjectSite(u)).toBe(false);
});
