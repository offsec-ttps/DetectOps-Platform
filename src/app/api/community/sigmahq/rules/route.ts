import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSigmaHQSource } from "@/lib/sigmahq/sync";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));
  const textSearch = searchParams.get("text_search") || "";
  const status = searchParams.get("status") || "";
  const level = searchParams.get("level") || "";
  const tag = searchParams.get("tag") || "";
  const mitreTechnique = searchParams.get("mitre_technique") || "";
  const logsourceProduct = searchParams.get("logsource_product") || "";
  const changeStatus = searchParams.get("change_status") || "";
  const sortBy = searchParams.get("sort_by") || "title";
  const sortDir = searchParams.get("sort_dir") === "desc" ? "desc" : "asc";

  const sourceId = await ensureSigmaHQSource();

  // Build where clause
  const where: Record<string, unknown> = { sourceId };

  if (textSearch) {
    where.OR = [
      { title: { contains: textSearch } },
      { description: { contains: textSearch } },
      { tags: { contains: textSearch } },
    ];
  }
  if (status) where.status = status;
  if (level) where.level = level;
  if (logsourceProduct) where.logsourceProduct = logsourceProduct;
  if (changeStatus) where.changeStatus = changeStatus;
  if (tag) where.tags = { contains: tag };
  if (mitreTechnique) where.mitreTechniques = { contains: mitreTechnique };

  const [rules, total] = await Promise.all([
    prisma.communitySigmaRule.findMany({
      where: where as any,
      select: {
        id: true,
        title: true,
        status: true,
        level: true,
        tags: true,
        mitreTechniques: true,
        logsourceProduct: true,
        logsourceCategory: true,
        filePath: true,
        changeStatus: true,
        importStatus: true,
        author: true,
        date: true,
        modified: true,
      },
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.communitySigmaRule.count({ where: where as any }),
  ]);

  // Parse JSON string fields for the response
  const items = rules.map((r) => ({
    ...r,
    tags: JSON.parse(r.tags),
    mitreTechniques: JSON.parse(r.mitreTechniques),
  }));

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
