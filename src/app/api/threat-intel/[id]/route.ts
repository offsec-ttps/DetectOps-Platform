import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Try Threadlinqs report first (by DB id or threatId)
  let report = await prisma.threatIntelReport.findUnique({ where: { id } });
  if (!report) report = await prisma.threatIntelReport.findUnique({ where: { threatId: id } });

  if (report) {
    return NextResponse.json({
      ...report,
      mitreTechniques: JSON.parse(report.mitreTechniques),
      iocs: JSON.parse(report.iocs),
      detections: JSON.parse(report.detections),
      timeline: JSON.parse(report.timeline),
      references: JSON.parse(report.references),
      remediation: JSON.parse(report.remediation),
      targetSectors: JSON.parse(report.targetSectors),
      targetRegions: JSON.parse(report.targetRegions),
      tags: JSON.parse(report.tags),
      affected: JSON.parse(report.affected),
      threatActorAliases: JSON.parse(report.threatActorAliases),
    });
  }

  // Try article
  const article = await prisma.tiArticle.findUnique({
    where: { id },
    include: { source: true, indicators: true },
  });
  if (article) {
    return NextResponse.json({
      ...article,
      tags: JSON.parse(article.tags),
      indicators: article.indicators.map((i) => ({
        ...i, mitreTechniques: JSON.parse(i.mitreTechniques), tags: JSON.parse(i.tags),
      })),
    });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
