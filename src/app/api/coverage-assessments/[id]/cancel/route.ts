import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

// POST /api/coverage-assessments/:id/cancel — stop a running/queued sweep. The
// worker checks status between items and halts; completed assessments are left.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const a = await prisma.coverageAssessment.findUnique({ where: { id }, select: { status: true } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["completed", "failed", "cancelled"].includes(a.status)) return NextResponse.json({ ok: true, status: a.status });
  await prisma.coverageAssessment.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } });
  return NextResponse.json({ ok: true, status: "cancelled" });
}
