/**
 * GET /api/community/mitre-car/rules
 *
 * Lists CAR analytics with pagination + filters.
 *
 * Query params:
 *   q              — full-text search
 *   platform       — windows | linux | macos
 *   technique      — single technique ID (TXXXX or TXXXX.XXX)
 *   tactic         — TA0001..
 *   page, pageSize
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSourceEnabled } from "@/lib/community-sources/flags";

export async function GET(req: NextRequest) {
  if (!isSourceEnabled("mitreCar")) {
    return NextResponse.json({ enabled: false, items: [], total: 0, page: 1, pageSize: 0 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const platform = searchParams.get("platform")?.trim() ?? "";
  const technique = searchParams.get("technique")?.trim().toUpperCase() ?? "";
  const tactic = searchParams.get("tactic")?.trim().toUpperCase() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "25", 10)));

  const source = await prisma.communitySource.findUnique({ where: { name: "MITRE CAR" } });
  if (!source) {
    return NextResponse.json({
      enabled: true,
      registered: false,
      items: [], total: 0, page, pageSize,
      message: "Source not yet synced. POST /api/community/mitre-car/sync first.",
    });
  }

  // Build SQL where clause
  const where: any = {
    sourceId: source.id,
    changeStatus: { not: "deleted" },
  };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { upstreamRuleId: { contains: q } },
    ];
  }
  // Note: platforms/techniques/tactics are JSON-encoded so we filter post-query.
  // CAR is small (~250 analytics) so this is fine without an index.

  const all = await prisma.communityRule.findMany({
    where,
    orderBy: { upstreamRuleId: "asc" },
  });

  let filtered = all;
  if (platform) {
    filtered = filtered.filter((r) => {
      try { return (JSON.parse(r.platforms) as string[]).some((p) => p.toLowerCase() === platform.toLowerCase()); }
      catch { return false; }
    });
  }
  if (technique) {
    filtered = filtered.filter((r) => {
      try { return (JSON.parse(r.mitreTechniques) as string[]).includes(technique); }
      catch { return false; }
    });
  }
  if (tactic) {
    filtered = filtered.filter((r) => {
      try { return (JSON.parse(r.mitreTactics) as string[]).includes(tactic); }
      catch { return false; }
    });
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map((r) => ({
    id: r.id,
    upstreamRuleId: r.upstreamRuleId,
    title: r.title,
    description: r.description.slice(0, 240),
    author: r.author,
    platforms: safeJson<string[]>(r.platforms, []),
    mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(r.mitreTactics, []),
    products: safeJson<string[]>(r.products, []),
    ruleLanguage: r.ruleLanguage,
    sourceUrl: r.sourceUrl,
    upstreamCreatedAt: r.upstreamCreatedAt,
    changeStatus: r.changeStatus,
  }));

  return NextResponse.json({
    enabled: true,
    registered: true,
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; }
  catch { return fallback; }
}
