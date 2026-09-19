/**
 * GET /api/community/unified/[slug]/rules
 *
 * Generic rule list for any new source. Filters work uniformly across all
 * sources because they all write into the same `community_rules` table.
 *
 * Query params:
 *   q              — full-text search
 *   platform       — windows | linux | aws | azure | m365 | gcp | container | ...
 *   technique      — TXXXX[.XXX]
 *   tactic         — TAXXXX
 *   severity       — info | low | medium | high | critical
 *   ruleLanguage   — sigma | spl | kql | yara-l | falco-yaml | wazuh-xml | python | ...
 *   page, pageSize
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/community-sources/registry";

function safeJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const adapter = await getAdapter(slug);
  if (!adapter) return NextResponse.json({ error: `Unknown source: ${slug}` }, { status: 404 });
  const meta = adapter.meta();
  if (meta.legacy) {
    return NextResponse.json({
      error: `Use /api/community/${slug}/rules for the legacy ${slug} source`,
    }, { status: 400 });
  }

  const source = await prisma.communitySource.findUnique({ where: { name: meta.name } });
  if (!source) {
    return NextResponse.json({
      enabled: true, registered: false, items: [], total: 0, page: 1, pageSize: 25,
      message: `Run POST /api/community/unified/${slug}/sync first.`,
    });
  }

  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const platform = sp.get("platform")?.trim() ?? "";
  const technique = sp.get("technique")?.trim().toUpperCase() ?? "";
  const tactic = sp.get("tactic")?.trim().toUpperCase() ?? "";
  const severity = sp.get("severity")?.trim().toLowerCase() ?? "";
  const ruleLanguage = sp.get("ruleLanguage")?.trim().toLowerCase() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10)));

  const where: any = { sourceId: source.id, changeStatus: { not: "deleted" } };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { upstreamRuleId: { contains: q } },
    ];
  }
  if (severity) where.severity = severity;
  if (ruleLanguage) where.ruleLanguage = ruleLanguage;

  // SQL-side filtering for the cheap fields, then JSON-array filtering in JS for tags-style fields
  let rows = await prisma.communityRule.findMany({
    where,
    orderBy: { upstreamRuleId: "asc" },
  });

  if (platform) {
    rows = rows.filter((r) => safeJson<string[]>(r.platforms, []).some(
      (p) => p.toLowerCase() === platform.toLowerCase(),
    ));
  }
  if (technique) {
    rows = rows.filter((r) => safeJson<string[]>(r.mitreTechniques, []).some(
      (t) => t.toUpperCase() === technique || t.toUpperCase().startsWith(technique + "."),
    ));
  }
  if (tactic) {
    rows = rows.filter((r) => safeJson<string[]>(r.mitreTactics, []).includes(tactic));
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize).map((r) => ({
    id: r.id,
    upstreamRuleId: r.upstreamRuleId,
    title: r.title,
    description: r.description.slice(0, 240),
    author: r.author,
    severity: r.severity,
    ruleLanguage: r.ruleLanguage,
    ruleType: r.ruleType,
    platforms: safeJson<string[]>(r.platforms, []),
    products: safeJson<string[]>(r.products, []),
    mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(r.mitreTactics, []),
    sourceUrl: r.sourceUrl,
    changeStatus: r.changeStatus,
  }));

  return NextResponse.json({
    enabled: true, registered: true,
    source: { id: source.id, name: source.name, type: source.type },
    items, total, page, pageSize, totalPages: Math.ceil(total / pageSize),
  });
}
