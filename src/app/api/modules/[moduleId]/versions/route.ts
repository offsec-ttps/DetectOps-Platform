/**
 * GET /api/modules/[moduleId]/versions — version history for a module.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const row = await prisma.simulationModule.findUnique({ where: { moduleId }, select: { id: true, version: true } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const versions = await prisma.moduleVersion.findMany({ where: { moduleRowId: row.id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    current: row.version,
    versions: versions.map((v) => ({ version: v.version, status: v.status, changelog: v.changelog, contentHash: v.contentHash, createdAt: v.createdAt })),
  });
}
