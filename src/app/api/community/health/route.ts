/**
 * GET /api/community/health
 *
 * Phase 8 — source health snapshot for the Community Content hub.
 *
 * For every adapter (legacy + new) reports:
 *   - lastSyncAt + age in hours
 *   - freshness flag (fresh < 24h, stale 24h-7d, very_stale > 7d, never_synced)
 *   - last sync error count from the most recent SyncRun (if any)
 *   - totalRules currently held in the catalog
 *
 * Senior detection engineers use this to see at a glance which sources need
 * a refresh and which are silently broken.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAllAdapters } from "@/lib/community-sources/registry";
import { cached } from "@/lib/community-sources/cache";

type Freshness = "fresh" | "stale" | "very_stale" | "never_synced";

function freshnessFor(lastSyncAt: Date | null): Freshness {
  if (!lastSyncAt) return "never_synced";
  const ageHours = (Date.now() - lastSyncAt.getTime()) / 36e5;
  if (ageHours < 24) return "fresh";
  if (ageHours < 24 * 7) return "stale";
  return "very_stale";
}

export async function GET() {
  // 60-second cache — health is hit every time the UI mounts and on every
  // tab focus. The data is approximate by nature; freshness within a minute
  // is more than enough.
  const payload = await cached("community:health", 60_000, async () => {
    const adapters = await getAllAdapters();
    const sources = await prisma.communitySource.findMany();
    const sourceByName = new Map(sources.map((s) => [s.name, s]));

    const items = await Promise.all(adapters.map(async (a) => {
      const meta = a.meta();
      const dbRow = sourceByName.get(meta.name);
      const lastSyncAt = dbRow?.lastSyncAt ?? null;
      const ageHours = lastSyncAt
        ? Math.round((Date.now() - lastSyncAt.getTime()) / 36e5)
        : null;

      // Most recent SyncRun for this source (if registered)
      const lastRun = dbRow
        ? await prisma.syncRun.findFirst({
            where: { sourceId: dbRow.id },
            orderBy: { startedAt: "desc" },
          })
        : null;

      return {
        id: meta.id,
        name: meta.name,
        type: meta.type,
        legacy: meta.legacy ?? false,
        registered: !!dbRow,
        totalRules: dbRow?.totalRules ?? 0,
        lastSyncAt: lastSyncAt?.toISOString() ?? null,
        ageHours,
        freshness: freshnessFor(lastSyncAt),
        lastRun: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.startedAt.toISOString(),
              completedAt: lastRun.completedAt?.toISOString() ?? null,
              newCount: lastRun.newCount,
              modifiedCount: lastRun.modifiedCount,
              deletedCount: lastRun.deletedCount,
              errorMessage: lastRun.errorMessage,
            }
          : null,
      };
    }));

    const summary = {
      total: items.length,
      fresh: items.filter((i) => i.freshness === "fresh").length,
      stale: items.filter((i) => i.freshness === "stale").length,
      very_stale: items.filter((i) => i.freshness === "very_stale").length,
      never_synced: items.filter((i) => i.freshness === "never_synced").length,
      with_errors: items.filter((i) => i.lastRun?.errorMessage).length,
    };

    return { generatedAt: new Date().toISOString(), summary, items };
  });

  return NextResponse.json(payload);
}
