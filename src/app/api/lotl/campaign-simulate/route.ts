/**
 * POST /api/lotl/campaign-simulate — the Campaign Designer's single entry point
 * for running a LOTL selection, routed by target type ("both, by target type"):
 *   - fleet node       → fleet agent bundle path (hash-pinned), via dispatchLotlToFleet
 *   - SSH labs (sar / deployed-lab / cloud) → enterprise runner over an
 *     EnvironmentTarget, via materializeAdhoc → runScenario (detection scoring
 *     available in simulate-and-validate).
 *
 * Body: { entryIds: string[], target: LabTargetDescriptor, mode? }
 * LabTargetDescriptor mirrors the designer's LabTarget: { source, deployedName,
 * displayName, ip, os, labName?, fleetId?, nodeId?, c2Id?, rangeId? }.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { materializeAdhoc } from "@/lib/modules/materialize";
import { runScenario, type ScenarioStep } from "@/lib/enterprise-use-cases/runner";
import { dispatchLotlToFleet } from "@/lib/bas/lotl-dispatch";
import { requireFleetAccess } from "@/lib/bas/fleet";
import { splitRunnable } from "@/lib/lotl/platform";
import { resolveLab, DANGEROUS_LIBRARIES } from "@/lib/lotl/targets";
import { runLotlOnLab } from "@/lib/lotl/run";

export const maxDuration = 300;

const MAX_STEPS = 2000;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const entryIds: string[] = Array.isArray(body.entryIds) ? body.entryIds.map(String).filter(Boolean) : [];
  const target = body.target || {};
  const mode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";
  if (entryIds.length === 0) return NextResponse.json({ error: "no LOTL techniques selected" }, { status: 400 });
  if (entryIds.length > MAX_STEPS) return NextResponse.json({ error: `selection too large (${entryIds.length}); cap is ${MAX_STEPS}` }, { status: 400 });
  if (!target.source) return NextResponse.json({ error: "target descriptor required" }, { status: 400 });

  const allRows = await prisma.lotlTechnique.findMany({ where: { id: { in: entryIds } } });
  if (allRows.length === 0) return NextResponse.json({ error: "selected techniques not found" }, { status: 404 });

  // Pre-flight: skip techniques that cannot run on this target (wrong OS, or a
  // reference command that still needs operator-supplied values) and say why,
  // instead of running a command that is guaranteed to fail.
  const { runnable: rows, skipped } = splitRunnable(allRows, String(target.os || ""));
  if (rows.length === 0) {
    return NextResponse.json({
      error: `None of the ${allRows.length} selected technique(s) can run on "${target.displayName || target.deployedName}" (${target.os || "unknown OS"}). See skipped for the reason on each.`,
      code: "nothing_runnable",
      skipped,
    }, { status: 409 });
  }

  // ── Fleet node → hash-pinned bundle path ──
  if (target.source === "fleet") {
    if (!target.fleetId || !target.nodeId) return NextResponse.json({ error: "fleet target missing fleetId/nodeId" }, { status: 400 });
    // Authorize the fleet to this user (ownership, respecting enforce mode).
    const access = await requireFleetAccess(String(target.fleetId));
    if (!access.ok) return access.response;
    try {
      const res = await dispatchLotlToFleet({ fleetId: target.fleetId, nodeIds: [target.nodeId], lotlIds: rows.map((r) => r.id), actor: auth.user.email, consentId: access.fleet.consentId ?? undefined });
      void logEvent({ category: "enterprise-uc" as any, action: "lotl.campaign.fleet", actor: auth.user.email, status: "ok", message: `LOTL → fleet ${target.displayName}: ${rows.length} techniques (${skipped.length} skipped)`, details: { fleetId: target.fleetId, nodeId: target.nodeId, count: rows.length, skipped: skipped.length } });
      return NextResponse.json({ ok: true, channel: "fleet", ...res, stepCount: rows.length, skipped });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
  }

  // ── C2 is not a LOTL execution channel ──
  if (target.source === "c2") {
    return NextResponse.json({ error: "LOTL is not supported on C2 targets; choose a fleet node or an SSH lab" }, { status: 400 });
  }

  // ── Local SAR lab (sar / deployed-lab) → the proven executor + dual verdict ──
  // compileLotl resolves placeholders + stages benign artifacts, then runs over
  // the deployment's real transports (Windows→WinRM, Linux→SSH). This replaces the
  // old enterprise-runner path, which stubbed LOTL on our-template-deployed labs.
  if (target.source === "sar" || target.source === "deployed-lab") {
    const dangerous = [...new Set(rows.map((r) => r.library).filter((l) => DANGEROUS_LIBRARIES.has(l)))];
    if (dangerous.length > 0 && body.confirmDestructive !== true) {
      return NextResponse.json({ error: `selection includes dangerous libraries (${dangerous.join(", ")}); re-run with confirmDestructive=true`, code: "confirm_required", dangerous, skipped }, { status: 409 });
    }
    const lab = resolveLab();
    if (!lab || (!lab.targets.linux && !lab.targets.windows)) {
      return NextResponse.json({ error: "no running SAR lab found (need the Splunk host and/or Windows DC reachable). Start SAR Minimal, then retry.", code: "no_environment", skipped }, { status: 409 });
    }
    const covered = [...new Set(rows.map((r) => r.techniqueId).filter(Boolean))];
    const run = await prisma.simulationRun.create({
      data: {
        techniqueIds: JSON.stringify(covered), targetServer: String(target.displayName || target.deployedName || "SAR"),
        targetIp: lab.dcIp || lab.splunkIp || "", source: "lotl", executor: "lotl",
        parameters: JSON.stringify({ mode, count: rows.length, via: "campaign-designer" }),
        status: "running", executionMode: mode === "simulate-and-validate" ? "simulation_detection" : "simulation",
        splunkUrl: lab.splunk?.url || "", logs: `[info] LOTL via Campaign Designer: ${rows.length} runnable (${skipped.length} skipped) · mode=${mode}\n`,
      },
    });
    const out = await runLotlOnLab(rows, lab, mode, { stepTimeoutMs: Number(body.stepTimeoutMs) || undefined });
    const stepResults = out.results.map((r) => ({
      status: r.prevention, framework: "lotl", displayName: r.name, techniqueId: r.techniqueId,
      prevention: r.prevention, detection: r.detection, transport: r.transport,
      notes: r.detection !== "n/a" ? `detection: ${r.detection}` : r.notes,
    }));
    await prisma.simulationRun.update({
      where: { id: run.id },
      data: {
        status: out.overall, detectionResults: JSON.stringify(out.results), durationMs: Date.now() - (run.startedAt?.getTime() || Date.now()),
        completedAt: new Date(), validationCompletedAt: mode === "simulate-and-validate" ? new Date() : null,
        logs: `[done] allowed=${out.summary.prevention.allowed} blocked=${out.summary.prevention.blocked} failed=${out.summary.prevention.failed} skipped=${out.summary.prevention.skipped}` +
          (out.summary.detection ? ` · detected=${out.summary.detection.detected} gaps=${out.summary.detection.gaps}` : ""),
      },
    });
    void logEvent({ category: "enterprise-uc" as any, action: "lotl.campaign.sar", actor: auth.user.email, status: out.overall === "success" ? "ok" : "error", message: `LOTL → ${target.displayName}: ${rows.length} techniques (allowed=${out.summary.prevention.allowed}${out.summary.detection ? `, gaps=${out.summary.detection.gaps}` : ""})`, details: { count: rows.length, mode, skipped: skipped.length } });
    return NextResponse.json({ ok: true, channel: "sar", environment: String(target.displayName || "SAR"), runId: run.id, status: out.overall, summary: out.summary, stepResults, stepCount: rows.length, mappedTechniques: covered, skipped });
  }

  // ── Other SSH labs (cloud) → enterprise runner (unchanged fallback) ──
  // Resolve the designer's target to a configured EnvironmentTarget (SSH exec
  // needs real credentials, so we match an existing one rather than fabricate).
  const names = [target.labName, target.displayName, target.deployedName].filter(Boolean);
  const envWhere: Record<string, unknown> = {
    enabled: true,
    kind: { in: ["our-template-deployed", "user-cloud", "shell"] },
    OR: [
      ...(target.ip ? [{ hostname: String(target.ip) }] : []),
      ...(names.length ? [{ name: { in: names as string[] } }] : []),
    ],
  };
  // Tenant-scope: only match environments the requester owns (when enforcing),
  // mirroring GET /api/environment-targets. Prevents selecting someone else's
  // SSH target (which would lead to command execution on it).
  if (auth.enforced) envWhere.ownerId = auth.user.id;
  const env = await prisma.environmentTarget.findFirst({ where: envWhere as any });
  if (!env) {
    return NextResponse.json({
      error: `No SSH-enabled environment is configured for "${target.displayName || target.deployedName}". Create an Environment Target (Enterprise Environments) that points at this server, then retry. LOTL inline commands run over SSH and need credentials.`,
      code: "no_environment",
    }, { status: 409 });
  }

  const steps: ScenarioStep[] = rows.map((r) => ({
    framework: "lotl",
    refId: `${r.library}:${r.sourceRef}`,
    techniqueId: r.techniqueId || undefined,
    displayName: r.name,
    parameters: { command: r.command, executor: r.executor, cleanupCommand: r.cleanupCommand, library: r.library },
    notes: `${r.library} · ${r.techniqueId || "unmapped"}`,
  }));
  const covered = [...new Set(rows.map((r) => r.techniqueId).filter(Boolean))];
  const label = `LOTL · ${target.displayName || target.deployedName}`;

  const mat = await materializeAdhoc({
    label, description: `${rows.length} LOTL techniques via Campaign Designer.`,
    steps, mitreTechniques: covered, ownerId: auth.user.id, sourceRef: `lotl-campaign:${target.source}`,
  });

  try {
    const out = await runScenario({ useCaseId: mat.useCaseId, scenarioId: mat.scenarioId, environmentId: env.id, mode, actor: auth.user.email, confirmDestructive: body.confirmDestructive === true });
    void logEvent({ category: "enterprise-uc" as any, action: "lotl.campaign.ssh", actor: auth.user.email, status: out.status === "success" ? "ok" : "error", message: `LOTL → ${env.name}: ${steps.length} steps → ${out.status}`, details: { environmentId: env.id, count: steps.length, mode } });
    return NextResponse.json({ ok: true, channel: "ssh", environment: env.name, runId: out.runId, status: out.status, stepResults: out.stepResults, mappedTechniques: covered, stepCount: steps.length, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "needs_confirm" ? 409 : 500 });
  }
}
