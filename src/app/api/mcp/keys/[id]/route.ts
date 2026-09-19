/**
 * DELETE /api/mcp/keys/[id] — revoke an MCP API key. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await prisma.mcpApiKey.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.mcpApiKey.update({ where: { id }, data: { enabled: false, revokedAt: new Date() } });
  void logEvent({ category: "mcp", action: "mcp.key.revoke", actor: auth.user.email, status: "ok", targetType: "McpApiKey", targetId: id, message: `revoked MCP key ${row.prefix}…` });
  return NextResponse.json({ ok: true });
}
