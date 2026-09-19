/**
 * GET /api/stratus-attacks
 *   ?platform=&tactic=&q=&page=&pageSize=
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
  if (sp.get("platform")) where.platform = sp.get("platform");
  if (sp.get("tactic")) where.tactic = sp.get("tactic");
  const q = sp.get("q");
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { attackId: { contains: q } },
      { description: { contains: q } },
    ];
  }

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(sp.get("pageSize") || "200", 10)));

  const [rows, total, platforms, tactics] = await Promise.all([
    prisma.stratusAttack.findMany({
      where: where as any,
      orderBy: [{ platform: "asc" }, { tactic: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stratusAttack.count({ where: where as any }),
    prisma.stratusAttack.findMany({ distinct: ["platform"], select: { platform: true }, orderBy: { platform: "asc" } }),
    prisma.stratusAttack.findMany({ distinct: ["tactic"], select: { tactic: true }, orderBy: { tactic: "asc" } }),
  ]);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    })),
    total, page, pageSize,
    platforms: platforms.map((p) => p.platform),
    tactics: tactics.map((t) => t.tactic),
  });
}
