/**
 * Central authorization guard for API routes.
 *
 * The platform historically used *advisory* sessions (`getSessionUser().catch(
 * () => null)`) on mutating routes, so a no-auth dev deployment stays usable.
 * This guard makes that posture explicit and safe for production:
 *
 *   - DEV (default): requests pass through. A real session is used when present;
 *     otherwise a synthetic local user is returned so ownership checks resolve.
 *     Ownership filters are NOT applied (so existing dev data stays visible).
 *   - ENFORCED (production, or AUTH_ENFORCE=1): a valid session is REQUIRED —
 *     unauthenticated requests get 401 — and ownership filters apply.
 *
 * Routes call `requireUser()` and branch on the result. Reads that should be
 * tenant-scoped use `auth.enforced` to decide whether to filter by owner, so
 * the dev experience is unchanged while production is locked down.
 *
 * Flip enforcement on for any networked deployment:  AUTH_ENFORCE=1
 */

import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth";

/** True when sessions are mandatory (prod, or explicit opt-in). */
export function authEnforced(): boolean {
  if (process.env.AUTH_ENFORCE === "1") return true;
  if (process.env.AUTH_ENFORCE === "0") return false;
  return process.env.NODE_ENV === "production";
}

/** Whether dev-only escape hatches (e.g. returning a verification code) are allowed. */
export function devEscapeHatchAllowed(): boolean {
  return !authEnforced();
}

const DEV_USER: SessionUser = {
  id: "dev-local", email: "dev@local", name: "Dev (no auth)", emailVerified: true, role: "admin",
};

export type AuthResult =
  | { ok: true; user: SessionUser; enforced: boolean }
  | { ok: false; response: NextResponse };

/**
 * Resolve the caller. In enforced mode an absent/invalid session yields a 401
 * result the route should return directly. In dev mode it always resolves
 * (real session if present, else a synthetic local user).
 */
export async function requireUser(): Promise<AuthResult> {
  const user = await getSessionUser().catch(() => null);
  const enforced = authEnforced();
  if (user) return { ok: true, user, enforced };
  if (enforced) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true, user: DEV_USER, enforced: false };
}

/**
 * Like requireUser but additionally requires a role (e.g. "admin") when
 * enforcing. In dev mode the synthetic user is already "admin".
 */
export async function requireRole(role: string): Promise<AuthResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.enforced && auth.user.role !== role && auth.user.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return auth;
}

/**
 * Ownership gate for a resource that carries an `ownerId`. Enforced mode: the
 * caller must own it (admins bypass) — otherwise 404 (don't leak existence).
 * Dev mode: always allowed. Pass the row's ownerId (empty = unowned/legacy).
 */
export function ownsOr404(auth: { user: SessionUser; enforced: boolean }, ownerId: string): { ok: true } | { ok: false; response: NextResponse } {
  if (!auth.enforced) return { ok: true };
  if (auth.user.role === "admin") return { ok: true };
  if (ownerId && ownerId === auth.user.id) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
}
