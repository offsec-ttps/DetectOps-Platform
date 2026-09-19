/**
 * POST /api/v1/authorize-node   (AGENT-FACING — stable contract)
 *
 * Called by the long-running service at startup (and periodically) to
 * re-confirm the node is still active and refresh its runtime config. This is
 * the recurring counterpart to the one-time `enroll-node`.
 *
 * Auth: the per-node api_key (verified against the stored AES-GCM value). This
 * is correct for headless agents — they hold no browser session; the api_key
 * issued at enrollment IS their credential.
 *
 * Body:    { node_id, api_key, agent_version? }
 * Returns: { ok, allowed_scope, heartbeat_url, heartbeat_interval_s, consent_ref }
 *          401 + {directives:{terminate:true}} when revoked / bad key.
 *
 * NOTE (M2): NATS JWT/nkey minting is NOT here yet — heartbeat is HTTP-first.
 * When job delivery lands (M3) this response additionally carries the scoped
 * NATS user JWT + nkey seed (7-day TTL, re-minted on each authorize).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authNode, baseUrlFromRequest } from "@/lib/bas/agent-auth";
import { logEvent } from "@/lib/event-log";

const HEARTBEAT_INTERVAL_S = 5;

function safeArr(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const nodeId = String(body.node_id || "");
  const apiKey = String(body.api_key || "");
  if (!nodeId || !apiKey) return NextResponse.json({ error: "node_id + api_key required" }, { status: 400 });

  const node = await authNode(nodeId, apiKey);   // constant-time key check
  if (!node) return NextResponse.json({ error: "unauthorized", directives: { terminate: true } }, { status: 401 });
  if (node.status === "revoked") {
    return NextResponse.json({ error: "revoked", directives: { terminate: true } }, { status: 401 });
  }

  const fleet = await prisma.fleet.findUnique({ where: { id: node.fleetId } });

  // Authorize counts as a beacon — refresh lastSeen + version.
  await prisma.fleetNode.update({
    where: { id: nodeId },
    data: {
      lastSeen: new Date(),
      status: "online",
      agentVersion: body.agent_version ? String(body.agent_version).slice(0, 60) : node.agentVersion,
    },
  });

  void logEvent({
    category: "bas", action: "bas.node.authorize",
    actor: "agent", status: "ok",
    targetType: "FleetNode", targetId: nodeId,
    message: `re-authorized ${node.hostname || node.id}`,
  });

  const origin = baseUrlFromRequest(req);   // advisory; agent derives its own callback URL
  return NextResponse.json({
    ok: true,
    allowed_scope: safeArr(node.enrolledScope),
    heartbeat_url: `${origin}/api/v1/node-status`,
    heartbeat_interval_s: HEARTBEAT_INTERVAL_S,
    consent_ref: fleet?.consentId || null,
  });
}
