/**
 * Fast TCP reachability probe for a C2 server, so the dashboard reflects REAL
 * liveness instead of the last-persisted status (a stopped/dead Caldera or an
 * off host would otherwise keep showing "running").
 */

import net from "node:net";
import type { C2Server } from "@/generated/prisma/client";

export function probeReachable(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; try { sock.destroy(); } catch { /* noop */ } resolve(ok); };
    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

/**
 * Compute the effective (live) status for a C2 server by probing its URL. Leaves
 * transitional states (installing/starting/deploying) untouched. Returns the
 * effective status string, or null when it can't/shouldn't probe (caller keeps
 * the stored status).
 */
export async function liveC2Status(s: Pick<C2Server, "status" | "url" | "mode">, timeoutMs = 2500): Promise<string | null> {
  if (["installing", "starting", "deploying"].includes(s.status)) return null;
  if (!s.url) return null;
  let host = "", port = 0;
  try { const u = new URL(s.url); host = u.hostname; port = Number(u.port) || (u.protocol === "https:" ? 443 : 80); }
  catch { return null; }
  const up = await probeReachable(host, port, timeoutMs);
  return up ? (s.mode === "managed" ? "running" : "online") : (s.mode === "managed" ? "stopped" : "offline");
}
