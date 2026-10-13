/**
 * POST /api/apt/campaign-simulate — the faithful per-atomic APT runner.
 *
 * Runs a selected set of a group's Atomic Red Team tests on the live SAR lab and
 * returns a DUAL-VERDICT (prevention + detection) result — the APT parallel to
 * /api/lotl/campaign-simulate. Unlike the designer's native atomic flow (one test
 * per technique), this runs EVERY selected atomic and scores each.
 *
 * Body: {
 *   atomicTestIds?: string[],   // atomic_tests.id rows to run, OR
 *   groupName?: string,         // run (a capped set of) this APT group's atomics
 *   target: { source, deployedName, displayName, ip, os },  // SAR / deployed-lab
 *   mode?: "simulate-only" | "simulate-and-validate",
 *   stepTimeoutMs?, confirmDestructive?
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { resolveLab } from "@/lib/lotl/targets";
import { runAptOnLab, type AptRunTest, type AptMode } from "@/lib/apt/run";

export const maxDuration = 300;

// ART tests are lab-safe by design, but a few are genuinely destructive to the
// host. Gate those behind an explicit confirm, same spirit as LOTL's dangerous
// libraries. Matched against the (arg-substituted-ish) command text.
const DESTRUCTIVE = [
  /\brm\s+-rf\s+\//i, /\bformat\b.*\/[yq]/i, /vssadmin(\.exe)?\s+delete/i, /wbadmin\s+delete/i,
  /bcdedit.*\b(recoveryenabled\s+no|bootstatuspolicy)/i, /cipher(\.exe)?\s+\/w/i, /\bdiskpart\b/i,
  /Remove-Item[^\n]*-Recurse[^\n]*(C:\\Windows|C:\\Users|\/etc|\/var)/i, /Clear-EventLog/i, /wevtutil\s+cl/i,
];

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const mode: AptMode = body.mode === "simulate-and-validate" ? "simulate-and-validate" : "simulate-only";
  const target = body.target || {};
  if (!target.source) return NextResponse.json({ error: "target descriptor required" }, { status: 400 });
  if (!["sar", "deployed-lab"].includes(String(target.source))) {
    return NextResponse.json({ error: `APT simulation runs on a deployed SAR lab; target.source "${target.source}" is not supported here. Select the SAR lab.`, code: "unsupported_target" }, { status: 400 });
  }

  // Resolve which atomic_tests to run: explicit ids, or a capped set for a group.
  let ids: string[] = Array.isArray(body.atomicTestIds) ? body.atomicTestIds.map(String).filter(Boolean) : [];
  if (!ids.length && body.groupName) {
    const maps = await prisma.aptAtomic.findMany({ where: { groupName: String(body.groupName) }, select: { testGuid: true } });
    const guids = [...new Set(maps.map((m) => m.testGuid).filter(Boolean))];
    const tests = await prisma.atomicTest.findMany({ where: { testGuid: { in: guids } }, select: { id: true } });
    ids = tests.map((t) => t.id);
  }
  if (!ids.length) return NextResponse.json({ error: "no atomic tests selected (pass atomicTestIds or groupName)" }, { status: 400 });

  const MAX_SYNC = mode === "simulate-and-validate" ? 60 : 120;
  if (ids.length > MAX_SYNC) {
    return NextResponse.json({ error: `selection too large for one run (${ids.length}); cap is ${MAX_SYNC} in ${mode} mode — run a smaller batch`, code: "too_large" }, { status: 400 });
  }

  const rows = await prisma.atomicTest.findMany({ where: { id: { in: ids } } });
  if (rows.length === 0) return NextResponse.json({ error: "selected atomic tests not found" }, { status: 404 });

  const dangerous = rows.filter((r) => DESTRUCTIVE.some((re) => re.test(r.command)));
  if (dangerous.length > 0 && body.confirmDestructive !== true) {
    return NextResponse.json({
      error: `${dangerous.length} selected test(s) are host-destructive; re-run with confirmDestructive=true to proceed.`,
      code: "confirm_required", dangerous: dangerous.map((d) => ({ techniqueId: d.techniqueId, testName: d.testName })).slice(0, 20),
    }, { status: 409 });
  }

  const lab = resolveLab();
  if (!lab || (!lab.targets.linux && !lab.targets.windows)) {
    return NextResponse.json({ error: "no running SAR lab found (Splunk host and/or Windows DC must be reachable). Start SAR Minimal, then retry.", code: "no_environment" }, { status: 409 });
  }

  const tests: AptRunTest[] = rows.map((r) => {
    const parse = <T>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };
    return {
      id: r.id, techniqueId: r.techniqueId, techniqueName: r.techniqueName, testName: r.testName, testGuid: r.testGuid,
      platforms: parse<string[]>(r.platforms, []), executor: r.executorName, command: r.command, cleanupCommand: r.cleanupCommand,
      inputArguments: parse<Record<string, { default?: unknown }>>(r.inputArguments, {}),
      elevationRequired: r.elevationRequired, tactic: r.tactic,
    };
  });

  const covered = [...new Set(tests.map((t) => t.techniqueId).filter(Boolean))];
  const run = await prisma.simulationRun.create({
    data: {
      techniqueIds: JSON.stringify(covered), targetServer: String(body.groupName || target.displayName || "APT"),
      targetIp: lab.dcIp || lab.splunkIp || "", source: "apt", executor: "atomic",
      parameters: JSON.stringify({ mode, count: tests.length, group: body.groupName || null, via: "apt-campaign" }),
      status: "running", executionMode: mode === "simulate-and-validate" ? "simulation_detection" : "simulation",
      splunkUrl: lab.splunk?.url || "", logs: `[info] APT simulation: ${tests.length} atomics · mode=${mode}${body.groupName ? ` · group=${body.groupName}` : ""}\n`,
    },
  });

  const out = await runAptOnLab(tests, lab, mode, { stepTimeoutMs: Number(body.stepTimeoutMs) || undefined });

  await prisma.simulationRun.update({
    where: { id: run.id },
    data: {
      status: out.overall, detectionResults: JSON.stringify(out.results),
      durationMs: Date.now() - (run.startedAt?.getTime() || Date.now()), completedAt: new Date(),
      validationCompletedAt: mode === "simulate-and-validate" ? new Date() : null,
      logs: `[done] allowed=${out.summary.prevention.allowed} blocked=${out.summary.prevention.blocked} failed=${out.summary.prevention.failed} skipped=${out.summary.prevention.skipped} error=${out.summary.prevention.error}` +
        (out.summary.detection ? ` · detected=${out.summary.detection.detected} gaps=${out.summary.detection.gaps}` : ""),
    },
  });

  void logEvent({
    category: "simulation", action: "apt.campaign", actor: auth.user.email,
    status: out.overall === "success" ? "ok" : "error", targetType: "simulation", targetId: run.id,
    message: `APT → ${body.groupName || target.displayName}: ${tests.length} atomics (allowed=${out.summary.prevention.allowed}${out.summary.detection ? `, gaps=${out.summary.detection.gaps}` : ""})`,
    details: { group: body.groupName || null, mode, count: tests.length },
  });

  return NextResponse.json({ ok: true, channel: "apt", runId: run.id, status: out.overall, summary: out.summary, results: out.results, stepCount: tests.length });
}
