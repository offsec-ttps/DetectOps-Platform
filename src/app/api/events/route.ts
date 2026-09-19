/**
 * GET /api/events
 *
 * Unified event log query. Filters by category, action prefix, actor, status,
 * target type/id, and time range; paginated newest-first.
 *
 * Query params:
 *   category=auth|sigma|simulation|detection|report|build|lab|integration|workspace|system|other
 *   action=auth.login            // exact match
 *   actionPrefix=auth.           // starts-with match
 *   actor=user@example.com
 *   status=ok|error|warn|info
 *   targetType=simulation
 *   targetId=...
 *   from=2026-06-05T00:00:00Z
 *   to=2026-06-05T23:59:59Z
 *   q=substring                  // searches `message` (LIKE)
 *   page=1
 *   pageSize=50                  // capped at 200
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

  const category = sp.get("category");
  if (category) where.category = category;
  const action = sp.get("action");
  if (action) where.action = action;
  const actionPrefix = sp.get("actionPrefix");
  if (actionPrefix) where.action = { startsWith: actionPrefix };
  const actor = sp.get("actor");
  if (actor) where.actor = actor;
  const status = sp.get("status");
  if (status) where.status = status;
  const targetType = sp.get("targetType");
  if (targetType) where.targetType = targetType;
  const targetId = sp.get("targetId");
  if (targetId) where.targetId = targetId;
  const q = sp.get("q");
  if (q) where.message = { contains: q };

  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    const tsFilter: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) tsFilter.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) tsFilter.lte = d;
    }
    where.ts = tsFilter;
  }

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10)));

  const [rows, total] = await Promise.all([
    prisma.eventLog.findMany({
      where: where as any,
      orderBy: { ts: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.eventLog.count({ where: where as any }),
  ]);

  return NextResponse.json({
    items: rows.map((r) => ({ ...r, details: safeJson<Record<string, unknown>>(r.details, {}) })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
