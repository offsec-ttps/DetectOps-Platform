/**
 * GET  /api/mcp/keys — list issued MCP API keys (metadata only). Admin.
 * POST /api/mcp/keys — mint a key (returns plaintext ONCE). Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { mintKey, MCP_SCOPES } from "@/lib/mcp/auth";

export async function GET() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const rows = await prisma.mcpApiKey.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      label: r.label,
      prefix: r.prefix,
      scopes: JSON.parse(r.scopes || "[]"),
      tier: r.tier,
      rateLimitPerMin: r.rateLimitPerMin,
      dailyQuota: r.dailyQuota,
      requestCount: r.requestCount,
      dailyCount: r.dailyCount,
      enabled: r.enabled && !r.revokedAt,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
    })),
    availableScopes: MCP_SCOPES,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const minted = await mintKey({
    label: String(body.label || "MCP key"),
    // Only known scopes — unknown strings would silently grant nothing today but
    // could alias a future privileged scope.
    scopes: Array.isArray(body.scopes)
      ? body.scopes.map(String).filter((s: string) => (MCP_SCOPES as readonly string[]).includes(s))
      : undefined,
    tier: typeof body.tier === "string" ? body.tier : undefined,
    rateLimitPerMin: Number(body.rateLimitPerMin) || undefined,
    dailyQuota: Number(body.dailyQuota) || undefined,
    ownerId: auth.user.id,
  });
  void logEvent({
    category: "mcp",
    action: "mcp.key.mint",
    actor: auth.user.email,
    status: "ok",
    targetType: "McpApiKey",
    targetId: minted.id,
    message: `minted MCP key ${minted.prefix}…`,
  });
  return NextResponse.json({
    ok: true,
    id: minted.id,
    key: minted.key,
    prefix: minted.prefix,
    note: "Store this key now — it will not be shown again.",
  });
}
