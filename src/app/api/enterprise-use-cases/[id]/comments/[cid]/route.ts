/**
 * DELETE /api/enterprise-use-cases/[id]/comments/[cid] — remove one comment
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await ctx.params;
  const row = await prisma.enterpriseUseCaseComment.findUnique({ where: { id: cid } });
  if (!row || row.useCaseId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.enterpriseUseCaseComment.delete({ where: { id: cid } });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.comment.delete",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCaseComment",
    targetId: cid,
    message: `removed: ${row.kind} comment`,
  });
  return NextResponse.json({ ok: true });
}
