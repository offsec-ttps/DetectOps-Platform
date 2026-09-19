/**
 * Issued API keys for the public detection-content MCP server.
 *
 *   - mintKey() returns the plaintext key ONCE (dmcp_<prefix>_<secret>); we store
 *     only sha256(key) + a short prefix to identify it in the UI.
 *   - requireMcpApiKey() authenticates a request (Authorization: Bearer / X-API-Key),
 *     enforces a per-key per-minute rate limit (reusing src/lib/rate-limit.ts) AND a
 *     durable per-key daily quota (DB counter), optionally checks a scope, bumps usage.
 *
 * Modeled on src/lib/ransomware-intel/api-keys.ts, extended with tier/scope/quota.
 */

import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

/** Known scopes. Detection tools require "detections:read"; intel tools "intel:read". */
export const MCP_SCOPES = ["detections:read", "intel:read"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const DAILY_WINDOW_MS = 86_400_000;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function mintKey(opts: {
  label: string;
  scopes?: string[];
  tier?: string;
  rateLimitPerMin?: number;
  dailyQuota?: number;
  ownerId: string;
}): Promise<{ id: string; key: string; prefix: string }> {
  const secret = randomBytes(24).toString("base64url");
  const prefix = randomBytes(4).toString("hex");
  const key = `dmcp_${prefix}_${secret}`;
  const tier = ["free", "pro", "admin"].includes(String(opts.tier)) ? String(opts.tier) : "free";
  // Sensible tier defaults if caller didn't override.
  const tierDefaults: Record<string, { rpm: number; daily: number }> = {
    free: { rpm: 60, daily: 200 },
    pro: { rpm: 240, daily: 10_000 },
    admin: { rpm: 600, daily: 1_000_000 },
  };
  const d = tierDefaults[tier];
  const row = await prisma.mcpApiKey.create({
    data: {
      label: opts.label || "",
      keyHash: sha256(key),
      prefix,
      ownerId: opts.ownerId,
      scopes: JSON.stringify(opts.scopes && opts.scopes.length ? opts.scopes : [...MCP_SCOPES]),
      tier,
      rateLimitPerMin: opts.rateLimitPerMin || d.rpm,
      dailyQuota: opts.dailyQuota || d.daily,
    },
  });
  return { id: row.id, key, prefix }; // key shown once, never stored/returned again
}

export type McpKeyAuth =
  | { ok: true; keyId: string; scopes: string[]; tier: string }
  | { ok: false; response: NextResponse };

function json(status: number, body: unknown, headers?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { status, headers: { "Access-Control-Allow-Origin": "*", ...(headers || {}) } });
}

/**
 * Authenticate + rate-limit + quota-gate an MCP request.
 * @param requiredScope if given, the key must carry this scope (or tier "admin").
 */
export async function requireMcpApiKey(req: NextRequest | Request, requiredScope?: McpScope): Promise<McpKeyAuth> {
  const hdr = req.headers.get("authorization") || "";
  const bearer = hdr.toLowerCase().startsWith("bearer ") ? hdr.slice(7).trim() : "";
  const raw = bearer || req.headers.get("x-api-key") || "";
  if (!raw) {
    return { ok: false, response: json(401, { error: "missing API key (Authorization: Bearer <key> or X-API-Key)" }) };
  }

  const row = await prisma.mcpApiKey.findUnique({ where: { keyHash: sha256(raw) } });
  if (!row || !row.enabled || row.revokedAt) {
    return { ok: false, response: json(401, { error: "invalid or revoked API key" }) };
  }

  const scopes: string[] = safeScopes(row.scopes);
  if (requiredScope && row.tier !== "admin" && !scopes.includes(requiredScope)) {
    return { ok: false, response: json(403, { error: `key missing required scope: ${requiredScope}` }) };
  }

  // Per-minute burst limit (in-process; see rate-limit.ts).
  const rl = rateLimit(`mcp:min:${row.id}`, row.rateLimitPerMin, 60_000);
  if (!rl.ok) {
    return { ok: false, response: json(429, { error: "rate limit exceeded (per-minute)" }, { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) }) };
  }

  // Durable daily quota (DB counter). Reset the window if it has elapsed.
  const now = new Date();
  let dailyCount = row.dailyCount;
  let resetAt = row.dailyResetAt;
  if (!resetAt || now.getTime() - resetAt.getTime() >= DAILY_WINDOW_MS) {
    dailyCount = 0;
    resetAt = now;
  }
  if (dailyCount >= row.dailyQuota) {
    const retry = Math.ceil((resetAt.getTime() + DAILY_WINDOW_MS - now.getTime()) / 1000);
    return { ok: false, response: json(429, { error: "daily quota exceeded" }, { "Retry-After": String(Math.max(1, retry)) }) };
  }

  // Persist usage. Awaited so the daily gate is durable (quota must actually count).
  await prisma.mcpApiKey
    .update({ where: { id: row.id }, data: { requestCount: { increment: 1 }, dailyCount: dailyCount + 1, dailyResetAt: resetAt, lastUsedAt: now } })
    .catch(() => {});

  return { ok: true, keyId: row.id, scopes, tier: row.tier };
}

export function safeScopes(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** True if the resolved scope set (or admin tier) grants a scope. */
export function hasScope(ctx: { scopes: string[]; tier: string }, scope: McpScope): boolean {
  return ctx.tier === "admin" || ctx.scopes.includes(scope);
}
