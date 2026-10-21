/**
 * POST /api/enterprise-use-cases/[id]/scenarios/auto-suggest
 *
 * Build 1-4 scenario drafts from the use case's MITRE techniques (one per
 * framework with matches + a manual fallback when nothing matched). Persists
 * each as an EnterpriseUseCaseScenario row with `source="auto"`.
 *
 * Body: { replaceExisting?: boolean }  (default: false; appends)
 *
 * Lifecycle:
 *   - if status was "imported" or "mapped" and any scenario gets created,
 *     status flips to "scenarios-defined".
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { buildAutoScenarios } from "@/lib/enterprise-use-cases/auto-scenarios";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const replaceExisting = body.replaceExisting === true;

  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const techniques = safeJson<string[]>(uc.mitreTechniques, []);
  const drafts = await buildAutoScenarios({
    techniques,
    useCaseName: uc.name,
    // Bias ranking with the use case's description + body so simulation
    // picks land on the right variants for what the use case actually
    // describes (e.g. "certutil" → the certutil-specific ART test).
    relevanceHint: [
      uc.description,
      uc.originalDetectionLogic.slice(0, 2000),
      uc.recommendedDetectionLogic.slice(0, 2000),
    ].join(" "),
  });

  if (replaceExisting) {
    await prisma.enterpriseUseCaseScenario.deleteMany({
      where: { useCaseId: id, source: "auto" },
    });
  }

  // Pick next ordinal
  const last = await prisma.enterpriseUseCaseScenario.findFirst({
    where: { useCaseId: id }, orderBy: { ordinal: "desc" }, select: { ordinal: true },
  });
  let nextOrdinal = (last?.ordinal ?? 0) + 1;

  const created: Array<{ id: string; ordinal: number; name: string; stepCount: number }> = [];
  for (const d of drafts) {
    const ordinal = nextOrdinal++;
    const row = await prisma.enterpriseUseCaseScenario.create({
      data: {
        useCaseId: id,
        ordinal,
        name: d.name.slice(0, 240),
        description: d.description.slice(0, 2000),
        steps: JSON.stringify(d.steps),
        source: "auto",
      },
    });
    created.push({ id: row.id, ordinal: row.ordinal, name: row.name, stepCount: d.steps.length });
  }

  if (created.length > 0 && (uc.status === "imported" || uc.status === "mapped")) {
    await prisma.enterpriseUseCase.update({
      where: { id }, data: { status: "scenarios-defined" },
    });
  }

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.scenario.auto-suggest",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `${created.length} scenario(s) auto-suggested (replaceExisting=${replaceExisting})`,
    details: { useCaseId: id, replaceExisting, scenariosCreated: created.length, techniqueCount: techniques.length, scenarioStepCounts: created.map((c) => c.stepCount) },
  });

  return NextResponse.json({
    created,
    techniques,
    replaceExisting,
  });
}
