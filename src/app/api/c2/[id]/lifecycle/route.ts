/**
 * POST /api/c2/[id]/lifecycle  { action: "start" | "stop" }
 *
 * Start/stop a MANAGED C2 server. The server is installed (built) once and only
 * goes live on demand, so it consumes no runtime resources while stopped.
 * Start is fire-and-forget (status starting → running); the client polls
 * GET /api/c2/[id]. On start we verify the API key works, then bridge the
 * backing EnvironmentTarget so simulations can target it.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/lib/c2/registry";
import { getC2CatalogEntry } from "@/config/c2-catalog";
import { registerC2AsEnvironmentTarget } from "@/lib/c2/register";
import { logEvent } from "@/lib/event-log";
import { loadOwnedC2 } from "@/lib/c2/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const { server } = r;

  if (server.mode !== "managed" || !server.deploymentId) {
    return NextResponse.json({ error: "start/stop only applies to a managed (deployed) C2 server" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action !== "start" && action !== "stop") return NextResponse.json({ error: 'action must be "start" or "stop"' }, { status: 400 });

  // Optional: choose which host address to advertise to beacons (the console URL
  // + enrollment one-liner target). Caldera binds 0.0.0.0, so no rebind needed.
  const advertiseHost = String(body.advertiseHost || "").trim();
  if (action === "start" && advertiseHost) {
    const port = (() => { try { return new URL(server.url).port || "8888"; } catch { return "8888"; } })();
    await prisma.c2Server.update({ where: { id }, data: { advertiseHost, url: `http://${advertiseHost}:${port}` } });
    server.advertiseHost = advertiseHost; server.url = `http://${advertiseHost}:${port}`;
  }

  const prov = getProvider(server.provider);
  // Route start/stop to the engine that installed this server: the generic
  // Docker engine for first-wave catalog frameworks, else the native Caldera one.
  const isDocker = getC2CatalogEntry(server.provider)?.deploy.method === "docker";
  const doStart = async () => {
    if (isDocker) { const m = await import("@/lib/c2/deploy-generic"); await m.startGeneric(server.provider, server.deploymentId!, server.advertiseHost); }
    else { const m = await import("@/lib/c2/deploy-caldera"); await m.startCaldera(server.deploymentId!); }
  };
  const doStop = async () => {
    if (isDocker) { const m = await import("@/lib/c2/deploy-generic"); await m.stopGeneric(server.provider, server.deploymentId!); }
    else { const m = await import("@/lib/c2/deploy-caldera"); await m.stopCaldera(server.deploymentId!); }
  };

  if (action === "stop") {
    try {
      await doStop();
      await prisma.c2Server.update({ where: { id }, data: { status: "stopped", lastError: "" } });
      void logEvent({ category: "bas", action: "c2.stop", actor: r.auth.user.email, status: "ok", targetType: "C2Server", targetId: id, message: `stopped ${server.name}` });
      return NextResponse.json({ ok: true, status: "stopped" });
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
    }
  }

  // start — fire-and-forget; client polls status
  await prisma.c2Server.update({ where: { id }, data: { status: "starting", lastError: "" } });
  void (async () => {
    try {
      await doStart();
      const health = prov ? await prov.health(server).catch(() => ({ ok: false, error: "health failed" })) : { ok: false };
      let envId = server.environmentTargetId;
      if (!envId) envId = await registerC2AsEnvironmentTarget(server).catch(() => null);
      await prisma.c2Server.update({
        where: { id },
        data: { status: "running", lastSeen: health.ok ? new Date() : null, environmentTargetId: envId || server.environmentTargetId },
      });
      void logEvent({ category: "bas", action: "c2.start", actor: r.auth.user.email, status: "ok", targetType: "C2Server", targetId: id, message: `started ${server.name}` });
    } catch (e: any) {
      await prisma.c2Server.update({ where: { id }, data: { status: "error", lastError: String(e?.message || e).slice(0, 500) } }).catch(() => {});
    }
  })();
  return NextResponse.json({ ok: true, status: "starting" }, { status: 202 });
}
