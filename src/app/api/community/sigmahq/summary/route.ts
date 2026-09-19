import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let source = await prisma.communitySource.findUnique({
    where: { name: "SigmaHQ" },
  });

  if (!source) {
    return NextResponse.json({
      totalRules: 0,
      importedRules: 0,
      lastSyncAt: null,
      synced: false,
    });
  }

  return NextResponse.json({
    totalRules: source.totalRules,
    importedRules: source.importedRulesCount,
    lastSyncAt: source.lastSyncAt,
    synced: true,
  });
}
