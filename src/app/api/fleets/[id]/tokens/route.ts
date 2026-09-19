/**
 * POST /api/fleets/[id]/tokens — mint an enrollment token (plaintext shown ONCE)
 * GET  /api/fleets/[id]/tokens — list tokens (never returns plaintext)
 *
 * Body for POST:
 *   { label?, ttlHours? (default 24), allowedScope? (defaults to fleet scope), maxUses? (0=unlimited) }
 *
 * The DB stores only the SHA-256 hash. The plaintext token is returned exactly
 * once in this response and never recoverable afterward.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateEnrollmentToken, hashToken } from "@/lib/bas/tokens";
import { logEvent } from "@/lib/event-log";
import { requireFleetAccess } from "@/lib/bas/fleet";

function safeArr(s: string): string[] {
  try { return JSON.parse(s) || []; } catch { return []; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  const rows = await prisma.enrollmentToken.findMany({ where: { fleetId: id }, orderBy: { createdAt: "desc" } });
  const now = Date.now();
  return NextResponse.json({
    items: rows.map((t) => ({
      id: t.id, label: t.label,
      allowedScope: safeArr(t.allowedScope),
      expiresAt: t.expiresAt, usedCount: t.usedCount, maxUses: t.maxUses,
      revoked: t.revoked, expired: t.expiresAt.getTime() < now,
      createdAt: t.createdAt,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const { auth, fleet } = access;

  const body = await req.json().catch(() => ({}));

  const ttlHours = Math.min(8760, Math.max(1, Number(body.ttlHours) || 24));
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  const allowedScope = Array.isArray(body.allowedScope)
    ? body.allowedScope.map(String).slice(0, 64)
    : safeArr(fleet.allowedScope);
  const maxUses = Math.max(0, Math.min(100_000, Number(body.maxUses) || 0));

  const plaintext = generateEnrollmentToken();
  const row = await prisma.enrollmentToken.create({
    data: {
      fleetId: id,
      tokenHash: hashToken(plaintext),
      label: String(body.label || "").slice(0, 240),
      allowedScope: JSON.stringify(allowedScope),
      expiresAt,
      maxUses,
    },
  });

  void logEvent({
    category: "bas", action: "bas.token.create",
    actor: auth.user.email, status: "ok",
    targetType: "EnrollmentToken", targetId: row.id,
    message: `fleet=${fleet.name} · ttl=${ttlHours}h · scope=[${allowedScope.join(",")}]`,
    details: { fleetId: id, ttlHours, allowedScope, maxUses }, // NEVER log the plaintext
  });

  return NextResponse.json({
    id: row.id,
    token: plaintext,                 // shown ONCE
    expiresAt: row.expiresAt,
    allowedScope,
    maxUses,
  });
}
