import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [
    threatCount, articleCount, indicatorCount, sourceCount,
    threatsByCategory, threatsBySeverity, threatsByActor, threatsByNation,
    indicatorsByType, sourcesByCategory,
    recentThreats, recentArticles,
    activeSources, latestSync,
    // Top sources by article count
    topSources,
  ] = await Promise.all([
    prisma.threatIntelReport.count(),
    prisma.tiArticle.count(),
    prisma.tiIndicator.count(),
    prisma.tiFeedSource.count(),
    prisma.threatIntelReport.groupBy({ by: ["category"], _count: true, orderBy: { _count: { category: "desc" } } }),
    prisma.threatIntelReport.groupBy({ by: ["severityLevel"], _count: true }),
    prisma.threatIntelReport.groupBy({ by: ["threatActor"], _count: true, orderBy: { _count: { threatActor: "desc" } }, take: 20 }),
    prisma.threatIntelReport.groupBy({ by: ["nationState"], _count: true, orderBy: { _count: { nationState: "desc" } }, take: 10 }),
    prisma.tiIndicator.groupBy({ by: ["type"], _count: true, orderBy: { _count: { type: "desc" } } }),
    prisma.tiFeedSource.groupBy({ by: ["category"], _count: true }),
    prisma.threatIntelReport.findMany({ orderBy: { sourceCreated: "desc" }, take: 10, select: { id: true, threatId: true, title: true, severityLevel: true, category: true, threatActor: true, nationState: true, sourceCreated: true, detectionCount: true, cvssScore: true } }),
    prisma.tiArticle.findMany({ orderBy: { publishedAt: "desc" }, take: 10, include: { source: { select: { name: true, category: true } } } }),
    prisma.tiFeedSource.count({ where: { active: true } }),
    prisma.tiAggregatorSync.findFirst({ where: { status: "completed" }, orderBy: { completedAt: "desc" } }),
    prisma.tiFeedSource.findMany({ where: { articleCount: { gt: 0 } }, orderBy: { articleCount: "desc" }, take: 15, select: { name: true, category: true, articleCount: true, indicatorCount: true, lastFetchedAt: true } }),
  ]);

  // Daily article counts (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentArticlesByDate = await prisma.tiArticle.findMany({
    where: { publishedAt: { gte: thirtyDaysAgo } },
    select: { publishedAt: true },
  });

  const dailyArticleCounts: Record<string, number> = {};
  for (const a of recentArticlesByDate) {
    if (a.publishedAt) {
      const day = a.publishedAt.toISOString().split("T")[0];
      dailyArticleCounts[day] = (dailyArticleCounts[day] || 0) + 1;
    }
  }

  // Daily threat counts
  const dailyThreatCounts: Record<string, number> = {};
  const recentThreatsForChart = await prisma.threatIntelReport.findMany({
    where: { sourceCreated: { gte: thirtyDaysAgo } },
    select: { sourceCreated: true },
  });
  for (const t of recentThreatsForChart) {
    if (t.sourceCreated) {
      const day = t.sourceCreated.toISOString().split("T")[0];
      dailyThreatCounts[day] = (dailyThreatCounts[day] || 0) + 1;
    }
  }

  // Sectors
  const sectorMap: Record<string, number> = {};
  const allThreats = await prisma.threatIntelReport.findMany({ select: { targetSectors: true } });
  for (const t of allThreats) {
    for (const s of JSON.parse(t.targetSectors) as string[]) {
      const norm = s.toLowerCase().replace(/-/g, " ");
      sectorMap[norm] = (sectorMap[norm] || 0) + 1;
    }
  }
  const topSectors = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));

  // IoC totals summary
  const iocSummary: Record<string, number> = {};
  for (const t of indicatorsByType) { iocSummary[t.type] = t._count; }

  // Articles with IoCs (top articles by IoC count)
  const topArticlesByIoc = await prisma.tiArticle.findMany({
    where: { iocCount: { gt: 0 } },
    orderBy: { iocCount: "desc" },
    take: 10,
    include: { source: { select: { name: true } } },
  });

  return NextResponse.json({
    counts: {
      threats: threatCount,
      articles: articleCount,
      indicators: indicatorCount,
      sources: sourceCount,
      activeSources,
    },
    iocSummary,
    categories: threatsByCategory.map((c) => ({ name: c.category || "Unknown", count: c._count })),
    severities: threatsBySeverity.map((s) => ({ name: s.severityLevel || "Unknown", count: s._count })),
    actors: threatsByActor.filter((a) => a.threatActor).map((a) => ({ name: a.threatActor, count: a._count })),
    nations: threatsByNation.filter((n) => n.nationState).map((n) => ({ name: n.nationState, count: n._count })),
    indicatorTypes: indicatorsByType.map((i) => ({ name: i.type, count: i._count })),
    sourceCategories: sourcesByCategory.map((s) => ({ name: s.category, count: s._count })),
    sectors: topSectors,
    dailyArticleCounts: Object.entries(dailyArticleCounts).sort().map(([date, count]) => ({ date, count })),
    dailyThreatCounts: Object.entries(dailyThreatCounts).sort().map(([date, count]) => ({ date, count })),
    recentThreats,
    recentArticles: recentArticles.map((a) => ({
      id: a.id, title: a.title, url: a.url, publishedAt: a.publishedAt,
      iocCount: a.iocCount, tags: JSON.parse(a.tags),
      sourceName: a.source?.name, sourceCategory: a.source?.category,
    })),
    topSources,
    topArticlesByIoc: topArticlesByIoc.map((a) => ({
      id: a.id, title: a.title, url: a.url, iocCount: a.iocCount, sourceName: a.source?.name,
    })),
    lastSync: latestSync ? {
      completedAt: latestSync.completedAt,
      articlesFound: latestSync.articlesFound,
      indicatorsFound: latestSync.indicatorsFound,
      sourcesProcessed: latestSync.sourcesProcessed,
    } : null,
  });
}
