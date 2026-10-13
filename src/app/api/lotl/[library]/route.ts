/**
 * GET /api/lotl/[library] — paginated / filtered / sorted list of a LOTL
 * library's techniques plus aggregate stats (first page only). Mirrors the
 * shape of GET /api/atomic-tests so the shared browser component can consume
 * either.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRegistry } from "@/lib/lotl/registry";

const SORTABLE = new Set(["name", "techniqueId", "executor", "riskLevel", "elevationRequired", "tactic"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ library: string }> }) {
  const { library } = await ctx.params;
  const ingestor = getRegistry().get(library);
  if (!ingestor) return NextResponse.json({ error: `unknown library: ${library}` }, { status: 404 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("page_size") || "50", 10)));

  const search = sp.get("search") || "";
  const techniqueId = sp.get("technique_id") || "";
  const platform = sp.get("platform") || "";
  const executor = sp.get("executor") || "";
  const risk = sp.get("risk") || "";
  const elevation = sp.get("elevation");
  const sortByRaw = sp.get("sort_by") || "name";
  const sortBy = SORTABLE.has(sortByRaw) ? sortByRaw : "name";
  const sortDir = sp.get("sort_dir") === "desc" ? "desc" : "asc";

  const where: Record<string, unknown> = { library };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { techniqueId: { contains: search } },
      { command: { contains: search } },
    ];
  }
  if (techniqueId) where.techniqueId = { contains: techniqueId };
  if (platform) where.platforms = { contains: platform };
  if (executor) where.executor = executor;
  if (risk) where.riskLevel = risk;
  if (elevation === "true") where.elevationRequired = true;
  if (elevation === "false") where.elevationRequired = false;

  // Select-all support: return just the ids of every row matching the current
  // filters (no pagination), so the UI can select an entire library at once.
  if (sp.get("ids_only") === "1") {
    const idRows = await prisma.lotlTechnique.findMany({ where: where as any, select: { id: true }, take: 10000 });
    return NextResponse.json({ library, ids: idRows.map((r) => r.id), total: idRows.length });
  }

  // Resolve a specific id set (used by the Campaign Designer handoff) → full rows.
  const idsParam = sp.get("ids");
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2000);
    const rows = await prisma.lotlTechnique.findMany({ where: { library, id: { in: ids } }, take: 2000 });
    return NextResponse.json({
      library,
      items: rows.map((r) => ({ ...r, platforms: JSON.parse(r.platforms), metadata: JSON.parse(r.metadata) })),
      total: rows.length,
    });
  }

  const [rows, total] = await Promise.all([
    prisma.lotlTechnique.findMany({
      where: where as any,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lotlTechnique.count({ where: where as any }),
  ]);

  const items = rows.map((r) => ({
    ...r,
    platforms: JSON.parse(r.platforms),
    metadata: JSON.parse(r.metadata),
  }));

  let stats = null;
  if (page === 1) {
    const [totalTests, techniques, executors, risks, platformRows] = await Promise.all([
      prisma.lotlTechnique.count({ where: { library } }),
      prisma.lotlTechnique.groupBy({ by: ["techniqueId"], where: { library }, _count: true }),
      prisma.lotlTechnique.groupBy({ by: ["executor"], where: { library }, _count: true }),
      prisma.lotlTechnique.groupBy({ by: ["riskLevel"], where: { library }, _count: true }),
      prisma.lotlTechnique.findMany({ where: { library }, select: { platforms: true }, distinct: ["platforms"] }),
    ]);
    const platformSet = new Set<string>();
    for (const p of platformRows) for (const v of JSON.parse(p.platforms)) if (v) platformSet.add(v);
    const sync = await prisma.lotlSyncMeta.findUnique({ where: { library } });
    stats = {
      totalTests,
      totalTechniques: techniques.filter((t) => t.techniqueId).length,
      executors: executors.filter((e) => e.executor).map((e) => ({ name: e.executor, count: e._count })).sort((a, b) => b.count - a.count),
      risks: risks.map((r) => ({ name: r.riskLevel, count: r._count })),
      platforms: Array.from(platformSet).sort(),
      lastSyncAt: sync?.completedAt?.toISOString() || null,
      lastSyncCommit: sync?.commitSha || null,
      syncStatus: sync?.status || "never",
    };
  }

  return NextResponse.json({
    library,
    displayName: ingestor.displayName,
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    stats,
  });
}
