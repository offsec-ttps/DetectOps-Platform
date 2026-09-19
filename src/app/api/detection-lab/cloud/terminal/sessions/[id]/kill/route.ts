/**
 * POST /api/detection-lab/cloud/terminal/sessions/[id]/kill
 *   SIGTERM the session's process and remove it from the session map.
 */

import { NextRequest, NextResponse } from "next/server";
import { killSession } from "@/lib/terminal-sessions";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = killSession(id);
  return NextResponse.json({ status: ok ? "ok" : "error" }, { status: ok ? 200 : 404 });
}
