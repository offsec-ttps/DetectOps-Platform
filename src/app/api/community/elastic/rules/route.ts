import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureElasticSource } from "@/lib/elastic/sync";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));
  const textSearch = searchParams.get("text_search") || "";
  const severity = searchParams.get("severity") || "";
  const type = searchParams.get("type") || "";
  const platform = searchParams.get("platform") || "";
  const mitreTechnique = searchParams.get("mitre_technique") || "";
  const changeStatus = searchParams.get("change_status") || "";
  const sortBy = searchParams.get("sort_by") || "name";
  const sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";

  const sourceId = await ensureElasticSource();

  const where: Record<string, unknown> = { sourceId };

  if (textSearch) {
    where.OR = [
      { name: { contains: textSearch } },
      { description: { contains: textSearch } },
      { tags: { contains: textSearch } },
    ];
  }
  if (severity) where.severity = severity;
  if (type) where.type = type;
  if (platform) where.platform = platform;
  if (changeStatus) where.changeStatus = changeStatus;
  if (mitreTechnique) where.mitreTechniques = { contains: mitreTechnique };

  const [rules, total] = await Promise.all([
    prisma.communityElasticRule.findMany({
      where: where as any,
      select: {
        id: true,
        name: true,
        severity: true,
        riskScore: true,
        type: true,
        language: true,
        tags: true,
        mitreTechniques: true,
        mitreTactics: true,
        platform: true,
        filePath: true,
        changeStatus: true,
        importStatus: true,
        author: true,
        updatedDate: true,
      },
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.communityElasticRule.count({ where: where as any }),
  ]);

  const items = rules.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags),
    mitreTechniques: JSON.parse(r.mitreTechniques),
    mitreTactics: JSON.parse(r.mitreTactics),
    author: JSON.parse(r.author),
  }));

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
