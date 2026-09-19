import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const totalRules = await prisma.splunkDetection.count();

  if (totalRules === 0) {
    return NextResponse.json({
      totalRules: 0,
      importedRules: 0,
      lastSyncAt: null,
      synced: false,
    });
  }

  const lastSync = await prisma.splunkSyncMeta.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
  });

  return NextResponse.json({
    totalRules,
    importedRules: 0,
    lastSyncAt: lastSync?.completedAt ?? null,
    synced: true,
  });
}
