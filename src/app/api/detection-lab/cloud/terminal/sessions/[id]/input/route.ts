/**
 * POST /api/detection-lab/cloud/terminal/sessions/[id]/input
 *   body: { data: string }
 *   Sends the raw data (may include control chars) to the session's stdin.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendInput } from "@/lib/terminal-sessions";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const data: string = body?.data ?? "";
  const ok = sendInput(id, data);
  if (!ok) return NextResponse.json({ status: "error", message: "session not found or exited" }, { status: 404 });
  return NextResponse.json({ status: "ok" });
}
