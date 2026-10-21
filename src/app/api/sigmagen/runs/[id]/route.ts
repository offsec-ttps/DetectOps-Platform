/**
 * GET /api/sigmagen/runs/[id] — run state for polling (steps + cost + artifact ids).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const run = await prisma.sigmaGenRun.findUnique({ where: { id }, include: { session: { select: { createdBy: true } } } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  // IDOR guard: same ownership rule as the session routes (owner = creator email; admins bypass).
  const owner = run.session?.createdBy || "";
  if (auth.enforced && auth.user.role !== "admin" && owner && owner !== auth.user.email) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let packSummary: { ruleCount: number; simulationCount: number; hasIrPlaybook: boolean } | null = null;
  if (run.detectionPackId) {
    const pack = await prisma.detectionPack.findUnique({
      where: { id: run.detectionPackId },
      include: { _count: { select: { rules: true, simulations: true } }, irPlaybook: { select: { id: true } } },
    });
    if (pack) packSummary = { ruleCount: pack._count.rules, simulationCount: pack._count.simulations, hasIrPlaybook: !!pack.irPlaybook };
  }

  return NextResponse.json({
    id: run.id,
    sessionId: run.sessionId,
    status: run.status,
    inputKind: run.inputKind,
    inputTitle: run.inputTitle,
    steps: safeJson<unknown[]>(run.steps, []),
    techniques: safeJson<string[]>(run.techniques, []),
    references: safeJson<unknown[]>(run.references, []),
    intel: safeJson<Record<string, unknown>>(run.intelJson, {}),
    guardrail: safeJson<Record<string, unknown>>(run.guardrailJson, {}),
    useCases: safeJson<unknown[]>(run.useCasesJson, []),
    detectionPackId: run.detectionPackId,
    useCaseIds: safeJson<string[]>(run.useCaseIds, []),
    costUsd: run.costUsd,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    packSummary,
  });
}
