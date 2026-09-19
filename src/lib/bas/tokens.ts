/**
 * Enrollment-token + per-node-API-key helpers for the native BAS fleet.
 *
 * Trust model (see plan §Risks):
 *   - Enrollment tokens are shown to the operator ONCE at creation; the DB
 *     stores only their SHA-256 hash. A leaked installer therefore can't mint
 *     unlimited nodes — the raw token is needed and it expires.
 *   - Per-node API keys (returned at enroll) are high-entropy random strings;
 *     the DB stores them AES-GCM-encrypted (reuse the credential vault), so a
 *     DB read alone can't impersonate a node.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/** Generate a fresh enrollment token (URL-safe, ~256 bits). Shown once. */
export function generateEnrollmentToken(): string {
  // base64url without padding; prefix tags it for log-grepping + accidental-paste detection.
  return "bas_" + randomBytes(32).toString("base64url");
}

/** Generate a per-node HTTP API key (~256 bits). */
export function generateNodeApiKey(): string {
  return "node_" + randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a token — what we persist for enrollment tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare of a presented token against a stored hash. */
export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash || "", "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
