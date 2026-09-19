/**
 * GET /api/community/unified/search
 *
 * Phase 5: cross-source search across ALL new community sources at once.
 *
 * This unifies discovery across MITRE CAR, Sentinel, Defender XDR, Google SecOps,
 * Panther, Falco, and Wazuh — every source that writes into community_rules.
 *
 * Legacy sources (SigmaHQ, Elastic, Splunk Security Content) keep their own
 * dedicated /api/community/<source>/rules endpoints — this endpoint does NOT
 * touch them. The Community Content UI page combines both layers visually.
 *
 * Query params:
 *   q              — full-text search
 *   sources        — comma-separated source slugs to include (default: all enabled)
 *   platform, technique, tactic, severity, ruleLanguage, ruleType
 *   page, pageSize
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/community-sources/cache";

const safe = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T; } catch { return fb; } };

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  // Phase 8: short-TTL response cache. Cache key embeds the full search
  // params so different filter combinations don't collide. Mutating syncs
  // call invalidateCache("community:") to flush stale entries.
  const cacheKey = `community:search:${sp.toString()}`;
  return NextResponse.json(await cached(cacheKey, 30_000, () => buildSearchResponse(sp)));
}

async function buildSearchResponse(sp: URLSearchParams) {
  const q = sp.get("q")?.trim() ?? "";
  const sourcesParam = sp.get("sources")?.trim() ?? "";
  const platform = sp.get("platform")?.trim() ?? "";
  const technique = sp.get("technique")?.trim().toUpperCase() ?? "";
  const tactic = sp.get("tactic")?.trim().toUpperCase() ?? "";
  const severity = sp.get("severity")?.trim().toLowerCase() ?? "";
  const ruleLanguage = sp.get("ruleLanguage")?.trim().toLowerCase() ?? "";
  const ruleType = sp.get("ruleType")?.trim().toLowerCase() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10)));

  // Build the source filter
  const where: any = { changeStatus: { not: "deleted" } };
  if (sourcesParam) {
    const slugs = sourcesParam.split(",").map((s) => s.trim()).filter(Boolean);
    // Resolve slugs → source ids via the adapter registry
    const { getAdapter } = await import("@/lib/community-sources/registry");
    const sourceIds: string[] = [];
    for (const slug of slugs) {
      const adapter = await getAdapter(slug);
      if (!adapter) continue;
      const source = await prisma.communitySource.findUnique({ where: { name: adapter.meta().name } });
      if (source) sourceIds.push(source.id);
    }
    if (sourceIds.length === 0) {
      return { items: [], total: 0, page, pageSize, totalPages: 0, sources: [] };
    }
    where.sourceId = { in: sourceIds };
  }

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { upstreamRuleId: { contains: q } },
    ];
  }
  if (severity) where.severity = severity;
  if (ruleLanguage) where.ruleLanguage = ruleLanguage;
  if (ruleType) where.ruleType = ruleType;

  let rows = await prisma.communityRule.findMany({
    where,
    include: { source: { select: { name: true, type: true } } },
    orderBy: { updatedAt: "desc" },
  });

  // JSON-array filters in JS
  if (platform) {
    rows = rows.filter((r) => safe<string[]>(r.platforms, []).some(
      (p) => p.toLowerCase() === platform.toLowerCase(),
    ));
  }
  if (technique) {
    rows = rows.filter((r) => safe<string[]>(r.mitreTechniques, []).some(
      (t) => t.toUpperCase() === technique || t.toUpperCase().startsWith(technique + "."),
    ));
  }
  if (tactic) {
    rows = rows.filter((r) => safe<string[]>(r.mitreTactics, []).includes(tactic));
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize).map((r) => ({
    id: r.id,
    sourceName: r.source.name,
    sourceType: r.source.type,
    upstreamRuleId: r.upstreamRuleId,
    title: r.title,
    description: r.description.slice(0, 200),
    severity: r.severity,
    ruleLanguage: r.ruleLanguage,
    ruleType: r.ruleType,
    platforms: safe<string[]>(r.platforms, []),
    mitreTechniques: safe<string[]>(r.mitreTechniques, []),
    mitreTactics: safe<string[]>(r.mitreTactics, []),
    products: safe<string[]>(r.products, []),
    sourceUrl: r.sourceUrl,
  }));

  // Aggregate facets for filter UI
  const allSources = await prisma.communitySource.findMany({
    where: { unifiedRules: { some: {} } },
    select: { id: true, name: true, type: true, totalRules: true },
  });

  return {
    items, total, page, pageSize,
    totalPages: Math.ceil(total / pageSize),
    sources: allSources,
  };
}
