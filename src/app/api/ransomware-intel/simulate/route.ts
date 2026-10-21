/**
 * POST /api/ransomware-intel/simulate
 * Body: { gangName, environmentId, mode?, confirmDestructive? }
 *
 * Bridge: gang's known MITRE TTPs → inferSimulations() (resolves atomic testGuids
 * from the AtomicTest catalogue) → ScenarioStep[] → materializeAdhoc → the
 * UNCHANGED runScenario. Techniques with no matching atomic test are dropped
 * (logged), never invented — preserving the catalogue-coupling safety boundary.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { inferSimulations } from "@/lib/detection-packs/infer-sims";
import { materializeAdhoc } from "@/lib/modules/materialize";
import { runScenario, type ScenarioStep } from "@/lib/enterprise-use-cases/runner";
import { getPlan, runnableChain } from "@/lib/ransomware-intel/emulation";

export async function POST(req: NextRequest, _ctx: unknown) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const gangName = String(body.gangName || "");
  const environmentId = String(body.environmentId || "");
  const mode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";
  if (!gangName) return NextResponse.json({ error: "gangName required" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId required" }, { status: 400 });

  // Authorization: the caller must own the target environment (same rule as
  // simulations/run) — never detonate on another tenant's host.
  const env = await prisma.environmentTarget.findUnique({ where: { id: environmentId }, select: { ownerId: true } });
  if (!env) return NextResponse.json({ error: "environment not found" }, { status: 404 });
  const own = ownsOr404(auth, env.ownerId);
  if (!own.ok) return own.response;

  const gang = await prisma.ransomwareGang.findUnique({ where: { name: gangName } });
  if (!gang) return NextResponse.json({ error: "gang not found" }, { status: 404 });

  // Prefer the curated, source-cited emulation plan (kill-chain ordered, gang-
  // specific procedures). Fall back to inferring atomics from knownTTPs.
  let steps: ScenarioStep[];
  let covered: string[];
  let dropped: string[];
  let techniques: string[];
  const plan = getPlan(gang.name);
  const chain = plan ? await runnableChain(plan, body.allTests === true) : [];
  if (plan && chain.length > 0) {
    steps = chain.map(({ step, atomic }) => ({
      framework: "atomic", refId: atomic.testGuid, techniqueId: atomic.techniqueId || step.techniqueId,
      displayName: `${step.order}. ${step.techniqueName} — ${atomic.testName || ""}`.slice(0, 200),
      notes: `${gang.name}: ${step.procedure}`.slice(0, 1000),
    }));
    techniques = [...new Set(plan.chain.map((s) => s.techniqueId))];
    covered = [...new Set(chain.map(({ step }) => step.techniqueId))];
    dropped = techniques.filter((t) => !covered.includes(t));
  } else {
    const ttps: Array<{ id: string }> = (() => { try { return JSON.parse(gang.knownTTPs); } catch { return []; } })();
    techniques = [...new Set(ttps.map((t) => t.id).filter((id) => /^T\d{4}(\.\d{3})?$/.test(id)))];
    if (techniques.length === 0) return NextResponse.json({ error: "gang has no MITRE techniques — enrich it first" }, { status: 400 });

    // Resolve to concrete atomic tests (testGuid). Atomic only — portable + matches the catalogue safety gate.
    const drafts = await inferSimulations({ techniques, capPerFramework: 25, relevanceHint: `${gang.name} ${gang.description}`, multiPerTechnique: false });
    const atomic = drafts.filter((d) => d.framework === "atomic" && d.refId);
    if (atomic.length === 0) return NextResponse.json({ error: "no atomic tests in the catalogue matched this gang's techniques", techniquesTried: techniques }, { status: 409 });

    steps = atomic.map((d) => ({ framework: "atomic", refId: d.refId, techniqueId: d.techniqueId, displayName: d.displayName, notes: `${gang.name}: ${d.rationale || d.techniqueId}` }));
    covered = [...new Set(atomic.map((d) => d.techniqueId))];
    dropped = techniques.filter((t) => !covered.includes(t));
  }

  const mat = await materializeAdhoc({
    label: `${gang.name} ransomware simulation`, description: `Auto-built from ${gang.name} TTPs (${covered.length}/${techniques.length} techniques mapped to atomic tests).`,
    steps, mitreTechniques: covered, ownerId: auth.user.id, sourceRef: `ransomware-gang:${gang.name}`,
  });

  try {
    const out = await runScenario({ useCaseId: mat.useCaseId, scenarioId: mat.scenarioId, environmentId, mode, actor: auth.user.email, confirmDestructive: body.confirmDestructive === true });
    void logEvent({ category: "ransomware-intel" as any, action: "intel.simulate", actor: auth.user.email, status: out.status === "success" ? "ok" : "error", targetType: "RansomwareGang", targetId: gang.name, message: `simulate ${gang.name}: ${steps.length} steps → ${out.status}` });
    return NextResponse.json({ ok: true, runId: out.runId, status: out.status, stepResults: out.stepResults, mappedTechniques: covered, droppedTechniques: dropped, stepCount: steps.length, source: plan && chain.length ? "emulation-plan" : "inferred" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "confirm_required" ? 409 : 500 });
  }
}
