/** Browserbase: a hosted browser reached over the same CDP calls as a local one. The agent's session keeps a named
 * context so its sign-in survives; site screenshots always get a blank session with no context. */
import Browserbase from "@browserbasehq/sdk";

export const usesBrowserbase = () => !!process.env.BROWSERBASE_API_KEY;
const client = () => new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
const projectId = () => process.env.BROWSERBASE_PROJECT_ID!;

export async function openSession(contextId?: string) {
  const s = await client().sessions.create({ projectId: projectId(), ...(contextId ? { browserSettings: { context: { id: contextId, persist: true } } } : {}) });
  return { id: s.id, connectUrl: s.connectUrl };
}

/** A new tab on a browser-level socket. Returns the id every later CDP call must carry. */
export async function attachTab(ws: WebSocket, url: string) {
  let n = 0; const waits = new Map<number, (v: any) => void>();
  const call = (method: string, params: Record<string, unknown>) => new Promise<any>(r => { const id = --n; waits.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const listen = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id < 0) { waits.get(m.id)?.(m.result); waits.delete(m.id); } };
  ws.addEventListener("message", listen);
  const { targetId } = await call("Target.createTarget", { url });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  ws.removeEventListener("message", listen);
  return sessionId as string;
}

/** A blank hosted session for one website: it never shares anything with the signed-in one. */
export async function hostedShot(url: string, timeoutMs: number) {
  const session = await openSession(), ws = new WebSocket(session.connectUrl);
  try {
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    const sessionId = await attachTab(ws, url);
    await Bun.sleep(Math.min(8_000, timeoutMs / 2));
    const data = await new Promise<string | undefined>(r => {
      const timer = setTimeout(() => r(undefined), timeoutMs / 2);
      ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id === 1) { clearTimeout(timer); r(m.result?.data); } };
      ws.send(JSON.stringify({ id: 1, sessionId, method: "Page.captureScreenshot", params: { format: "png" } }));
    });
    return data ? Buffer.from(data, "base64") : null;
  } finally { ws.close(); await client().sessions.update(session.id, { projectId: projectId(), status: "REQUEST_RELEASE" }).catch(() => {}); }
}
