import { expect, test } from "bun:test";
import { pickCoin, remember } from "./pump-tour.ts";

const a = "EFWotn2UtV2cAAAAAAAAAAAAAAAAAAAAAAAAAApump", b = "GdY4Z6pYUcr3AAAAAAAAAAAAAAAAAAAAAAAAAApump", c = "C5xph2yL6gMdAAAAAAAAAAAAAAAAAAAAAAAAAApump";
const hrefs = [`/coin/${a}`, `/coin/${b}`, `/coin/${c}?highlight_callout=49044925-1581-4a3b`, "/coin/imeme.nearlytrade.near?highlight_callout=c629", "/coin/0x94641b9701aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/perps", "https://evil.example/coin/x"];

test("hot takes trending coins, callouts take called-out coins", () => {
  expect(pickCoin("hot", hrefs, [])).toBe(`/coin/${a}`);
  expect(pickCoin("callout", hrefs, [])).toBe(`/coin/${c}?highlight_callout=49044925-1581-4a3b`);
});
test("skips coins seen lately", () => {
  expect(pickCoin("hot", hrefs, [a])).toBe(`/coin/${b}`);
  expect(pickCoin("hot", hrefs, [a, b])).toBeNull();
});
test("a coin seen through a callout counts as seen on trending too", () => {
  expect(pickCoin("hot", [`/coin/${c}`], remember([], `/coin/${c}?highlight_callout=x`))).toBeNull();
});
test("never picks a link that is not a Solana coin page", () => {
  expect(pickCoin("callout", ["/coin/imeme.nearlytrade.near?highlight_callout=c629", "/go", "/mayhem"], [])).toBeNull();
  expect(pickCoin("hot", ["/coin/0x94641b9701aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/live"], [])).toBeNull();
});
test("remembers only the latest coins", () => {
  let r: string[] = [];
  for (let i = 0; i < 20; i++) r = remember(r, `/coin/m${i}`);
  expect(r.length).toBe(12);
  expect(r[r.length - 1]).toBe("m19");
});
