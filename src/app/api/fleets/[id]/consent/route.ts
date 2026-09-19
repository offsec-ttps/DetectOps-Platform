/**
 * POST   /api/fleets/[id]/consent — grant/refresh signed authorization for a fleet
 * DELETE /api/fleets/[id]/consent — revoke (detach) consent
 *
 * Consent is the legal/authorization trail for running adversary techniques on
 * a customer's endpoints. While attached, its validity window is enforced at
 * dispatch (and surfaced to the agent in the signed job). Under AUTH_ENFORCE,
 * a valid consent is REQUIRED to run anything.
 *
 * Body: { ttlDays?=30, authorizedBy?, scopes?: string[], signedDocRef? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFleetAccess } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const { auth, fleet } = access;

  const body = await req.json().catch(() => ({}));
  const ttlDays = Math.min(3650, Math.max(1, Number(body.ttlDays) || 30));
  const scopes = Array.isArray(body.scopes) ? body.scopes.map(String).slice(0, 64) : [];
  const now = new Date();
  const validTo = new Date(now.getTime() + ttlDays * 86400_000);

  const consent = await prisma.consent.create({
    data: {
      customerId: fleet.customerId,
      scope: JSON.stringify({ scopes }),
      authorizedBy: String(body.authorizedBy || auth.user.email).slice(0, 240),
      signedDocRef: String(body.signedDocRef || "").slice(0, 1024),
      validFrom: now,
      validTo,
    },
  });
  await prisma.fleet.update({ where: { id }, data: { consentId: consent.id } });

  void logEvent({
    category: "bas", action: "bas.consent.grant",
    actor: auth.user.email, status: "ok",
    targetType: "Consent", targetId: consent.id,
    message: `${fleet.name} authorized until ${validTo.toISOString().slice(0, 10)}${scopes.length ? ` · scopes=[${scopes.join(",")}]` : " · all scopes"}`,
    details: { fleetId: id, ttlDays, scopes },
  });

  return NextResponse.json({ consentId: consent.id, validTo, scopes });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  await prisma.fleet.update({ where: { id }, data: { consentId: null } });
  void logEvent({
    category: "bas", action: "bas.consent.revoke",
    actor: access.auth.user.email, status: "ok",
    targetType: "Fleet", targetId: id, message: "consent detached",
  });
  return NextResponse.json({ ok: true });
}
