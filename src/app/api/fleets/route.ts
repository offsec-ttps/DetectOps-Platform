/**
 * GET  /api/fleets — list fleets with node counts + live-node counts
 * POST /api/fleets — create a fleet (name + allowed-scope + optional consent)
 *
 * Dashboard-facing (session-gated). The agent-facing enroll/heartbeat lives
 * under /api/v1/* with its own per-node auth.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nodeLiveness } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";
import { vaultSource } from "@/lib/crypto/credential-vault";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Tenant-scope the list when enforcing; dev shows all.
  const where = auth.enforced ? { ownerId: auth.user.id } : {};
  const fleets = await prisma.fleet.findMany({ where, orderBy: { createdAt: "desc" } });
  const ids = fleets.map((f) => f.id);
  const nodes = ids.length
    ? await prisma.fleetNode.findMany({ where: { fleetId: { in: ids } }, select: { fleetId: true, status: true, lastSeen: true } })
    : [];
  const now = Date.now();
  const byFleet = new Map<string, { total: number; online: number }>();
  for (const n of nodes) {
    const agg = byFleet.get(n.fleetId) || { total: 0, online: 0 };
    agg.total += 1;
    if (nodeLiveness(n, now) === "online") agg.online += 1;
    byFleet.set(n.fleetId, agg);
  }
  return NextResponse.json({
    // Warn the UI when node keys are encrypted with an ephemeral vault key:
    // enrolled agents authenticate fine until the server restarts, then every
    // poll 401s and nodes go permanently offline. Fix = set CREDENTIAL_VAULT_KEY.
    vaultEphemeral: vaultSource() === "dev-ephemeral",
    items: fleets.map((f) => ({
      id: f.id,
      name: f.name,
      customerId: f.customerId,
      allowedScope: safeArr(f.allowedScope),
      consentId: f.consentId,
      nodeCount: byFleet.get(f.id)?.total ?? 0,
      onlineCount: byFleet.get(f.id)?.online ?? 0,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const allowedScope = Array.isArray(body.allowedScope) ? body.allowedScope.map(String).slice(0, 64) : [];

  const dupe = await prisma.fleet.findFirst({ where: { name } });
  if (dupe) return NextResponse.json({ error: `fleet named "${name}" already exists` }, { status: 409 });

  const fleet = await prisma.fleet.create({
    data: {
      name: name.slice(0, 240),
      ownerId: auth.user.id,
      customerId: String(body.customerId || "").slice(0, 240),
      allowedScope: JSON.stringify(allowedScope),
      consentId: body.consentId ? String(body.consentId) : null,
    },
  });

  void logEvent({
    category: "bas", action: "bas.fleet.create",
    actor: auth.user.email, status: "ok",
    targetType: "Fleet", targetId: fleet.id,
    message: `${name} · scope=[${allowedScope.join(",")}]`,
    details: { name, allowedScope, consentId: fleet.consentId },
  });

  return NextResponse.json({ id: fleet.id, name: fleet.name });
}

function safeArr(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}
