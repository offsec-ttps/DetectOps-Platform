/**
 * POST /api/v1/node-status   (AGENT-FACING — HTTP heartbeat, stable contract)
 *
 * The long-running agent POSTs this every ~5s. Updates liveness + host facts.
 * A revoked node receives 401 so the agent service stops itself.
 *
 * Body:
 *   {
 *     node_id: string,
 *     api_key: string,
 *     status?: "online",
 *     agent_version?: string,
 *     current_run_id?: string,
 *     host?: { cpu?, ram_used?, ram_total?, os?, edr_running? }
 *   }
 *
 * Returns: { ok: true, directives?: { terminate?: bool } }  (200) or 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authNode } from "@/lib/bas/agent-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const nodeId = String(body.node_id || "");
  const apiKey = String(body.api_key || "");
  if (!nodeId || !apiKey) return NextResponse.json({ error: "node_id + api_key required" }, { status: 400 });

  // Constant-time per-node key verification.
  const node = await authNode(nodeId, apiKey);
  if (!node) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Revoked → tell the agent to terminate.
  if (node.status === "revoked") {
    return NextResponse.json({ ok: false, directives: { terminate: true }, reason: "revoked" }, { status: 401 });
  }

  const host = (body.host && typeof body.host === "object") ? body.host : {};
  await prisma.fleetNode.update({
    where: { id: nodeId },
    data: {
      // Preserve an operator "paused" hold across heartbeats; otherwise a live
      // heartbeat means online.
      status: node.status === "paused" ? "paused" : "online",
      lastSeen: new Date(),
      agentVersion: body.agent_version ? String(body.agent_version).slice(0, 60) : node.agentVersion,
      currentRunId: body.current_run_id ? String(body.current_run_id) : null,
      hostStatus: JSON.stringify(host).slice(0, 4000),
    },
  });

  return NextResponse.json({ ok: true, directives: {} });
}
