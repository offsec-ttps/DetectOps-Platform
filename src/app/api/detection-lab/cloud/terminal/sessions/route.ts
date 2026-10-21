/**
 * POST /api/detection-lab/cloud/terminal/sessions
 *   body: { rangeId, serverName, command, serverIp? }
 *   Creates a session that shells `command` on the target server via SAR's SSH keys.
 *   If command is omitted, a login shell is opened.
 *
 * Two-hop model:
 *   dev-server → docker exec attack-range-api → ssh {user}@{serverIp} → command
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { buildSshCommand, createSession } from "@/lib/terminal-sessions";

export async function POST(req: NextRequest) {
  // Privileged: this opens an SSH shell onto a cloud-range host using the shared
  // SAR controller keys. Cloud ranges have no per-user owner in the DB, so this
  // is admin-only (requireRole gates it). serverIp is validated for shape in
  // buildSshCommand; a strict range-membership check would need a range->hosts
  // model the platform does not currently persist.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const rangeId: string | undefined = body?.rangeId;
  const serverName: string | undefined = body?.serverName;
  const command: string | undefined = body?.command;
  const serverIp: string | undefined = body?.serverIp;

  if (!rangeId || !serverName) {
    return NextResponse.json({ status: "error", message: "rangeId and serverName required" }, { status: 400 });
  }
  if (!serverIp) {
    return NextResponse.json({ status: "error", message: "serverIp required (e.g. 10.0.2.10)" }, { status: 400 });
  }

  // If no command given, open an interactive-ish login shell (bash -i -l).
  const remoteCmd = command || "bash -il";
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
    command: fullCmd,
  });
}
