import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET — search and list indicators with enrichment data */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("page_size") || "20", 10)));
  const search = searchParams.get("search") || "";
  const type = searchParams.get("type") || "";
  const confidence = searchParams.get("confidence") || "";

  const where: Record<string, unknown> = {};
  if (search) where.OR = [
    { value: { contains: search } },
    { context: { contains: search } },
    { tags: { contains: search } },
    { sourceRef: { contains: search } },
  ];
  if (type) where.type = type;
  if (confidence) where.confidence = confidence;

  const [items, total] = await Promise.all([
    prisma.tiIndicator.findMany({
      where: where as any,
      include: {
        article: {
          select: {
            id: true,
            title: true,
            url: true,
            publishedAt: true,
            summary: true,
            source: { select: { name: true, category: true } },
          },
        },
      },
      orderBy: { lastSeen: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tiIndicator.count({ where: where as any }),
  ]);

  // Enrich with correlation — check if this IoC value appears in any Threadlinqs threat IOCs
  const enriched = items.map((i) => {
    const techniques = JSON.parse(i.mitreTechniques) as string[];
    const tags = JSON.parse(i.tags) as string[];
    return {
      ...i,
      mitreTechniques: techniques,
      tags,
      // Derived fields for UI
      hasActorCorrelation: tags.some((t) => !t.startsWith("T") && t.length > 2),
      actorNames: tags.filter((t) => !t.startsWith("T") && t.length > 2),
      techniqueCount: techniques.length,
      articleTitle: i.article?.title || null,
      articleUrl: i.article?.url || null,
      sourceName: i.article?.source?.name || null,
      sourceCategory: i.article?.source?.category || null,
    };
  });

  return NextResponse.json({
    items: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
