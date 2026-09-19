/**
 * POST /api/detection-packs/jobs/[id]/retry
 *
 * Re-queues a failed or budget-exceeded job (status → "queued"). Resets
 * `errorMessage`, `startedAt`, `completedAt`. Leaves `attempts` intact so
 * the retry budget is still respected — pass `?force=1` to reset attempts.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const job = await prisma.detectionPackJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status === "running") {
    return NextResponse.json({ error: "job is running — wait for completion before retry" }, { status: 409 });
  }
  if (job.status === "completed") {
    return NextResponse.json({ error: "job already completed; create a fresh pack instead" }, { status: 409 });
  }

  const updated = await prisma.detectionPackJob.update({
    where: { id },
    data: {
      status: "queued",
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      ...(force ? { attempts: 0 } : {}),
    },
  });
  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "detection-pack",
    action: "detection-pack.job.requeued",
    actor: sessionUser?.email || "anonymous",
    status: "info",
    targetType: "DetectionPackJob", targetId: id,
    message: `requeued (attempts=${updated.attempts}, force=${force})`,
    details: { jobId: id, sourceTable: updated.sourceTable, sourceRefId: updated.sourceRefId, attempts: updated.attempts, force },
  });
  return NextResponse.json({ id, status: updated.status, attempts: updated.attempts });
}
