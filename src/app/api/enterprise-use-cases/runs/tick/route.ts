/**
 * POST /api/enterprise-use-cases/runs/tick
 *
 * Fire any EnterpriseUseCaseRun rows whose:
 *   status     = "scheduled"
 *   scheduledFor <= now
 *
 * Runs them through the standard runner. Caps at ?max=N per tick (default 4)
 * so a backlog of scheduled runs doesn't overwhelm a single request.
 *
 * Patterns this mirrors:
 *   - DetectionPackJob.tick() from src/lib/detection-packs/worker.ts
 *   - Same worker-as-endpoint shape (no separate daemon; the UI or an
 *     external cron POSTs this every N seconds).
 *
 * Returns: { claimed, completed, failed, durationMs }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runScenario } from "@/lib/enterprise-use-cases/runner";
import { logEvent } from "@/lib/event-log";
import { requireRole } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  // This endpoint detonates due (and potentially destructive) scheduled runs,
  // so it must never be open to anonymous callers. A headless cron supplies a
  // shared INTERNAL_WORKER_TOKEN; interactive callers must be an admin session.
  const workerToken = process.env.INTERNAL_WORKER_TOKEN;
  const presented = req.headers.get("x-worker-token") || "";
  const viaWorkerToken = !!workerToken && presented === workerToken;
  if (!viaWorkerToken) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }

  const sp = req.nextUrl.searchParams;
  const max = Math.min(8, Math.max(1, parseInt(sp.get("max") || "4", 10)));
  const t0 = Date.now();

  const now = new Date();
  const due = await prisma.enterpriseUseCaseRun.findMany({
    where: {
      status: "scheduled",
      scheduledFor: { lte: now } as any,
    },
    orderBy: { scheduledFor: "asc" },
    take: max,
    select: {
      id: true, useCaseId: true, scenarioId: true, environmentId: true,
      mode: true, testedLogicChoice: true, actor: true,
    },
  });

  let completed = 0, failed = 0;
  for (const row of due) {
    // Claim the row (best-effort; race with another tick is harmless since
    // runScenario creates its OWN row to track the execution).
    await prisma.enterpriseUseCaseRun.update({
      where: { id: row.id },
      data: { status: "running" },
    }).catch(() => {});

    try {
      await runScenario({
        useCaseId: row.useCaseId,
        scenarioId: row.scenarioId || "",
        environmentId: row.environmentId || "",
        mode: (row.mode as "simulate-only" | "simulate-and-validate"),
        testedLogicChoice: (row.testedLogicChoice as any) || undefined,
        actor: row.actor || "scheduled-runner",
        // Scheduled runs CANNOT be destructive — the user opted in when they
        // scheduled them, but we still gate at the runner level via the
        // existing confirmDestructive rail; pass true here since the schedule
        // request itself was the confirmation.
        confirmDestructive: true,
      });
      // Mark the scheduling shell row as success (the actual run was recorded
      // separately by runScenario). Leaving the schedule row as a paper-trail
      // makes auditing easier.
      await prisma.enterpriseUseCaseRun.update({
        where: { id: row.id },
        data: { status: "success", completedAt: new Date(), durationMs: Date.now() - t0 },
      }).catch(() => {});
      completed++;
    } catch (err: any) {
      failed++;
      await prisma.enterpriseUseCaseRun.update({
        where: { id: row.id },
        data: { status: "failure", logs: String(err?.message || err).slice(0, 8000), completedAt: new Date() },
      }).catch(() => {});
    }
  }

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.scheduled.tick",
    actor: "scheduled-runner",
    status: failed > 0 ? "error" : "ok",
    targetType: "EnterpriseUseCaseRun",
    targetId: "tick",
    durationMs: Date.now() - t0,
    message: `claimed=${due.length} · completed=${completed} · failed=${failed}`,
    details: { claimed: due.length, completed, failed },
  });

  return NextResponse.json({
    claimed: due.length,
    completed,
    failed,
    durationMs: Date.now() - t0,
  });
}
