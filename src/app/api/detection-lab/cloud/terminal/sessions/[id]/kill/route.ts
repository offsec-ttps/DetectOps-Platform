/**
 * POST /api/detection-lab/cloud/terminal/sessions/[id]/kill
 *   SIGTERM the session's process and remove it from the session map.
 */

import { NextRequest, NextResponse } from "next/server";
import { killSession, canAccessSession } from "@/lib/terminal-sessions";
import { requireUser } from "@/lib/auth-guard";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // 404 (not 403) so another user's session ids are not confirmable.
  if (!canAccessSession(id, auth.user)) return NextResponse.json({ status: "error", message: "session not found" }, { status: 404 });
  const ok = killSession(id);
  return NextResponse.json({ status: ok ? "ok" : "error" }, { status: ok ? 200 : 404 });
}
