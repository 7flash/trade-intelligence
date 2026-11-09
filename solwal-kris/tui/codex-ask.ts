/** Codex first, when it is available (owner, 10 Nov: "when codex is available should run through it both our platform
 * prompts and also coin callouts"). One question to the Codex CLI (`codex exec`, read-only sandbox, prompt on stdin,
 * the final answer read from --output-last-message). Returns null when Codex is not usable right now, so the caller
 * falls back to the ChatGPT bridge. A usage-limit answer ("try again at Nov 12th, 2026 11:05 AM") pauses Codex for
 * every caller on this machine until then (~/.codex-cooldown.json); CODEX_ASK=0 turns it off. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const COOLDOWN = resolve(homedir(), ".codex-cooldown.json");
const MODEL = process.env.GXY_CODEX_MODEL ?? process.env.CODEX_ASK_MODEL ?? "";

export function codexPausedUntil(): number {
  try { return Number(JSON.parse(readFileSync(COOLDOWN, "utf8")).until) || 0; } catch { return 0; }
}
function pause(until: number, why: string) {
  try { writeFileSync(COOLDOWN, JSON.stringify({ until, why: why.slice(0, 200), at: new Date().toISOString() })); } catch {}
}

/** "Nov 12th, 2026 11:05 AM" -> ms; one hour from now when no date is given. */
export function retryAt(text: string): number | null {
  if (!/usage limit|rate limit|quota|too many requests/i.test(text)) return null;
  const m = /try again at ([A-Z][a-z]{2,8} \d{1,2})(?:st|nd|rd|th)?,? (\d{4}) (\d{1,2}:\d{2} ?[AP]M)/i.exec(text);
  const t = m ? Date.parse(`${m[1]}, ${m[2]} ${m[3]}`) : NaN;
  return Number.isFinite(t) ? t : Date.now() + 3_600_000;
}

export async function askCodex(prompt: string, timeoutMs = 600_000, image?: string): Promise<string | null> {
  if (process.env.CODEX_ASK === "0" || Date.now() < codexPausedUntil()) return null;
  const dir = mkdtempSync(join(tmpdir(), "codex-ask-")), out = join(dir, "reply.txt");
  const args = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only", "-C", dir, "-o", out,
    ...(MODEL ? ["-m", MODEL] : []), ...(image && existsSync(image) ? ["-i", image] : []), "-"];
  try {
    const p = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });
    p.stdin.write(prompt); await p.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>(r => { timer = setTimeout(() => { p.kill(); r(null); }, timeoutMs); });
    const done = await Promise.race([Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]), timedOut]);
    clearTimeout(timer);
    const reply = existsSync(out) ? readFileSync(out, "utf8").trim() : "";
    if (reply) return reply;
    if (done) { const said = `${done[0]}\n${done[1]}`, until = retryAt(said); if (until) pause(until, said.match(/ERROR:[^\n]*/)?.[0] ?? "limit"); }
    return null;
  } catch {
    return null; // not installed or failed to start: the bridge answers
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
