/**
 * POST /api/phishing/campaigns/[id]/launch
 * Body: { environmentId, mode?: "simulate-only"|"simulate-and-validate", confirmDestructive? }
 *
 * Gated: campaign MUST be `approved`. Launch runs the campaign's phishing ATT&CK
 * techniques through the EXISTING safe runner (inferSimulations → materializeAdhoc
 * → runScenario) — producing detection telemetry/results. No live phishing server
 * is spun up here; the framework (Mode B) is catalogued + operator-deployed.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { inferSimulations } from "@/lib/detection-packs/infer-sims";
import { materializeAdhoc } from "@/lib/modules/materialize";
import { runScenario, type ScenarioStep } from "@/lib/enterprise-use-cases/runner";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const environmentId = String(body.environmentId || "");
  const mode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";

  const c = await prisma.phishingCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.status !== "approved") return NextResponse.json({ error: `campaign must be approved before launch (is ${c.status})` }, { status: 409 });
  if (!environmentId) return NextResponse.json({ error: "environmentId required" }, { status: 400 });

  const techniques = (() => { try { return JSON.parse(c.techniques) as string[]; } catch { return []; } })();
  const drafts = await inferSimulations({ techniques, capPerFramework: 25, relevanceHint: `phishing ${c.name}`, multiPerTechnique: false });
  const atomic = drafts.filter((d) => d.framework === "atomic" && d.refId);
  if (atomic.length === 0) return NextResponse.json({ error: "no atomic tests matched this campaign's phishing techniques", techniquesTried: techniques }, { status: 409 });

  const steps: ScenarioStep[] = atomic.map((d) => ({ framework: "atomic", refId: d.refId, techniqueId: d.techniqueId, displayName: d.displayName, notes: d.rationale || d.techniqueId }));
  const covered = [...new Set(atomic.map((d) => d.techniqueId))];

  await prisma.phishingCampaign.update({ where: { id }, data: { status: "running", launchedAt: new Date() } });
  void logEvent({ category: "phishing" as any, action: "phishing.campaign.launch", actor: auth.user.email, status: "ok", targetType: "PhishingCampaign", targetId: id, message: `${c.name} launched · ${steps.length} steps` });

  try {
    const mat = await materializeAdhoc({ label: `Phishing: ${c.name}`, description: `Phishing simulation (${c.mode}) — ${covered.length}/${techniques.length} techniques mapped.`, steps, mitreTechniques: covered, ownerId: auth.user.id, sourceRef: `phishing-campaign:${id}` });
    const out = await runScenario({ useCaseId: mat.useCaseId, scenarioId: mat.scenarioId, environmentId, mode, actor: auth.user.email, confirmDestructive: body.confirmDestructive === true });
    const results = { status: out.status, stepCount: steps.length, mappedTechniques: covered, droppedTechniques: techniques.filter((t) => !covered.includes(t)), stepResults: out.stepResults, validationOutcome: out.validationOutcome };
    await prisma.phishingCampaign.update({ where: { id }, data: { status: "completed", runId: out.runId, results: JSON.stringify(results), completedAt: new Date() } });
    void logEvent({ category: "phishing" as any, action: "phishing.campaign.complete", actor: auth.user.email, status: out.status === "success" ? "ok" : "warn", targetType: "PhishingCampaign", targetId: id, message: `${c.name} → ${out.status}` });
    return NextResponse.json({ ok: true, runId: out.runId, status: out.status, ...results });
  } catch (e: any) {
    await prisma.phishingCampaign.update({ where: { id }, data: { status: "approved" } }).catch(() => {});
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "confirm_required" ? 409 : 500 });
  }
}
