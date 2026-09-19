/**
 * GET    /api/modules/[moduleId]  — module detail (manifest, status, validation)
 * DELETE /api/modules/[moduleId]  — uninstall (owner/admin only)
 * PATCH  /api/modules/[moduleId]  — enable/disable (owner/admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

async function load(moduleId: string) {
  return prisma.simulationModule.findUnique({
    where: { moduleId },
    include: { versions: { orderBy: { createdAt: "desc" } }, validations: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const row = await load(moduleId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let manifest: any = null;
  try { manifest = JSON.parse(row.manifest); } catch {}
  const latestValidation = row.validations[0] || null;
  return NextResponse.json({
    id: row.id, moduleId: row.moduleId, name: row.name, version: row.version, category: row.category,
    description: row.description, author: row.author, icon: row.icon, status: row.status,
    signatureState: row.signatureState, enabled: row.enabled, ownerId: row.ownerId,
    permissions: JSON.parse(row.permissions || "{}"), manifest,
    versions: row.versions.map((v) => ({ version: v.version, status: v.status, createdAt: v.createdAt, changelog: v.changelog })),
    validation: latestValidation && {
      status: latestValidation.status, verdict: latestValidation.verdict,
      checks: JSON.parse(latestValidation.checks || "[]"),
      aiReview: JSON.parse(latestValidation.aiReview || "{}"),
      completedAt: latestValidation.completedAt,
    },
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const row = await prisma.simulationModule.findUnique({ where: { moduleId } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.ownerId);
  if (!owns.ok) return owns.response;

  await prisma.simulationModule.delete({ where: { moduleId } });
  void logEvent({ category: "module" as any, action: "module.uninstall", actor: auth.user.email, status: "ok", targetType: "SimulationModule", targetId: row.id, message: `${moduleId} uninstalled` });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const row = await prisma.simulationModule.findUnique({ where: { moduleId } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.ownerId);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const updated = await prisma.simulationModule.update({ where: { moduleId }, data });
  return NextResponse.json({ ok: true, enabled: updated.enabled });
}
