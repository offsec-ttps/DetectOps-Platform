/**
 * POST /api/fleets/[id]/campaigns/[campaignId]/halt — stop a campaign.
 *
 * Cancels every still-queued operation (agents won't pick them up) and marks
 * the campaign "halted". Operations already running are left to finish + report
 * (the agent always runs cleanup); we don't interrupt an in-flight test.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireFleetAccess } from "@/lib/bas/fleet";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; campaignId: string }> }) {
  const { id, campaignId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  const campaign = await prisma.fleetCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.fleetId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["completed", "failed", "halted"].includes(campaign.status)) {
    return NextResponse.json({ error: `campaign already ${campaign.status}` }, { status: 409 });
  }

  const cancelled = await prisma.fleetOperation.updateMany({
    where: { campaignId, status: "queued" }, data: { status: "cancelled" },
  });
  await prisma.fleetCampaign.update({ where: { id: campaignId }, data: { status: "halted" } });

  void logEvent({
    category: "bas", action: "bas.campaign.halt",
    actor: auth.user.email, status: "ok",
    targetType: "FleetCampaign", targetId: campaignId,
    message: `halted · ${cancelled.count} queued op(s) cancelled`,
  });

  return NextResponse.json({ ok: true, cancelledOps: cancelled.count });
}
