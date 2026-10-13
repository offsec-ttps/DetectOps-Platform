/**
 * GET /api/lotl/libraries — list every registered LOTL library with its
 * registry metadata and current sync status (counts + last-synced time).
 * Drives the library cards shown inside Living-off-the-Land Simulation.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRegistry } from "@/lib/lotl/registry";

export async function GET() {
  const meta = getRegistry().meta();
  const syncRows = await prisma.lotlSyncMeta.findMany();
  const syncByLib = new Map(syncRows.map((s) => [s.library, s]));
  const counts = await prisma.lotlTechnique.groupBy({ by: ["library"], _count: true });
  const countByLib = new Map(counts.map((c) => [c.library, c._count]));

  const libraries = meta.map((m) => {
    const sync = syncByLib.get(m.sourceId);
    return {
      ...m,
      installed: (countByLib.get(m.sourceId) || 0) > 0,
      count: countByLib.get(m.sourceId) || 0,
      syncStatus: sync?.status || "never",
      lastSyncAt: sync?.completedAt?.toISOString() || null,
      lastSyncCommit: sync?.commitSha || null,
    };
  });

  return NextResponse.json({ libraries });
}
