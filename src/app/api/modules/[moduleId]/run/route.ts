/**
 * POST /api/modules/[moduleId]/run
 * Body: { scenarioName, environmentId, mode?: "simulate-only"|"simulate-and-validate", confirmDestructive? }
 *
 * Materializes the module's scenario into a backing EnterpriseUseCase + scenario,
 * then runs it through the UNCHANGED runner (runScenario). Proves a module
 * executes via the existing dispatch matrix with no runner edits.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { materializeScenario } from "@/lib/modules/materialize";
import { runScenario } from "@/lib/enterprise-use-cases/runner";

export async function POST(req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const scenarioName = String(body.scenarioName || "");
  const environmentId = String(body.environmentId || "");
  const mode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";
  if (!scenarioName) return NextResponse.json({ error: "scenarioName required" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId required" }, { status: 400 });

  // Only live (validated/approved) modules may be run by anyone; a draft /
  // rejected / pending module may only be run by its own publisher (or admin).
  const mod = await prisma.simulationModule.findUnique({ where: { moduleId }, select: { status: true, ownerId: true } });
  if (!mod) return NextResponse.json({ error: "module not found" }, { status: 404 });
  if (mod.status !== "live") {
    const own = ownsOr404(auth, mod.ownerId);
    if (!own.ok) return NextResponse.json({ error: `module is ${mod.status}; only live modules can be run` }, { status: 409 });
  }
  // Confused-deputy guard: the caller must own the environment they detonate against.
  const env = await prisma.environmentTarget.findUnique({ where: { id: environmentId }, select: { ownerId: true } });
  if (!env) return NextResponse.json({ error: "environment not found" }, { status: 404 });
  const envOwn = ownsOr404(auth, env.ownerId);
  if (!envOwn.ok) return envOwn.response;

  const mat = await materializeScenario({ moduleId, scenarioName, ownerId: auth.user.id });
  if (!mat.ok) return NextResponse.json({ error: mat.error }, { status: 400 });

  try {
    const out = await runScenario({
      useCaseId: mat.useCaseId, scenarioId: mat.scenarioId, environmentId,
      mode, actor: auth.user.email, confirmDestructive: body.confirmDestructive === true,
    });
    void logEvent({ category: "module" as any, action: "module.run", actor: auth.user.email, status: out.status === "success" ? "ok" : "error", targetType: "SimulationModule", targetId: moduleId, message: `${moduleId} · ${scenarioName} → ${out.status}` });
    return NextResponse.json({ ok: true, runId: out.runId, status: out.status, stepResults: out.stepResults, validationOutcome: out.validationOutcome });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "confirm_required" ? 409 : 500 });
  }
}
