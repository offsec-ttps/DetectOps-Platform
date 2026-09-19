/**
 * GET    /api/mcp/servers/[id] — detail (never returns plaintext token)
 * PATCH  /api/mcp/servers/[id] — partial update; re-encrypts token if supplied
 * DELETE /api/mcp/servers/[id] — remove
 *
 * Admin-only — see route.ts for why (stdio spawn / SSRF surface).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, tailHint } from "@/lib/crypto/credential-vault";
import { invalidateMcpServerCache } from "@/lib/llm/mcp/client";
import { logEvent } from "@/lib/event-log";
import { requireRole } from "@/lib/auth-guard";

const TRANSPORTS = new Set(["stdio", "http"]);
const PATCHABLE = new Set(["label", "transport", "address", "token", "enabled"]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const r = await prisma.mcpClientServer.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    id: r.id,
    label: r.label,
    transport: r.transport,
    address: r.address,
    hasToken: r.tokenEnc.length > 0,
    tokenMasked: tailHint(r.tokenEnc),
    enabled: r.enabled,
    lastTestedAt: r.lastTestedAt,
    lastTestOk: r.lastTestOk,
    lastTestLatency: r.lastTestLatency,
    lastTestMessage: r.lastTestMessage,
    lastToolCount: r.lastToolCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.mcpClientServer.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "transport") {
      if (!TRANSPORTS.has(String(v))) {
        return NextResponse.json({ error: `transport must be one of ${[...TRANSPORTS].join("|")}` }, { status: 400 });
      }
      data.transport = v;
      continue;
    }
    if (k === "token" && typeof v === "string") {
      if (v.length === 0) { data.tokenEnc = ""; continue; } // explicit clear
      try { data.tokenEnc = encrypt(v); } catch (err: any) {
        return NextResponse.json({ error: `token encryption failed: ${err?.message || err}` }, { status: 500 });
      }
      continue;
    }
    if (k === "enabled") { data.enabled = v === true; continue; }
    data[k] = v;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 });
  }

  const updated = await prisma.mcpClientServer.update({ where: { id }, data: data as any });
  invalidateMcpServerCache();

  void logEvent({
    category: "system",
    action: "mcp-servers.update",
    actor: auth.user.email,
    status: "ok",
    targetType: "McpClientServer",
    targetId: id,
    message: `Updated ${Object.keys(data).filter((k) => k !== "tokenEnc").join(", ") || "encrypted fields"}`,
    details: { fields: Object.keys(data) },
  });

  return NextResponse.json({ id: updated.id, updated: Object.keys(data) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    await prisma.mcpClientServer.delete({ where: { id } });
    invalidateMcpServerCache();
    void logEvent({
      category: "system",
      action: "mcp-servers.delete",
      actor: auth.user.email,
      status: "ok",
      targetType: "McpClientServer",
      targetId: id,
      message: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
