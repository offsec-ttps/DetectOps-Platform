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
  // Interpolated into controller URLs and an AWS `Name=tag:Name,Values=…` filter
  // (a comma or '*' would widen the match to other instances' security groups).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(range_id)) return NextResponse.json({ error: "invalid range_id" }, { status: 400 });
  const status = await getSgStatus(range_id);
  return NextResponse.json(status);
}
