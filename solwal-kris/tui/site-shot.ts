/** A picture of a coin's website for its callout. Creators choose these sites, so they never open in his signed-in browser: each
 * shot is a separate headless browser on an empty profile that is deleted afterwards, and it never sees the wallet. */
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
/** A blank or error page compresses to almost nothing; a real site does not. */
export const MIN_SHOT_BYTES = 20_000;

export const shotArgs = (url: string, out: string, profile: string, height = 1300) => ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", "--hide-scrollbars",
  `--user-data-dir=${profile}`, `--window-size=1200,${height}`, "--virtual-time-budget=8000", `--screenshot=${out}`, url];

/** A challenge page instead of the site: Cloudflare's "Just a moment", captchas, "verify you are human". */
export const isBotCheck = (html: string) => /just a moment|verify (that )?you are (a )?human|checking (if the site connection is secure|your browser)|cf-chl|challenge-platform|attention required|captcha|are you a robot/i.test(html.slice(0, 200_000));

export async function takeSiteShot(url: string, out: string, timeoutMs = 25_000, height = 1300) {
  if (!/^https?:\/\//.test(url)) return null;
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  const profile = mkdtempSync(join(tmpdir(), "site-shot-"));
  try {
    // A bot check (Cloudflare and the like) is not the project's site: no picture rather than a captcha (owner, 8 Nov).
    const dom = Bun.spawn([EDGE, "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=6000", "--dump-dom", url], { stdout: "pipe", stderr: "ignore" });
    const domTimer = setTimeout(() => dom.kill(), timeoutMs);
    const html = await new Response(dom.stdout).text().catch(() => ""); clearTimeout(domTimer);
    if (isBotCheck(html)) return null;
    const p = Bun.spawn([EDGE, ...shotArgs(url, out, profile, height)], { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    await p.exited; clearTimeout(timer);
    return (statSync(out, { throwIfNoEntry: false })?.size ?? 0) >= MIN_SHOT_BYTES ? out : null;
  } finally {
    for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await Bun.sleep(400); } }
  }
}
