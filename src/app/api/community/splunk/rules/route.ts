import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));
  const textSearch = searchParams.get("text_search") || "";
  const technique = searchParams.get("mitre_technique") || "";
  const tactic = searchParams.get("tactic") || "";
  const category = searchParams.get("category") || "";
  const type = searchParams.get("type") || "";
  const status = searchParams.get("status") || "";
  const securityDomain = searchParams.get("security_domain") || "";
  const sortBy = searchParams.get("sort_by") || "name";
  const sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";

  const where: Record<string, unknown> = {};

  if (textSearch) {
    where.OR = [
      { name: { contains: textSearch } },
      { description: { contains: textSearch } },
      { mitreTechniques: { contains: textSearch } },
      { analyticStories: { contains: textSearch } },
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
      select: {
        id: true,
        detectionId: true,
        name: true,
        description: true,
        author: true,
        date: true,
        status: true,
        type: true,
        mitreTechniques: true,
        mitreTactics: true,
        analyticStories: true,
        securityDomain: true,
        category: true,
        filePath: true,
        sourceUrl: true,
        search: true,
        verified: true,
        verifiedAt: true,
        verifiedTechnique: true,
      },
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.splunkDetection.count({ where: where as any }),
  ]);

  const items = detections.map((d) => ({
    ...d,
    mitreTechniques: JSON.parse(d.mitreTechniques),
    mitreTactics: JSON.parse(d.mitreTactics),
    analyticStories: JSON.parse(d.analyticStories),
  }));

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
