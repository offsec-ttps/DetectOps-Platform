/**
 * GET    /api/fleets/[id] — fleet detail + nodes (computed liveness) + active tokens
 * DELETE /api/fleets/[id] — delete a fleet (only when it has no nodes)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeNode, requireFleetAccess } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";

function safeArr(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const fleet = access.fleet;

  const [nodes, tokens, consent] = await Promise.all([
    prisma.fleetNode.findMany({ where: { fleetId: id }, orderBy: { createdAt: "desc" } }),
    prisma.enrollmentToken.findMany({ where: { fleetId: id }, orderBy: { createdAt: "desc" } }),
    fleet.consentId ? prisma.consent.findUnique({ where: { id: fleet.consentId } }) : Promise.resolve(null),
  ]);
  const now = Date.now();

  // Consent status banner: none | valid (until) | expired | not-yet-valid.
  let consentStatus: { state: string; validTo: Date | null; authorizedBy: string; scopes: string[] } | null = null;
  if (consent) {
    const vt = consent.validTo ? new Date(consent.validTo).getTime() : null;
    const vf = consent.validFrom ? new Date(consent.validFrom).getTime() : null;
    const state = vt != null && vt < now ? "expired" : vf != null && vf > now ? "pending" : "valid";
    let scopes: string[] = [];
    try { const o = JSON.parse(consent.scope); scopes = Array.isArray(o) ? o : (o.scopes || []); } catch {}
    consentStatus = { state, validTo: consent.validTo, authorizedBy: consent.authorizedBy, scopes };
  }

  return NextResponse.json({
    id: fleet.id,
    name: fleet.name,
    customerId: fleet.customerId,
    allowedScope: safeArr(fleet.allowedScope),
    consentId: fleet.consentId,
    consent: consentStatus,
    createdAt: fleet.createdAt,
    nodes: nodes.map((n) => serializeNode(n, now)),
    tokens: tokens.map((t) => ({
      id: t.id,
      label: t.label,
      allowedScope: safeArr(t.allowedScope),
      expiresAt: t.expiresAt,
      usedCount: t.usedCount,
      maxUses: t.maxUses,
      revoked: t.revoked,
      expired: t.expiresAt.getTime() < now,
      createdAt: t.createdAt,
    })),
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  // `?cascade=1` tears the whole fleet down: it removes every node row (which
  // stops each agent — its next heartbeat fails auth → 401 → the service exits),
  // plus tokens, campaigns, operations, and test-run history. Without it we keep
  // the conservative behavior of refusing while nodes are still enrolled.
  const cascade = req.nextUrl.searchParams.get("cascade") === "1";

  if (!cascade) {
    const nodeCount = await prisma.fleetNode.count({ where: { fleetId: id } });
    if (nodeCount > 0) {
      return NextResponse.json({ error: `cannot delete — ${nodeCount} node(s) enrolled. Revoke them first, or delete with cascade.` }, { status: 409 });
    }
  }

  try {
    const nodes = await prisma.fleetNode.findMany({ where: { fleetId: id }, select: { id: true } });
    const nodeIds = nodes.map((n) => n.id);
    const campaigns = await prisma.fleetCampaign.findMany({ where: { fleetId: id }, select: { id: true } });
    const campaignIds = campaigns.map((c) => c.id);

    // These models are linked by plain string ids (no DB-level cascade), so we
    // remove dependents explicitly, deepest-first, inside a transaction.
    await prisma.$transaction([
      ...(nodeIds.length ? [prisma.fleetTestRun.deleteMany({ where: { nodeId: { in: nodeIds } } })] : []),
      ...(nodeIds.length ? [prisma.fleetOperation.deleteMany({ where: { nodeId: { in: nodeIds } } })] : []),
      ...(campaignIds.length ? [prisma.fleetOperation.deleteMany({ where: { campaignId: { in: campaignIds } } })] : []),
      prisma.fleetCampaign.deleteMany({ where: { fleetId: id } }),
      prisma.enrollmentToken.deleteMany({ where: { fleetId: id } }),
      prisma.fleetNode.deleteMany({ where: { fleetId: id } }),
      prisma.fleet.delete({ where: { id } }),
    ]);

    void logEvent({
      category: "bas", action: "bas.fleet.delete",
      actor: auth.user.email, status: "ok",
      targetType: "Fleet", targetId: id,
      message: cascade ? `deleted (cascade: ${nodeIds.length} node(s))` : "deleted",
      details: { cascade, nodeCount: nodeIds.length, campaignCount: campaignIds.length },
    });
    return NextResponse.json({ ok: true, removedNodes: nodeIds.length });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
