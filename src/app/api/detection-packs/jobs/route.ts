/**
 * GET /api/detection-packs/jobs
 *
 * Paginated job queue view + current budget snapshot.
 *
 *   ?status=queued|running|completed|failed|budget-exceeded
 *   ?sourceTable=...
 *   ?page=&pageSize=
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBudgetSnapshot } from "@/lib/detection-packs/budget";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10)));
  const status = sp.get("status") || "";
  const sourceTable = sp.get("sourceTable") || "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (sourceTable) where.sourceTable = sourceTable;

  const [items, total, byStatus, budget] = await Promise.all([
    prisma.detectionPackJob.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.detectionPackJob.count({ where: where as any }),
    prisma.detectionPackJob.groupBy({ by: ["status"], _count: true }),
    getBudgetSnapshot(),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    byStatus: byStatus.map((x) => ({ status: x.status, count: x._count })),
    budget: {
      ...budget,
      // Infinity isn't serialisable
      remainingTokens: budget.remainingTokens === Infinity ? null : budget.remainingTokens,
    },
  });
}
