/**
 * GET /api/community/unified/[slug]/summary
 *
 * Quick stats for any new community source.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/community-sources/registry";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const adapter = await getAdapter(slug);
  if (!adapter) return NextResponse.json({ enabled: false });

  const meta = adapter.meta();
  const source = await prisma.communitySource.findUnique({ where: { name: meta.name } });
  if (!source) {
    return NextResponse.json({
      enabled: true, registered: false, totalRules: 0, lastSyncAt: null,
      meta,
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
    enabled: true, registered: true,
    meta,
    totalRules: source.totalRules,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    byChangeStatus: byStatus,
  });
}
