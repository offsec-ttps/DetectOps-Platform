/**
 * POST /api/enterprise-use-cases/[id]/recommend
 *
 * Run the deterministic synthesizer to produce a `recommendedDetectionLogic`
 * body. Stable across regens (deterministic UUID derived from the use case
 * id). If the use case's status is "imported", bump it to "mapped" — the
 * recommendation has now been computed.
 *
 * Returns: { id, recommendedDetectionLogic, isAlreadySigma, notes, status }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { synthesizeRecommended } from "@/lib/enterprise-use-cases/recommend-logic";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = synthesizeRecommended({
    useCaseId: row.id,
    name: row.name,
    description: row.description,
    originalDetectionLogic: row.originalDetectionLogic,
    format: row.format,
    severity: row.severity,
    platforms: safeJson<string[]>(row.platforms, []),
    owner: row.owner,
    mitreTechniques: safeJson<string[]>(row.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(row.mitreTactics, []),
  });

  const nextStatus = row.status === "imported" ? "mapped" : row.status;
  const updated = await prisma.enterpriseUseCase.update({
    where: { id },
    data: {
      recommendedDetectionLogic: result.body,
      status: nextStatus,
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.recommend",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `recommended logic synthesized · isAlreadySigma=${result.isAlreadySigma} · status=${nextStatus}`,
    details: { isAlreadySigma: result.isAlreadySigma, noteCount: result.notes.length, bodyLength: result.body.length },
  });

  return NextResponse.json({
    id: updated.id,
    recommendedDetectionLogic: result.body,
    isAlreadySigma: result.isAlreadySigma,
    notes: result.notes,
    status: updated.status,
  });
}
