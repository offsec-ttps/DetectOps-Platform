import { NextResponse } from "next/server";
import { syncAtomicRedTeam } from "@/lib/atomic-red-team/sync";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";

export const maxDuration = 300; // 5 minutes for large sync

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  // Check if a sync is already running
  const running = await prisma.atomicSyncMeta.findFirst({
    where: { status: "running" },
  });
  if (running) {
    return NextResponse.json(
      { error: "A sync is already in progress", syncId: running.id },
      { status: 409 }
    );
  }

  try {
    const result = await syncAtomicRedTeam();
    return NextResponse.json({
      status: "completed",
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: msg },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return the latest sync run status
  const latest = await prisma.atomicSyncMeta.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ status: "never_synced" });
  }

  // Also return recent sync history
  const history = await prisma.atomicSyncMeta.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    latest,
    history,
  });
}
