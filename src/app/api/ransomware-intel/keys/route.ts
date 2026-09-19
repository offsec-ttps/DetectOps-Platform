/**
 * GET  /api/ransomware-intel/keys — list issued API keys (metadata only).
 * POST /api/ransomware-intel/keys — mint a key (returns plaintext ONCE). Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { mintKey } from "@/lib/ransomware-intel/api-keys";

export async function GET() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const rows = await prisma.intelApiKey.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    items: rows.map((r) => ({ id: r.id, label: r.label, prefix: r.prefix, scopes: JSON.parse(r.scopes || "[]"), rateLimitPerMin: r.rateLimitPerMin, enabled: r.enabled && !r.revokedAt, requestCount: r.requestCount, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt, revokedAt: r.revokedAt })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const minted = await mintKey({ label: String(body.label || "API key"), scopes: Array.isArray(body.scopes) ? body.scopes : ["read"], rateLimitPerMin: Number(body.rateLimitPerMin) || 120, ownerId: auth.user.id });
  void logEvent({ category: "ransomware-intel" as any, action: "intel.key.mint", actor: auth.user.email, status: "ok", targetType: "IntelApiKey", targetId: minted.id, message: `minted key ${minted.prefix}…` });
  return NextResponse.json({ ok: true, id: minted.id, key: minted.key, prefix: minted.prefix, note: "Store this key now — it will not be shown again." });
}
