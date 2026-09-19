/**
 * POST /api/fleets/[id]/tokens/[tokenId]/revoke is handled here as DELETE
 * (revoke = soft, sets revoked=true so audit history is preserved).
 * DELETE /api/fleets/[id]/tokens/[tokenId] — revoke an enrollment token.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireFleetAccess } from "@/lib/bas/fleet";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; tokenId: string }> }) {
  const { id, tokenId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  const row = await prisma.enrollmentToken.findUnique({ where: { id: tokenId } });
  if (!row || row.fleetId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.enrollmentToken.update({ where: { id: tokenId }, data: { revoked: true } });
  void logEvent({
    category: "bas", action: "bas.token.revoke",
    actor: auth.user.email, status: "ok",
    targetType: "EnrollmentToken", targetId: tokenId, message: "revoked",
  });
  return NextResponse.json({ ok: true });
}
