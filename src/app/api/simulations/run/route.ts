/**
 * POST /api/simulations/run — generic "simulate these techniques" bridge.
 * Body: { techniques: string[], environmentId, label?, sourceRef?, mode?, confirmDestructive? }
 *
 * techniques → inferSimulations() (resolves atomic testGuids from the catalogue)
 * → ScenarioStep[] → materializeAdhoc → unchanged runScenario. Same safety gate
 * as the gang simulator: unmatched techniques are dropped, never invented.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { inferSimulations } from "@/lib/detection-packs/infer-sims";
import { materializeAdhoc } from "@/lib/modules/materialize";
import { runScenario, type ScenarioStep } from "@/lib/enterprise-use-cases/runner";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const techniques = [...new Set((Array.isArray(body.techniques) ? body.techniques : []).map(String).filter((t: string) => /^T\d{4}(\.\d{3})?$/.test(t)))];
  const environmentId = String(body.environmentId || "");
  const label = String(body.label || "Technique simulation");
  const mode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";
  if (techniques.length === 0) return NextResponse.json({ error: "no valid techniques provided" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId required" }, { status: 400 });

  const drafts = await inferSimulations({ techniques, capPerFramework: 25, relevanceHint: label, multiPerTechnique: false });
  const atomic = drafts.filter((d) => d.framework === "atomic" && d.refId);
  if (atomic.length === 0) return NextResponse.json({ error: "no atomic tests in the catalogue matched these techniques", techniquesTried: techniques }, { status: 409 });

  const steps: ScenarioStep[] = atomic.map((d) => ({ framework: "atomic", refId: d.refId, techniqueId: d.techniqueId, displayName: d.displayName, notes: d.rationale || d.techniqueId }));
  const covered = [...new Set(atomic.map((d) => d.techniqueId))];

  const mat = await materializeAdhoc({ label, description: `${covered.length}/${techniques.length} techniques mapped to atomic tests.`, steps, mitreTechniques: covered, ownerId: auth.user.id, sourceRef: String(body.sourceRef || "simulation:adhoc") });

  try {
    const out = await runScenario({ useCaseId: mat.useCaseId, scenarioId: mat.scenarioId, environmentId, mode, actor: auth.user.email, confirmDestructive: body.confirmDestructive === true });
    void logEvent({ category: "enterprise-uc" as any, action: "simulation.run", actor: auth.user.email, status: out.status === "success" ? "ok" : "error", message: `${label}: ${steps.length} steps → ${out.status}` });
    return NextResponse.json({ ok: true, runId: out.runId, status: out.status, stepResults: out.stepResults, mappedTechniques: covered, droppedTechniques: techniques.filter((t) => !covered.includes(t)), stepCount: steps.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "confirm_required" ? 409 : 500 });
  }
}
