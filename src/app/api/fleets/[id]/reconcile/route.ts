/**
 * POST /api/fleets/[id]/reconcile — run reconciliation for one fleet now.
 *
 * Times out stuck operations + rolls up finished campaigns. Reads already
 * reconcile on-demand; this is the explicit/cron entry point. (When NATS lands,
 * the fleet-worker runs this on a loop instead.)
 */

import { NextRequest, NextResponse } from "next/server";
import { reconcile } from "@/lib/bas/reconcile";
import { requireFleetAccess } from "@/lib/bas/fleet";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  const r = await reconcile(id);
  return NextResponse.json({ ok: true, ...r });
}
