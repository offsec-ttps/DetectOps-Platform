/**
 * POST /api/mcp/servers/[id]/test — connect to the server, list its tools,
 * persist the result on the row (lastTestedAt/lastTestOk/lastTestLatency/
 * lastTestMessage/lastToolCount), and return it.
 *
 * Exercises the real Phase-3 MCP client wire-up (src/lib/llm/mcp/client.ts),
 * so a green result here is real proof the server is reachable and speaking
 * MCP correctly — not just that the URL/command is well-formed.
 *
 * Admin-only: for transport="stdio" this spawns the configured command; for
 * transport="http" it makes a server-side request to the configured address.
 * Both are meaningful RCE/SSRF surface if left open to unauthenticated callers.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";
import { listMcpServerTools, type McpServerConfig, type McpTransport } from "@/lib/llm/mcp/client";
import { logEvent } from "@/lib/event-log";
import { requireRole } from "@/lib/auth-guard";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await prisma.mcpClientServer.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  let token = "";
  try { token = decrypt(row.tokenEnc); } catch { /* treat as no token */ }
  const options: Record<string, string> = {};
  if (token) options.token = token;
  const config: McpServerConfig = { name: row.label, transport: row.transport as McpTransport, address: row.address, options };

  const started = Date.now();
  let ok = false;
  let message = "";
  let toolCount = 0;
  try {
    const tools = await listMcpServerTools(config, true);
    toolCount = tools.length;
    ok = true;
    message = `${toolCount} tool(s): ${tools.map((t) => t.name).join(", ") || "(none)"}`;
  } catch (err: any) {
    message = err?.message || String(err);
  }
  const latency = Date.now() - started;

  await prisma.mcpClientServer.update({
    where: { id },
    data: { lastTestedAt: new Date(), lastTestOk: ok, lastTestLatency: latency, lastTestMessage: message.slice(0, 500), lastToolCount: toolCount },
  });

  void logEvent({
    category: "system",
    action: "mcp-servers.test",
    actor: auth.user.email,
    status: ok ? "ok" : "error",
    targetType: "McpClientServer",
    targetId: id,
    durationMs: latency,
    message,
  });

  return NextResponse.json({ ok, latency, message, toolCount });
}
