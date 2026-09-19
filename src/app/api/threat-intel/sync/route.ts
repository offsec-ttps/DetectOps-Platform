import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAggregatorSync } from "@/lib/threat-intel/aggregator";

export const maxDuration = 300;

/** POST — trigger full aggregator sync (non-blocking) */
export async function POST() {
  const running = await prisma.tiAggregatorSync.findFirst({ where: { status: "running" } });
  if (running) {
    return NextResponse.json({ status: "running", syncId: running.id, message: "Sync already in progress" });
  }

  // Fire and forget
  runAggregatorSync().catch((err) => {
    console.error("TI Aggregator sync error:", err);
  });

  return NextResponse.json({ status: "started", message: "Threat intel aggregation started. Poll GET for status." });
}

/** GET — poll sync status */
export async function GET() {
  // Clean up stale runs
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await prisma.tiAggregatorSync.updateMany({
    where: { status: "running", startedAt: { lt: tenMinutesAgo } },
    data: { status: "failed", errorMessage: "Timed out", completedAt: new Date() },
  }).catch(() => {});

  const latest = await prisma.tiAggregatorSync.findFirst({ orderBy: { startedAt: "desc" } });
  if (!latest) return NextResponse.json({ status: "never_synced" });

  return NextResponse.json({
    status: latest.status,
    sourcesProcessed: latest.sourcesProcessed,
    articlesFound: latest.articlesFound,
    indicatorsFound: latest.indicatorsFound,
    errorCount: latest.errorCount,
    startedAt: latest.startedAt,
    completedAt: latest.completedAt,
  });
}
