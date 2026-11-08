import { expect, test } from "bun:test";
import { shotArgs, takeSiteShot } from "./site-shot.ts";

test("a shot never touches his signed-in profile", () => {
  const a = shotArgs("https://x.example", "C:/o.png", "C:/tmp/site-shot-1");
  expect(a).toContain("--user-data-dir=C:/tmp/site-shot-1");
  expect(a.join(" ")).not.toContain("browser-clean");
  expect(a).toContain("--headless=new");
});
test("anything but a web address is refused", async () => expect(await takeSiteShot("file:///c:/secret", "C:/o.png")).toBeNull());

test("a bot check page is never taken as the project's site", async () => {
  const { isBotCheck } = await import("./site-shot.ts");
  expect(isBotCheck("<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/h/b'></script>")).toBe(true);
  expect(isBotCheck("<h1>Verify you are human by completing the action below.</h1>")).toBe(true);
  expect(isBotCheck("<h1>Knight</h1><p>The bravest coin on Solana.</p>")).toBe(false);
});
