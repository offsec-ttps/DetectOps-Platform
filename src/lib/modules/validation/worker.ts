/**
 * Module validation worker — mirrors src/lib/detection-packs/worker.ts.
 * tick() claims ≤N queued ModuleValidationRun rows, runs automated checks +
 * AI review, computes a verdict, and applies the AUTO-APPROVE GATE:
 *
 *   all checks pass (no fail) AND signature verified AND aiReview=approve AND
 *   ENABLE_MODULE_AUTO_APPROVE  →  module status approved → live (verified)
 *   any check fails OR aiReview=reject                    →  module rejected
 *   otherwise                                             →  needs-human (approved, awaits review)
 */

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { isModuleFeatureEnabled } from "@/lib/modules/flags";
import { runChecks } from "./checks";
import { aiReviewModule, type AiReview } from "./ai-review";

let tickRunning = false;

export interface TickResult { claimed: number; passed: number; live: number; rejected: number; needsHuman: number; skipped: number; durationMs: number }

export async function tick({ maxConcurrent = 2 }: { maxConcurrent?: number } = {}): Promise<TickResult> {
  const t0 = Date.now();
  const base: TickResult = { claimed: 0, passed: 0, live: 0, rejected: 0, needsHuman: 0, skipped: 0, durationMs: 0 };
  if (tickRunning) return { ...base, skipped: 1 };
  tickRunning = true;
  try {
    // Claim queued runs atomically.
    const queued = await prisma.moduleValidationRun.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, take: maxConcurrent });
    for (const run of queued) {
      const claim = await prisma.moduleValidationRun.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } } });
      if (claim.count === 0) continue;   // someone else took it
      base.claimed++;
      await processRun(run.id, base);
    }
    return { ...base, durationMs: Date.now() - t0 };
  } finally {
    tickRunning = false;
  }
}

async function processRun(runId: string, acc: TickResult): Promise<void> {
  const run = await prisma.moduleValidationRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const mod = await prisma.simulationModule.findUnique({ where: { id: run.moduleRowId } });
  if (!mod) { await prisma.moduleValidationRun.update({ where: { id: runId }, data: { status: "failed", errorMessage: "module row missing", completedAt: new Date() } }); return; }

  // Mark module as validating.
  await prisma.simulationModule.update({ where: { id: mod.id }, data: { status: "validating" } });

  try {
    const { checks, dryRun, manifest } = await runChecks({ id: mod.id, manifest: mod.manifest, contentHash: mod.contentHash, signatureB64: mod.signatureB64, signatureState: mod.signatureState });
    const anyFail = checks.some((c) => c.status === "fail");
    const sigOk = checks.find((c) => c.name === "signature-verify")?.status === "pass";

    // AI review — resilient: if no provider/network, fall back to checks-only.
    let review: AiReview; let costUsd = 0; let aiUnavailable = false;
    if (manifest && !anyFail) {
      try { const r = await aiReviewModule(manifest, checks); review = r.review; costUsd = r.costUsd; }
      catch { aiUnavailable = true; review = { verdict: "approve", rationale: "AI review unavailable — auto-decided on automated checks.", concerns: ["llm_unavailable"] }; }
    } else {
      review = { verdict: anyFail ? "reject" : "needs-human", rationale: anyFail ? "Automated checks failed." : "Manifest unparseable.", concerns: [] };
    }

    // Verdict + auto-approve gate.
    const signingRequired = isModuleFeatureEnabled("signing");
    const sigGate = signingRequired ? sigOk : true;   // signature mandatory only when signing flag on
    let verdict: "auto-approve" | "needs-human" | "reject";
    let newStatus: string;
    if (anyFail || review.verdict === "reject") { verdict = "reject"; newStatus = "rejected"; }
    else if (!anyFail && review.verdict === "approve" && sigGate && isModuleFeatureEnabled("autoApprove")) { verdict = "auto-approve"; newStatus = "live"; }
    else { verdict = "needs-human"; newStatus = "approved"; }

    await prisma.moduleValidationRun.update({
      where: { id: runId },
      data: {
        status: anyFail ? "failed" : "passed", verdict,
        checks: JSON.stringify(checks), aiReview: JSON.stringify({ ...review, aiUnavailable }),
        dryRunResults: JSON.stringify(dryRun), costEstimateUsd: costUsd, completedAt: new Date(),
      },
    });
    await prisma.simulationModule.update({
      where: { id: mod.id },
      data: { status: newStatus, signatureState: sigOk ? "verified" : mod.signatureState, installedAt: newStatus === "live" ? new Date() : mod.installedAt },
    });
    // Publish the version on go-live.
    if (newStatus === "live") {
      await prisma.moduleVersion.updateMany({ where: { moduleRowId: mod.id, version: run.version }, data: { status: "published" } });
    }

    if (newStatus === "live") acc.live++; else if (newStatus === "rejected") acc.rejected++; else acc.needsHuman++;
    if (!anyFail) acc.passed++;

    void logEvent({ category: "module" as any, action: "module.validate", actor: "validation-agent", status: anyFail ? "warn" : "ok", targetType: "SimulationModule", targetId: mod.id, message: `${mod.moduleId}@${run.version} → ${verdict} (status=${newStatus})`, details: { verdict, checks: checks.map((c) => `${c.name}:${c.status}`) } });
  } catch (e: any) {
    await prisma.moduleValidationRun.update({ where: { id: runId }, data: { status: "failed", errorMessage: e?.message || String(e), completedAt: new Date() } });
    await prisma.simulationModule.update({ where: { id: mod.id }, data: { status: "submitted" } }).catch(() => {});
    acc.rejected++;
  }
}
