/**
 * POST /api/modules/[moduleId]/approve — manual approve a needs-human module.
 * Admin only. Flips an `approved` module to `live`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const decision = body.decision === "reject" ? "reject" : "approve";

  const row = await prisma.simulationModule.findUnique({ where: { moduleId } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["approved", "submitted", "validating", "rejected"].includes(row.status)) {
    return NextResponse.json({ error: `module is ${row.status}, cannot manually decide` }, { status: 409 });
  }

  const newStatus = decision === "reject" ? "rejected" : "live";
  await prisma.simulationModule.update({ where: { moduleId }, data: { status: newStatus, installedAt: newStatus === "live" ? new Date() : row.installedAt } });
  if (newStatus === "live") await prisma.moduleVersion.updateMany({ where: { moduleRowId: row.id, version: row.version }, data: { status: "published" } });

  void logEvent({ category: "module" as any, action: "module.approve", actor: auth.user.email, status: "ok", targetType: "SimulationModule", targetId: row.id, message: `${moduleId} manually ${decision === "reject" ? "rejected" : "approved → live"}` });
  return NextResponse.json({ ok: true, status: newStatus });
}
