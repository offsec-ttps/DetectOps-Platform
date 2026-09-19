/**
 * GET /api/enterprise-use-cases/[id]/runs/[runId]
 *
 * Single-run detail with full merged logs (capped to 32k via runner.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await ctx.params;
  const run = await prisma.enterpriseUseCaseRun.findUnique({ where: { id: runId } });
  if (!run || run.useCaseId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [env, scenario] = await Promise.all([
    run.environmentId ? prisma.environmentTarget.findUnique({ where: { id: run.environmentId }, select: { id: true, name: true, kind: true } }) : null,
    run.scenarioId ? prisma.enterpriseUseCaseScenario.findUnique({ where: { id: run.scenarioId }, select: { id: true, ordinal: true, name: true } }) : null,
  ]);

  return NextResponse.json({
    id: run.id,
    useCaseId: run.useCaseId,
    scenarioId: run.scenarioId,
    environmentId: run.environmentId,
    scenario,
    environment: env,
    testedLogicChoice: run.testedLogicChoice,
    mode: run.mode,
    status: run.status,
    validationOutcome: run.validationOutcome,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    stepResults: safeJson<unknown[]>(run.stepResults, []),
    logs: run.logs,
    detectionResults: safeJson<unknown[]>(run.detectionResults, []),
    actor: run.actor,
    createdAt: run.createdAt,
  });
}
