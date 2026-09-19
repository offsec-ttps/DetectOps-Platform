/** POST /api/phishing/campaigns/[id]/abort — per-campaign abort. */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const r = await prisma.phishingCampaign.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.phishingCampaign.update({ where: { id }, data: { status: "aborted", completedAt: new Date() } });
  void logEvent({ category: "phishing" as any, action: "phishing.campaign.abort", actor: auth.user.email, status: "warn", targetType: "PhishingCampaign", targetId: id, message: `${r.name} aborted` });
  return NextResponse.json({ ok: true, status: "aborted" });
}
