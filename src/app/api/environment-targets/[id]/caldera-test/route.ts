/**
 * POST /api/environment-targets/[id]/caldera-test — connectivity check for a
 * Caldera-backed agent env. Decrypts the API key, hits the Caldera v2 API, and
 * reports reachability + agent count without exposing the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { calderaHealth } from "@/lib/enterprise-use-cases/caldera-runner";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const row = await prisma.environmentTarget.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.ownerId);
  if (!owns.ok) return owns.response;

  if (row.kind !== "agent" || row.agentBackend !== "caldera") {
    return NextResponse.json({ error: "not a Caldera-backed agent environment" }, { status: 400 });
  }

  const health = await calderaHealth(row);
  // Reflect connectivity onto the row for the UI (best-effort).
  await prisma.environmentTarget.update({ where: { id }, data: { enabled: row.enabled } }).catch(() => {});
  return NextResponse.json(health, { status: health.ok ? 200 : 502 });
}
