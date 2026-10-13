/**
 * POST /api/lotl/simulate — run a LOTL selection/group against the live SAR lab
 * and return a DUAL-VERDICT (prevention + detection) coverage result.
 *
 * This is a thin wrapper over the shared runner (lib/lotl/run.runLotlOnLab) — the
 * SAME execution path the Campaign Designer uses via /api/lotl/campaign-simulate.
 * It exists for group-centric callers (the LOTL library browser's "simulate
 * group"); the Campaign Designer is the primary, target-aware entry point.
 *
 * Body: { groupId? | entryIds?: string[], library?, label?, mode?, confirmDestructive? }
 *   mode: "simulate-only" (default) | "simulate-and-validate"
 *
 * Safety: simulate-only default; LOLDrivers/LOTTunnels/Sysinternals need
 * confirmDestructive=true. compileLotl (inside the runner) makes commands benign.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { resolveLab, DANGEROUS_LIBRARIES } from "@/lib/lotl/targets";
import { runLotlOnLab, type LotlMode } from "@/lib/lotl/run";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const mode: LotlMode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";

  // Resolve the selection from a saved group or an ad-hoc id list.
  let entryIds: string[] = [];
  let library = String(body.library || "");
  let label = String(body.label || "");
  if (body.groupId) {
    const group = await prisma.lotlGroup.findUnique({ where: { id: String(body.groupId) } });
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });
    const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, group.createdBy);
    if (!owns.ok) return owns.response;
    entryIds = JSON.parse(group.entries || "[]");
    library = group.library;
    label = label || `LOTL · ${group.library} · ${group.name}`;
  } else {
    entryIds = Array.isArray(body.entryIds) ? body.entryIds.map(String).filter(Boolean) : [];
    label = label || `LOTL · ${library || "selection"}`;
  }
  if (entryIds.length === 0) return NextResponse.json({ error: "no techniques selected" }, { status: 400 });

  // Synchronous run must finish inside maxDuration; cap per request (validation
  // adds a Splunk query per step). Larger libraries should be chunked.
  const MAX_SYNC = mode === "simulate-and-validate" ? 40 : 80;
  if (entryIds.length > MAX_SYNC) {
    return NextResponse.json({ error: `selection too large for one run (${entryIds.length}); cap is ${MAX_SYNC} in ${mode} mode — run a smaller group` }, { status: 400 });
  }

  const where = library ? { library, id: { in: entryIds } } : { id: { in: entryIds } };
  const rows = await prisma.lotlTechnique.findMany({ where });
  if (rows.length === 0) return NextResponse.json({ error: "selected techniques not found" }, { status: 404 });

  const dangerous = [...new Set(rows.map((r) => r.library).filter((l) => DANGEROUS_LIBRARIES.has(l)))];
  if (dangerous.length > 0 && body.confirmDestructive !== true) {
    return NextResponse.json({ error: `selection includes dangerous libraries (${dangerous.join(", ")}); re-run with confirmDestructive=true`, code: "confirm_required", dangerous }, { status: 409 });
  }

  const lab = resolveLab();
  if (!lab || (!lab.targets.linux && !lab.targets.windows)) {
    return NextResponse.json({ error: "no running SAR lab found (need the Splunk host and/or Windows DC reachable). Start SAR Minimal first.", code: "no_environment" }, { status: 409 });
  }

  const covered = [...new Set(rows.map((r) => r.techniqueId).filter(Boolean))];
  const run = await prisma.simulationRun.create({
    data: {
      techniqueIds: JSON.stringify(covered), targetServer: library || "lotl",
      targetIp: lab.dcIp || lab.splunkIp || "", source: "lotl", executor: "lotl",
      parameters: JSON.stringify({ library, mode, count: rows.length }),
      status: "running", executionMode: mode === "simulate-and-validate" ? "simulation_detection" : "simulation",
      splunkUrl: lab.splunk?.url || "", logs: `[info] LOTL simulate: ${rows.length} techniques · mode=${mode}\n`,
    },
  });

  const out = await runLotlOnLab(rows, lab, mode, { stepTimeoutMs: Number(body.stepTimeoutMs) || undefined });

  await prisma.simulationRun.update({
    where: { id: run.id },
    data: {
      status: out.overall, detectionResults: JSON.stringify(out.results),
      durationMs: Date.now() - (run.startedAt?.getTime() || Date.now()), completedAt: new Date(),
      validationCompletedAt: mode === "simulate-and-validate" ? new Date() : null,
      logs: `[done] allowed=${out.summary.prevention.allowed} blocked=${out.summary.prevention.blocked} failed=${out.summary.prevention.failed} skipped=${out.summary.prevention.skipped}` +
        (out.summary.detection ? ` · detected=${out.summary.detection.detected} gaps=${out.summary.detection.gaps}` : ""),
    },
  });

  void logEvent({
    category: "simulation", action: "lotl.simulate", actor: auth.user.email,
    status: out.overall === "success" ? "ok" : "error", targetType: "simulation", targetId: run.id,
    message: `${label}: ${rows.length} LOTL → allowed=${out.summary.prevention.allowed}` + (out.summary.detection ? ` gaps=${out.summary.detection.gaps}` : ""),
    details: { library, mode, count: rows.length, dangerous },
  });

  return NextResponse.json({ ok: true, runId: run.id, mode, summary: out.summary, results: out.results });
}
