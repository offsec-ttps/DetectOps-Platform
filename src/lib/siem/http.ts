/** Shared helpers for /api/siem routes (kept out of route files per Next's
 * route-export constraint). */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import type { SiemConnection } from "@/generated/prisma/client";

/** Public shape — NEVER includes secretsEnc. */
export function serializeSiem(s: SiemConnection) {
  return {
    id: s.id, name: s.name, kind: s.kind, scope: s.scope, targetRef: s.targetRef, isDefault: s.isDefault,
    url: s.url, authMode: s.authMode, tenantId: s.tenantId, clientId: s.clientId, username: s.username,
    status: s.status, lastError: s.lastError, lastTested: s.lastTested,
    hasSecret: !!s.secretsEnc, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

export async function loadOwnedSiem(id: string): Promise<
  | { ok: true; server: SiemConnection; auth: { user: { id: string; email: string }; enforced: boolean } }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, response: auth.response };
  const row = await prisma.siemConnection.findUnique({ where: { id } });
  if (!row) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
  // Enforced mode: owner or admin only. Unowned (legacy) rows are admin-only —
  // they hold decrypted-on-use credentials, so "no owner" must not mean "anyone".
  const own = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.ownerId);
  if (!own.ok) return { ok: false, response: own.response };
  return { ok: true, server: row, auth: { user: auth.user, enforced: auth.enforced } };
}
