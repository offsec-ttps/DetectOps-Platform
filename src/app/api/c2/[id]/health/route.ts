/** POST /api/c2/[id]/health — probe the C2 server; refresh status + backing target. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/lib/c2/registry";
import { registerC2AsEnvironmentTarget } from "@/lib/c2/register";
import { loadOwnedC2 } from "@/lib/c2/http";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const prov = getProvider(r.server.provider);
  if (!prov) return NextResponse.json({ ok: false, error: "unknown provider" }, { status: 400 });

  const health = await prov.health(r.server).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  // A newly-reachable server that wasn't bridged yet gets its EnvironmentTarget now.
  let envId = r.server.environmentTargetId;
  if (health.ok && !envId) envId = await registerC2AsEnvironmentTarget(r.server).catch(() => null);

  await prisma.c2Server.update({
    where: { id },
    data: {
      status: health.ok ? "online" : "error",
      lastError: health.ok ? "" : (health.error || "unreachable").slice(0, 500),
      lastSeen: health.ok ? new Date() : r.server.lastSeen,
      environmentTargetId: envId || r.server.environmentTargetId,
    },
  });
  return NextResponse.json(health);
}
