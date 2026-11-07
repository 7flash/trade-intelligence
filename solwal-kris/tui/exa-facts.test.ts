import { expect, test } from "bun:test";
import { coinFacts, exaFacts } from "./exa-facts.ts";

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
