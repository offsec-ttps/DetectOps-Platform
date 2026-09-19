/**
 * GET  /api/enterprise-use-cases/[id]/comments — list with optional ?runId filter
 * POST /api/enterprise-use-cases/[id]/comments — create
 *
 * POST body:
 *   { body: string, kind?: "note"|"review"|"tuning"|"hand-off"|"escalation", runId?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const KINDS = new Set(["note", "review", "tuning", "hand-off", "escalation"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const runId = sp.get("runId") || "";
  const where: Record<string, unknown> = { useCaseId: id };
  if (runId) where.runId = runId;
  const rows = await prisma.enterpriseUseCaseComment.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({
    items: rows.map((c) => ({
      id: c.id, author: c.author, body: c.body, kind: c.kind, runId: c.runId, createdAt: c.createdAt,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const text = String(body.body || "").trim();
  if (!text) return NextResponse.json({ error: "body is required" }, { status: 400 });
  const kind = String(body.kind || "note");
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of ${[...KINDS].join("|")}` }, { status: 400 });
  }
  const runId = body.runId ? String(body.runId) : null;
  if (runId) {
    const run = await prisma.enterpriseUseCaseRun.findUnique({ where: { id: runId }, select: { useCaseId: true } });
    if (!run || run.useCaseId !== id) {
      return NextResponse.json({ error: "runId does not belong to this use case" }, { status: 400 });
    }
  }

  const sessionUser = await getSessionUser().catch(() => null);
  const row = await prisma.enterpriseUseCaseComment.create({
    data: {
      useCaseId: id,
      runId,
      author: sessionUser?.email || "anonymous",
      body: text.slice(0, 8000),
      kind,
    },
  });

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.comment.create",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCaseComment",
    targetId: row.id,
    message: `${kind} · ${text.length} chars${runId ? ` · run=${runId.slice(0, 8)}` : ""}`,
    details: { useCaseId: id, runId, kind, length: text.length },
  });

  return NextResponse.json({
    id: row.id, author: row.author, body: row.body, kind: row.kind, runId: row.runId, createdAt: row.createdAt,
  });
}
