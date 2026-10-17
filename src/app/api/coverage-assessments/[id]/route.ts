import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

// GET /api/coverage-assessments/:id — full status, metrics, and per-item results.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const a = await prisma.coverageAssessment.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const own = ownsOr404(auth, a.ownerId);
  if (!own.ok) return own.response;
  const items = await prisma.coverageAssessmentItem.findMany({
    where: { assessmentId: id }, orderBy: { order: "asc" },
    select: { tech: true, num: true, name: true, tactic: true, library: true, status: true, executed: true, observed: true, visBucket: true, obsCount: true, tail: true },
  });
  return NextResponse.json({
    ...a,
    scope: parse(a.scope), metrics: parse(a.metrics), reportPaths: parse(a.reportPaths),
    items,
  });
}

// DELETE /api/coverage-assessments/:id — remove an assessment and its items.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const a = await prisma.coverageAssessment.findUnique({ where: { id }, select: { ownerId: true } });
  if (!a) return NextResponse.json({ ok: true });
  const own = ownsOr404(auth, a.ownerId);
  if (!own.ok) return own.response;
  await prisma.coverageAssessment.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}

function parse(s: string) { try { return JSON.parse(s); } catch { return null; } }
