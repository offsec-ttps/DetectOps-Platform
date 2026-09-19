import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Pagination
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") || "50", 10)));

  // Filters
  const search = searchParams.get("search") || "";
  const technique = searchParams.get("technique") || "";
  const tactic = searchParams.get("tactic") || "";
  const category = searchParams.get("category") || "";
  const type = searchParams.get("type") || "";
  const status = searchParams.get("status") || "";
  const securityDomain = searchParams.get("security_domain") || "";
  const sortBy = searchParams.get("sort_by") || "name";
  const sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";

  // Build where clause
  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { mitreTechniques: { contains: search } },
      { analyticStories: { contains: search } },
    ];
  }
  if (technique) where.mitreTechniques = { contains: technique };
  if (tactic) where.mitreTactics = { contains: tactic };
  if (category) where.category = category;
  if (type) where.type = type;
  if (status) where.status = status;
  if (securityDomain) where.securityDomain = securityDomain;

  const [detections, total] = await Promise.all([
    prisma.splunkDetection.findMany({
      where: where as any,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.splunkDetection.count({ where: where as any }),
  ]);

  // Parse JSON fields
  const items = detections.map((d) => ({
    ...d,
    dataSource: JSON.parse(d.dataSource),
    references: JSON.parse(d.references),
    mitreTechniques: JSON.parse(d.mitreTechniques),
    mitreTactics: JSON.parse(d.mitreTactics),
    analyticStories: JSON.parse(d.analyticStories),
    products: JSON.parse(d.products),
  }));

  // Aggregate stats (only on first page)
  let stats = null;
  if (page === 1) {
    const [
      totalDetections,
      categories,
      types,
      statuses,
      domains,
    ] = await Promise.all([
      prisma.splunkDetection.count(),
      prisma.splunkDetection.groupBy({ by: ["category"], _count: true }),
      prisma.splunkDetection.groupBy({ by: ["type"], _count: true }),
      prisma.splunkDetection.groupBy({ by: ["status"], _count: true }),
      prisma.splunkDetection.groupBy({ by: ["securityDomain"], _count: true }),
    ]);

    // Extract unique tactics and techniques from JSON fields
    const allDetections = await prisma.splunkDetection.findMany({
      select: { mitreTechniques: true, mitreTactics: true },
    });

    const tacticCounts = new Map<string, number>();
    const techniqueSet = new Set<string>();
    for (const d of allDetections) {
      const techs: string[] = JSON.parse(d.mitreTechniques);
      const tactics: string[] = JSON.parse(d.mitreTactics);
      for (const t of techs) techniqueSet.add(t);
      for (const t of tactics) tacticCounts.set(t, (tacticCounts.get(t) || 0) + 1);
    }

    const lastSync = await prisma.splunkSyncMeta.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
    });

    stats = {
      totalDetections,
      totalTechniques: techniqueSet.size,
      categories: categories
        .filter((c) => c.category)
        .map((c) => ({ name: c.category, count: c._count }))
        .sort((a, b) => b.count - a.count),
      types: types
        .filter((t) => t.type)
        .map((t) => ({ name: t.type, count: t._count }))
        .sort((a, b) => b.count - a.count),
      statuses: statuses
        .filter((s) => s.status)
        .map((s) => ({ name: s.status, count: s._count }))
        .sort((a, b) => b.count - a.count),
      securityDomains: domains
        .filter((d) => d.securityDomain)
        .map((d) => ({ name: d.securityDomain, count: d._count }))
        .sort((a, b) => b.count - a.count),
      tactics: Array.from(tacticCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      lastSyncAt: lastSync?.completedAt?.toISOString() || null,
      lastSyncCommit: lastSync?.commitSha || null,
    };
  }

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    stats,
  });
}
