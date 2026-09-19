/**
 * Issued API keys for the public ransomware-intel API.
 *
 *   - mintKey() returns the plaintext key ONCE (rgi_<prefix>_<secret>); we store
 *     only sha256(key) + a short prefix to identify it in the UI.
 *   - requireIntelApiKey() authenticates a request (Authorization: Bearer / X-API-Key),
 *     enforces a per-key rate limit (reusing src/lib/rate-limit.ts), bumps usage.
 */

import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }

export async function mintKey(opts: { label: string; scopes?: string[]; rateLimitPerMin?: number; ownerId: string }): Promise<{ id: string; key: string; prefix: string }> {
  const secret = randomBytes(24).toString("base64url");
  const prefix = randomBytes(4).toString("hex");
  const key = `rgi_${prefix}_${secret}`;
  const row = await prisma.intelApiKey.create({
    data: { label: opts.label || "", keyHash: sha256(key), prefix, scopes: JSON.stringify(opts.scopes || ["read"]), rateLimitPerMin: opts.rateLimitPerMin || 120, ownerId: opts.ownerId },
  });
  return { id: row.id, key, prefix };   // key shown once, never stored/returned again
}

export type IntelKeyAuth = { ok: true; keyId: string } | { ok: false; response: NextResponse };

export async function requireIntelApiKey(req: NextRequest): Promise<IntelKeyAuth> {
  const hdr = req.headers.get("authorization") || "";
  const bearer = hdr.toLowerCase().startsWith("bearer ") ? hdr.slice(7).trim() : "";
  const raw = bearer || req.headers.get("x-api-key") || "";
  if (!raw) return { ok: false, response: NextResponse.json({ error: "missing API key (Authorization: Bearer <key> or X-API-Key)" }, { status: 401 }) };

  const row = await prisma.intelApiKey.findUnique({ where: { keyHash: sha256(raw) } });
  if (!row || !row.enabled || row.revokedAt) return { ok: false, response: NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 }) };

  const rl = rateLimit(`intel-api:${row.id}`, row.rateLimitPerMin, 60_000);
  if (!rl.ok) return { ok: false, response: NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }) };

  // best-effort usage bump (don't block the request on it)
  void prisma.intelApiKey.update({ where: { id: row.id }, data: { requestCount: { increment: 1 }, lastUsedAt: new Date() } }).catch(() => {});
  return { ok: true, keyId: row.id };
}
