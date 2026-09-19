/**
 * GET    /api/siem/[id] — one connection (never returns secrets)
 * DELETE /api/siem/[id] — remove it
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { serializeSiem, loadOwnedSiem } from "@/lib/siem/http";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedSiem(id);
  if (!r.ok) return r.response;
  return NextResponse.json({ connection: serializeSiem(r.server) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedSiem(id);
  if (!r.ok) return r.response;
  await prisma.siemConnection.delete({ where: { id } });
  void logEvent({
    category: "detection", action: "siem.delete", actor: r.auth.user.email, status: "ok",
    targetType: "SiemConnection", targetId: id, message: `deleted SIEM connection "${r.server.name}"`,
  });
  return NextResponse.json({ ok: true });
}
