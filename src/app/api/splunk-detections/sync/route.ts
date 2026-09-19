import { NextResponse } from "next/server";
import { syncSplunkDetections } from "@/lib/splunk/sync";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300; // 5 minutes for large sync

export async function POST() {
  const running = await prisma.splunkSyncMeta.findFirst({
    where: { status: "running" },
  });
  if (running) {
    return NextResponse.json(
      { error: "A sync is already in progress", syncId: running.id },
      { status: 409 }
    );
  }

  try {
    const result = await syncSplunkDetections();
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
  const latest = await prisma.splunkSyncMeta.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!latest) {
    return NextResponse.json({ status: "never_synced" });
  }

  const history = await prisma.splunkSyncMeta.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ latest, history });
}
