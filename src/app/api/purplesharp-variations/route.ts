/**
 * GET  /api/purplesharp-variations           — list (filterable by techniqueId)
 * POST /api/purplesharp-variations/sync      — seed from static JSON (idempotent)
 *
 * The sync route lives here for proximity; route segments would split into
 * /sync/route.ts if we needed more sub-paths. Single endpoint keeps it tidy.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const techniqueId = sp.get("techniqueId");
  const where: Record<string, unknown> = {};
  if (techniqueId) where.techniqueId = techniqueId;

  const rows = await prisma.purpleSharpVariation.findMany({
    where: where as any,
    orderBy: [{ techniqueId: "asc" }, { variation: "asc" }],
  });
  return NextResponse.json({
    items: rows,
    total: rows.length,
    techniques: [...new Set(rows.map((r) => r.techniqueId))].length,
  });
}
