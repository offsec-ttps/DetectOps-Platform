/**
 * DELETE /api/ransomware-intel/keys/[id] — revoke an API key. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await prisma.intelApiKey.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.intelApiKey.update({ where: { id }, data: { enabled: false, revokedAt: new Date() } });
  void logEvent({ category: "ransomware-intel" as any, action: "intel.key.revoke", actor: auth.user.email, status: "ok", targetType: "IntelApiKey", targetId: id, message: `revoked key ${row.prefix}…` });
  return NextResponse.json({ ok: true });
}
