/**
 * GET /api/purplesharp-templates   — list (paged + filterable)
 *   ?q=&group=&page=&pageSize=
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = {};
  const q = sp.get("q");
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { scenarioPath: { contains: q } },
    ];
  }
  const group = sp.get("group");
  if (group) where.group = group;

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "100", 10)));

  const [rows, total] = await Promise.all([
    prisma.purpleSharpTemplate.findMany({
      where: where as any,
      orderBy: [{ category: "asc" }, { group: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purpleSharpTemplate.count({ where: where as any }),
  ]);

  // Distinct groups for filter UI
  const groups = await prisma.purpleSharpTemplate.findMany({
    distinct: ["group"], select: { group: true }, orderBy: { group: "asc" },
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    groups: groups.map((g) => g.group).filter(Boolean),
  });
}
