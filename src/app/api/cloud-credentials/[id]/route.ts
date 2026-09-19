/**
 * DELETE /api/cloud-credentials/[id]   — remove a credential
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.cloudCredential.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Ownership check when enforcing (IDOR guard) — 404 to avoid leaking existence.
  if (auth.enforced && existing.ownerId !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.cloudCredential.delete({ where: { id } });
  void logEvent({
    category: "integration", action: "cloud-credential.delete",
    actor: auth.user.email, status: "ok",
    targetType: "CloudCredential", targetId: id,
    message: `${existing.provider} · ${existing.label}`,
  });
  return NextResponse.json({ ok: true });
}
