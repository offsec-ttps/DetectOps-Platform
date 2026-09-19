/**
 * GET /api/detection-lab/cloud/sg-status/[range_id]
 * Returns whether the user's current public IP matches the allowed CIDRs on
 * the range's router security group. UI uses this to render a sync banner.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSgStatus } from "@/lib/sg-sync";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ range_id: string }> }) {
  const { range_id } = await ctx.params;
  if (!range_id) return NextResponse.json({ error: "range_id required" }, { status: 400 });
  const status = await getSgStatus(range_id);
  return NextResponse.json(status);
}
