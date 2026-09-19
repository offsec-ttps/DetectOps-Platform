/**
 * GET /api/replay/history — recent replay executions (audit log).
 *   ?limit=50
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";

export async function GET(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED) return NextResponse.json({ enabled: false, executions: [] });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "50", 10));
  const executions = await prisma.replayExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ enabled: true, executions, count: executions.length });
}
