import { expect, test } from "bun:test";
import { shotArgs, takeSiteShot } from "./site-shot.ts";

test("a shot never touches his signed-in profile", () => {
  const a = shotArgs("https://x.example", "C:/o.png", "C:/tmp/site-shot-1");
  expect(a).toContain("--user-data-dir=C:/tmp/site-shot-1");
  expect(a.join(" ")).not.toContain("browser-clean");
  expect(a).toContain("--headless=new");
});
test("anything but a web address is refused", async () => expect(await takeSiteShot("file:///c:/secret", "C:/o.png")).toBeNull());
