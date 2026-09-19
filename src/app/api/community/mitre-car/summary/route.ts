/**
 * GET /api/community/mitre-car/summary
 *
 * Quick stats for the registry / Community Content overview.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSourceEnabled } from "@/lib/community-sources/flags";

export async function GET() {
  if (!isSourceEnabled("mitreCar")) {
    return NextResponse.json({ enabled: false });
  }

  const source = await prisma.communitySource.findUnique({ where: { name: "MITRE CAR" } });
  if (!source) {
    return NextResponse.json({
      enabled: true,
      registered: false,
      totalRules: 0,
      lastSyncAt: null,
    });
  }

  const counts = await prisma.communityRule.groupBy({
    by: ["changeStatus"],
    where: { sourceId: source.id },
    _count: true,
  });

  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.changeStatus] = c._count;

  return NextResponse.json({
    enabled: true,
    registered: true,
    totalRules: source.totalRules,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    byChangeStatus: byStatus,
  });
}
