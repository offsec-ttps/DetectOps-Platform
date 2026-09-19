/**
 * GET  /api/mcp/servers — list DB-managed outbound MCP servers (never returns plaintext tokens)
 * POST /api/mcp/servers — create a new server (token AES-GCM encrypted at rest)
 *
 * These are servers *this app queries* for enrichment data during detection-pack
 * generation (see src/lib/llm/mcp/enrich.ts) — distinct from /api/mcp/keys, which
 * issues API keys for external clients to query *this app's own* MCP server.
 *
 * Admin-only: `transport="stdio"` spawns an arbitrary local command, and the
 * `address` for `transport="http"` is fetched server-side (SSRF surface), so
 * every handler here is gated the same way as /api/mcp/keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, tailHint } from "@/lib/crypto/credential-vault";
import { invalidateMcpServerCache } from "@/lib/llm/mcp/client";
import { logEvent } from "@/lib/event-log";
import { requireRole } from "@/lib/auth-guard";

const TRANSPORTS = new Set(["stdio", "http"]);

export async function GET() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const rows = await prisma.mcpClientServer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    items: rows.map((r) => ({
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
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim();
  const transport = String(body.transport || "").trim();
  const address = String(body.address || "").trim();
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  if (!TRANSPORTS.has(transport)) {
    return NextResponse.json({ error: `transport must be one of ${[...TRANSPORTS].join("|")}` }, { status: 400 });
  }
  if (!address) return NextResponse.json({ error: "address is required" }, { status: 400 });

  let tokenEnc = "";
  if (typeof body.token === "string" && body.token.trim()) {
    try { tokenEnc = encrypt(body.token.trim()); }
    catch (err: any) {
      return NextResponse.json({ error: `token encryption failed: ${err?.message || err}` }, { status: 500 });
    }
  }

  const row = await prisma.mcpClientServer.create({
    data: {
      label: label.slice(0, 240),
      transport,
      address: address.slice(0, 1024),
      tokenEnc,
      enabled: body.enabled !== false,
    },
  });

  invalidateMcpServerCache();

  void logEvent({
    category: "system",
    action: "mcp-servers.create",
    actor: auth.user.email,
    status: "ok",
    targetType: "McpClientServer",
    targetId: row.id,
    message: `${label} · transport=${transport}`,
    details: { transport, label, hasToken: !!tokenEnc, address: row.address },
  });

  return NextResponse.json({
    id: row.id, label: row.label, transport: row.transport, enabled: row.enabled,
  });
}
