/**
 * POST /api/detection-lab/cloud/sg-sync/[range_id]
 *   body: { revoke_stale?: boolean }  // default false — safer to keep old rules
 *
 * Adds the user's current public IP to the range's router security group for
 * 51820/udp (WireGuard) and 22/tcp (SSH). One-click fix for the recurring
 * "ISP rotated my IP" problem.
 */

import { NextRequest, NextResponse } from "next/server";
import { addCurrentIpToSg, getSgStatus } from "@/lib/sg-sync";

export async function POST(req: NextRequest, ctx: { params: Promise<{ range_id: string }> }) {
  const { range_id } = await ctx.params;
  if (!range_id) return NextResponse.json({ error: "range_id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const revokeStale = body?.revoke_stale === true;

  const result = await addCurrentIpToSg(range_id, { revokeStale });
  if (!result.ok) return NextResponse.json({ status: "error", message: result.error }, { status: 500 });

  // Fetch fresh status so the UI can re-render without a second round-trip.
  const after = await getSgStatus(range_id);
  return NextResponse.json({ status: "ok", ...result, after });
}
