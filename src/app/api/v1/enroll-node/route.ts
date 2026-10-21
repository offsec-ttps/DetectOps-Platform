/**
 * POST /api/v1/enroll-node   (AGENT-FACING — stable contract, the Rust agent hardcodes this path)
 *
 * One-time node registration. The installer runs `bas_agent enroll --token <T>`,
 * the agent POSTs here with the enrollment token + host facts, and receives a
 * per-node identity + API key for subsequent heartbeats.
 *
 * Body:
 *   {
 *     enrollment_token: string,
 *     host_facts: { hostname, os, os_version, arch, fqdn?, edr_vendor? },
 *     agent_version?: string,
 *     node_id?: string            // re-enroll: if present + matches, idempotent re-key
 *   }
 *
 * Returns:
 *   { node_id, api_key, allowed_scope, heartbeat_url, heartbeat_interval_s, consent_ref? }
 *
 * Auth: the enrollment token itself (validated against stored hash, TTL, uses,
 * revocation). No session — this is the agent bootstrap.
 *
 * NOTE (M1): NATS credentials are NOT minted here yet — heartbeat is HTTP-first.
 * /api/v1/authorize-node (M3) will return NATS JWT/nkey when job delivery lands.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, generateNodeApiKey } from "@/lib/bas/tokens";
import { baseUrlFromRequest } from "@/lib/bas/agent-auth";
import { signingPublicKeyB64 } from "@/lib/bas/signing";
import { encrypt } from "@/lib/crypto/credential-vault";
import { logEvent } from "@/lib/event-log";

const HEARTBEAT_INTERVAL_S = 5;

function safeArr(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.enrollment_token || "").trim();
  if (!token) return NextResponse.json({ error: "enrollment_token required" }, { status: 400 });

  const facts = (body.host_facts && typeof body.host_facts === "object") ? body.host_facts : {};
  const tokenRow = await prisma.enrollmentToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!tokenRow) return NextResponse.json({ error: "invalid enrollment token" }, { status: 401 });
  if (tokenRow.revoked) return NextResponse.json({ error: "enrollment token revoked" }, { status: 401 });
  if (tokenRow.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "enrollment token expired" }, { status: 401 });
  if (tokenRow.maxUses > 0 && tokenRow.usedCount >= tokenRow.maxUses) {
    return NextResponse.json({ error: "enrollment token exhausted" }, { status: 401 });
  }

  const fleet = await prisma.fleet.findUnique({ where: { id: tokenRow.fleetId } });
  if (!fleet) return NextResponse.json({ error: "fleet missing for token" }, { status: 409 });

  // Re-enroll must never resurrect a node an operator revoked (status
  // "revoked" → "offline" would silently undo the revocation), and only
  // addresses nodes inside the token's own fleet.
  const existing = body.node_id
    ? await prisma.fleetNode.findUnique({ where: { id: String(body.node_id) } })
    : null;
  if (existing && existing.fleetId === fleet.id && existing.status === "revoked") {
    return NextResponse.json({ error: "node is revoked — enroll as a new node" }, { status: 403 });
  }

  // Atomically CLAIM one use of the token before doing anything with it. The
  // previous read-check-then-increment let N concurrent requests all pass the
  // maxUses / revoked / expiry check and mint N nodes from a single-use token.
  const now = new Date();
  const claim = await prisma.enrollmentToken.updateMany({
    where: {
      id: tokenRow.id,
      revoked: false,
      expiresAt: { gt: now },
      ...(tokenRow.maxUses > 0 ? { usedCount: { lt: tokenRow.maxUses } } : {}),
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claim.count !== 1) return NextResponse.json({ error: "enrollment token exhausted, revoked or expired" }, { status: 401 });

  const apiKey = generateNodeApiKey();
  const apiKeyEnc = encrypt(apiKey);
  const enrolledScope = JSON.stringify(safeArr(tokenRow.allowedScope));

  // Idempotent re-enroll: when a known node_id is supplied, re-key it in place.
  let node;
  if (existing && existing.fleetId === fleet.id) {
    node = await prisma.fleetNode.update({
      where: { id: existing.id },
      data: {
        apiKeyEnc,
        status: "offline",
        hostname: String(facts.hostname || existing.hostname || "").slice(0, 240),
        os: String(facts.os || existing.os || "").slice(0, 40),
        osVersion: String(facts.os_version || existing.osVersion || "").slice(0, 120),
        arch: String(facts.arch || existing.arch || "").slice(0, 40),
        agentVersion: String(body.agent_version || existing.agentVersion || "").slice(0, 60),
        enrolledScope,
      },
    });
  }
  if (!node) {
    node = await prisma.fleetNode.create({
      data: {
        fleetId: fleet.id,
        name: String(facts.hostname || "").slice(0, 240),
        hostname: String(facts.hostname || "").slice(0, 240),
        os: String(facts.os || "").slice(0, 40),
        osVersion: String(facts.os_version || "").slice(0, 120),
        arch: String(facts.arch || "").slice(0, 40),
        agentVersion: String(body.agent_version || "").slice(0, 60),
        apiKeyEnc,
        status: "offline",
        enrolledScope,
      },
    });
  }

  // The token use was already claimed atomically above, for BOTH create and
  // re-key (re-keying overwrites a node's apiKey, so it is just as sensitive).

  void logEvent({
    category: "bas", action: "bas.node.enroll",
    actor: "agent", status: "ok",
    targetType: "FleetNode", targetId: node.id,
    message: `enrolled ${node.hostname || node.id} (${node.os}/${node.arch}) into ${fleet.name}`,
    details: { fleetId: fleet.id, os: node.os, arch: node.arch, agentVersion: node.agentVersion },
  });

  // Build the heartbeat URL from the Host header the agent actually used (the
  // dev server's nextUrl.origin can resolve to localhost even when reached over
  // the LAN). NOTE: the agent treats this as advisory and derives its own
  // callback URL from the address it enrolled with — this is just informational.
  const origin = baseUrlFromRequest(req);
  return NextResponse.json({
    node_id: node.id,
    api_key: apiKey,                          // shown once; agent stores in node.toml
    allowed_scope: safeArr(node.enrolledScope),
    heartbeat_url: `${origin}/api/v1/node-status`,
    heartbeat_interval_s: HEARTBEAT_INTERVAL_S,
    consent_ref: fleet.consentId || null,
    signing_pubkey: signingPublicKeyB64(),    // ed25519 pubkey; agent verifies signed jobs with it
  });
}
