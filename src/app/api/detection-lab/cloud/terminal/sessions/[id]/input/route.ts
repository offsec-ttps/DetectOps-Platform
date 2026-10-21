/**
 * POST /api/detection-lab/cloud/terminal/sessions/[id]/input
 *   body: { data: string }
 *   Sends the raw data (may include control chars) to the session's stdin.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendInput, canAccessSession } from "@/lib/terminal-sessions";
import { requireUser } from "@/lib/auth-guard";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // 404 (not 403) so another user's session ids are not confirmable.
  if (!canAccessSession(id, auth.user)) return NextResponse.json({ status: "error", message: "session not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const data: string = typeof body?.data === "string" ? body.data.slice(0, 64 * 1024) : "";
  const ok = sendInput(id, data);
  if (!ok) return NextResponse.json({ status: "error", message: "session not found or exited" }, { status: 404 });
  return NextResponse.json({ status: "ok" });
}
