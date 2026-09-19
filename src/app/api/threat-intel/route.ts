import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET — List threat intel reports (from Threadlinqs) + articles (from RSS) */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));
  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "";
  const severity = searchParams.get("severity") || "";
  const actor = searchParams.get("actor") || "";
  const nation = searchParams.get("nation") || "";
  const view = searchParams.get("view") || "threats"; // threats | articles | indicators

  if (view === "articles") {
    const where: Record<string, unknown> = {};
    if (search) where.OR = [{ title: { contains: search } }, { summary: { contains: search } }];
    const [items, total] = await Promise.all([
      prisma.tiArticle.findMany({
        where: where as any,
        include: { source: { select: { name: true, category: true } } },
        orderBy: { publishedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.tiArticle.count({ where: where as any }),
    ]);
    return NextResponse.json({ items: items.map((a) => ({ ...a, tags: JSON.parse(a.tags) })), total, page, totalPages: Math.ceil(total / pageSize) });
  }

  if (view === "indicators") {
    const where: Record<string, unknown> = {};
    if (search) where.OR = [{ value: { contains: search } }, { context: { contains: search } }];
    if (category) where.type = category;
    const [items, total] = await Promise.all([
      prisma.tiIndicator.findMany({
        where: where as any,
        orderBy: { lastSeen: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.tiIndicator.count({ where: where as any }),
    ]);
    return NextResponse.json({
      items: items.map((i) => ({ ...i, mitreTechniques: JSON.parse(i.mitreTechniques), tags: JSON.parse(i.tags) })),
      total, page, totalPages: Math.ceil(total / pageSize),
    });
  }

  // Default: threat reports (all sources unified)
  const source = searchParams.get("source") || ""; // threadlinqs | rss | all
  const where: Record<string, unknown> = {};
  if (search) where.OR = [{ title: { contains: search } }, { summary: { contains: search } }, { threatActor: { contains: search } }];
  if (category) where.category = category;
  if (severity) where.severityLevel = severity;
  if (actor) where.threatActor = { contains: actor };
  if (nation) where.nationState = { contains: nation };
  if (source) where.sourceVendor = source;

  const [items, total] = await Promise.all([
    prisma.threatIntelReport.findMany({
      where: where as any,
      orderBy: { sourceCreated: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.threatIntelReport.count({ where: where as any }),
  ]);

  const parsed = items.map((t) => ({
    ...t,
    mitreTechniques: JSON.parse(t.mitreTechniques),
    iocs: JSON.parse(t.iocs),
    detections: JSON.parse(t.detections),
    timeline: JSON.parse(t.timeline),
    references: JSON.parse(t.references),
    remediation: JSON.parse(t.remediation),
    targetSectors: JSON.parse(t.targetSectors),
    targetRegions: JSON.parse(t.targetRegions),
    tags: JSON.parse(t.tags),
    affected: JSON.parse(t.affected),
    threatActorAliases: JSON.parse(t.threatActorAliases),
  }));

  return NextResponse.json({ items: parsed, total, page, totalPages: Math.ceil(total / pageSize) });
}
