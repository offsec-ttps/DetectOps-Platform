import { NextResponse } from "next/server";
import { syncSplunkDetections } from "@/lib/splunk/sync";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";

export const maxDuration = 300;

// Clean up stale "running" records older than 10 minutes
async function cleanupStaleRuns() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.splunkSyncMeta.updateMany({
    where: {
      status: "running",
      startedAt: { lt: tenMinutesAgo },
    },
    data: {
      status: "failed",
      errorMessage: "Timed out (stale run cleanup)",
      completedAt: new Date(),
    },
  });
}

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  await cleanupStaleRuns();

  const running = await prisma.splunkSyncMeta.findFirst({
    where: { status: "running" },
  });
  if (running) {
    return NextResponse.json({
      status: "running",
      syncId: running.id,
      message: "A sync is already in progress",
    });
  }

  // Fire and forget — syncSplunkDetections creates its own SplunkSyncMeta record
  syncSplunkDetections().catch((err) => {
    console.error("Splunk sync background error:", err);
  });

  // Small delay to let the sync record be created
  await new Promise((r) => setTimeout(r, 500));

  const latest = await prisma.splunkSyncMeta.findFirst({
    where: { status: "running" },
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({
    status: "started",
    syncId: latest?.id ?? null,
    message: "Sync started. Poll GET /api/community/splunk/sync for progress.",
  });
}

export async function GET() {
  await cleanupStaleRuns();

  const latest = await prisma.splunkSyncMeta.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ status: "never_synced" });
  }

  return NextResponse.json({
    status: latest.status,
    syncId: latest.id,
    newCount: latest.newCount,
    modifiedCount: latest.updatedCount,
    deletedCount: latest.removedCount,
    totalAfterSync: latest.totalDetections,
    error: latest.errorMessage,
    startedAt: latest.startedAt?.toISOString(),
    completedAt: latest.completedAt?.toISOString(),
  });
}
