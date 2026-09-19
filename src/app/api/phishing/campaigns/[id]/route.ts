/**
 * GET    /api/phishing/campaigns/[id] — campaign detail
 * DELETE /api/phishing/campaigns/[id] — delete (owner/admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const r = await prisma.phishingCampaign.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: r.id, name: r.name, mode: r.mode, status: r.status,
    config: j<any>(r.config, {}), generated: j<any>(r.generated, {}), techniques: j<string[]>(r.techniques, []),
    approval: j<any>(r.approval, {}), results: j<any>(r.results, {}), runId: r.runId,
    createdAt: r.createdAt, launchedAt: r.launchedAt, completedAt: r.completedAt,
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const r = await prisma.phishingCampaign.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, r.ownerId);
  if (!owns.ok) return owns.response;
  await prisma.phishingCampaign.delete({ where: { id } });
  void logEvent({ category: "phishing" as any, action: "phishing.campaign.delete", actor: auth.user.email, status: "ok", targetType: "PhishingCampaign", targetId: id, message: `${r.name} deleted` });
  return NextResponse.json({ ok: true });
}
