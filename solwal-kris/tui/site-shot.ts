/** A picture of a coin's website for its callout. Creators choose these sites, so they never open in his signed-in browser: each
 * shot is a separate headless browser on an empty profile that is deleted afterwards, and it never sees the wallet. */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
/** A blank or error page compresses to almost nothing; a real site does not. */
export const MIN_SHOT_BYTES = 20_000;

export const shotArgs = (url: string, out: string, profile: string) => ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", "--hide-scrollbars",
  `--user-data-dir=${profile}`, "--window-size=1200,1300", "--virtual-time-budget=8000", `--screenshot=${out}`, url];

export async function takeSiteShot(url: string, out: string, timeoutMs = 25_000) {
  if (!/^https?:\/\//.test(url)) return null;
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const profile = mkdtempSync(join(tmpdir(), "site-shot-"));
  try {
    const p = Bun.spawn([EDGE, ...shotArgs(url, out, profile)], { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    await p.exited; clearTimeout(timer);
    return (statSync(out, { throwIfNoEntry: false })?.size ?? 0) >= MIN_SHOT_BYTES ? out : null;
  } finally {
    for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await Bun.sleep(400); } }
  }
}
