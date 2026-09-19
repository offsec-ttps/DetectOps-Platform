/**
 * GET /api/mcp/stats — server status for the MCP registry console.
 * Returns server info, tool catalog, content stats, and 24h call count.
 * Session-auth (admin) — powers the internal dashboard, not the public MCP endpoint.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { MCP_SERVER_INFO, mcpFlags, mcpPublicBaseUrl } from "@/lib/mcp/flags";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { getStats } from "@/lib/mcp/query";

export async function GET() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - 24 * 3600_000);
  const [calls24h, activeKeys, stats] = await Promise.all([
    prisma.eventLog.count({ where: { category: "mcp", action: "mcp.tools.call", ts: { gte: since } } }),
    prisma.mcpApiKey.count({ where: { enabled: true, revokedAt: null } }),
    getStats(),
  ]);

  return NextResponse.json({
    enabled: mcpFlags.enabled,
    server: MCP_SERVER_INFO,
    endpoint: `${mcpPublicBaseUrl()}/api/mcp`,
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, scope: t.scope })),
    toolCount: MCP_TOOLS.length,
    activeKeys,
    calls24h,
    content: stats,
  });
}
