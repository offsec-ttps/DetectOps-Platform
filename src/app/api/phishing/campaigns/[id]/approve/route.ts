/**
 * POST /api/phishing/campaigns/[id]/approve — admin approval gate.
 * Body: { decision: "approve" | "reject", note? }. Required before launch.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const decision = body.decision === "reject" ? "reject" : "approve";

  const r = await prisma.phishingCampaign.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["pending_approval", "draft"].includes(r.status)) return NextResponse.json({ error: `campaign is ${r.status}; cannot decide` }, { status: 409 });

  let approval: any = {}; try { approval = JSON.parse(r.approval); } catch {}
  approval = { ...approval, approvedBy: auth.user.email, approvedAt: new Date().toISOString(), decision, note: String(body.note || "") };
  const status = decision === "reject" ? "rejected" : "approved";
  await prisma.phishingCampaign.update({ where: { id }, data: { status, approval: JSON.stringify(approval) } });
  void logEvent({ category: "phishing" as any, action: "phishing.campaign.approve", actor: auth.user.email, status: "ok", targetType: "PhishingCampaign", targetId: id, message: `${r.name} ${decision === "reject" ? "rejected" : "approved"}` });
  return NextResponse.json({ ok: true, status });
}
