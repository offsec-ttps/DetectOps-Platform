/**
 * POST /api/detection-lab/cloud/terminal/run-tool
 *
 * High-level shortcut: looks up a canned command for a tool/technique and
 * creates a terminal session that runs it on the target server.
 *
 * body: { rangeId, serverName, serverIp, tool, arg }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { buildSshCommand, createSession, TOOL_RUNNERS, type ToolId } from "@/lib/terminal-sessions";

const TOOL_IDS = new Set<ToolId>(Object.keys(TOOL_RUNNERS) as ToolId[]);

export async function POST(req: NextRequest) {
  // Same privilege as the sessions route — runs a tool over SSH on a cloud-range
  // host with shared SAR keys, so admin-only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const rangeId: string | undefined = body?.rangeId;
  const serverName: string | undefined = body?.serverName;
  const serverIp: string | undefined = body?.serverIp;
  const tool: string | undefined = body?.tool;
  const arg: string = body?.arg || "";

  if (!rangeId || !serverName || !serverIp) {
    return NextResponse.json({ status: "error", message: "rangeId, serverName, serverIp required" }, { status: 400 });
  }
  if (!tool || !TOOL_IDS.has(tool as ToolId)) {
    return NextResponse.json({ status: "error", message: `tool must be one of: ${[...TOOL_IDS].join(", ")}` }, { status: 400 });
  }
  if (typeof arg !== "string" || arg.length > 100 || !/^[A-Za-z0-9._-]*$/.test(arg)) {
    return NextResponse.json({ status: "error", message: "arg must be alphanumeric (., _, -) and <= 100 chars" }, { status: 400 });
  }

  const remoteCmd = TOOL_RUNNERS[tool as ToolId](arg);
  let fullCmd: string;
  try { fullCmd = buildSshCommand(rangeId, serverIp, remoteCmd); }
  catch (e: any) {
    return NextResponse.json({
      status: "error",
      message: `Cannot prepare SSH session: ${e?.message || e}`,
    }, { status: 500 });
  }
  const session = createSession({ ownerId: auth.user.id, rangeId, serverName, command: fullCmd });

  return NextResponse.json({
    status: "ok",
    session_id: session.id,
    tool,
    arg,
    command: fullCmd,
  });
}
