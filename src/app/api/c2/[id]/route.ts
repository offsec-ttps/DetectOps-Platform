/**
 * GET    /api/c2/[id] — one C2 server (status + latest health)
 * DELETE /api/c2/[id] — remove it: managed → tear the container down;
 *                       connect → forget it. Always drops the backing target.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unregisterC2EnvironmentTarget } from "@/lib/c2/register";
import { getC2CatalogEntry } from "@/config/c2-catalog";
import { logEvent } from "@/lib/event-log";
import { serializeC2, loadOwnedC2 } from "@/lib/c2/http";
import { liveC2Status } from "@/lib/c2/liveness";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  let s = r.server;
  // Reflect real liveness (don't report "running" for a dead/off server).
  const effective = await liveC2Status(s).catch(() => null);
  if (effective && effective !== s.status) {
    s = await prisma.c2Server.update({ where: { id }, data: { status: effective, lastError: effective === "offline" || effective === "stopped" ? (s.lastError || "unreachable") : "" } }).catch(() => s);
  }
  // Detail includes the managed UI login (local-lab cred, like Integration creds)
  // so the /caldera page can show how to sign in to the Caldera web console.
  return NextResponse.json({
    server: serializeC2(s),
    webUrl: s.url || "",
    adminUser: s.adminUser || "",
    adminPassword: s.adminPassword || "",
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const { server } = r;

  let teardown = "record removed";
  if (server.mode === "managed" && server.deploymentId) {
    const isDocker = getC2CatalogEntry(server.provider)?.deploy.method === "docker";
    try {
      if (isDocker) {
        const { teardownGeneric } = await import("@/lib/c2/deploy-generic");
        await teardownGeneric(server.provider, server.deploymentId);
      } else {
        const { teardownCaldera } = await import("@/lib/c2/deploy-caldera");
        await teardownCaldera(server.deploymentId);
      }
      teardown = "container stopped + removed";
    } catch (e: any) {
      teardown = `container teardown warning: ${e?.message || e}`;
    }
  }

  await unregisterC2EnvironmentTarget(server.environmentTargetId);
  await prisma.c2Server.delete({ where: { id } });

  void logEvent({
    category: "bas", action: "c2.delete", actor: r.auth.user.email, status: "ok",
    targetType: "C2Server", targetId: id, message: `deleted C2 "${server.name}" (${teardown})`,
  });
  return NextResponse.json({ ok: true, teardown });
}
