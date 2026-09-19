/**
 * Shared helpers for the /api/c2 route handlers. Kept OUT of the route files
 * themselves because Next.js route modules may only export HTTP method handlers
 * (exporting anything else fails the generated route-type check).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import type { C2Server } from "@/generated/prisma/client";

export function serializeC2(s: C2Server) {
  return {
    id: s.id, name: s.name, provider: s.provider, mode: s.mode,
    url: s.url, group: s.group, advertiseHost: s.advertiseHost, agentPlatform: s.agentPlatform,
    status: s.status, lastError: s.lastError, lastSeen: s.lastSeen,
    deploymentId: s.deploymentId, environmentTargetId: s.environmentTargetId,
    hasApiKey: !!s.apiKeyEnc, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

/** Auth + load + ownership. Returns the server or a ready response. */
export async function loadOwnedC2(id: string): Promise<
  | { ok: true; server: C2Server; auth: { user: { id: string; email: string }; enforced: boolean } }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, response: auth.response };
  const server = await prisma.c2Server.findUnique({ where: { id } });
  if (!server) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (auth.enforced && server.ownerId && server.ownerId !== auth.user.id) {
    return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { ok: true, server, auth: { user: auth.user, enforced: auth.enforced } };
}
