/**
 * Tiny in-process fixed-window rate limiter.
 *
 * Keyed by an arbitrary string (e.g. `${route}:${userId}` or an IP). Intended
 * for abuse-resistance on sensitive endpoints (verification-code entry, login)
 * where even a generous per-window cap makes brute force infeasible.
 *
 * NOTE: state is per-process. For a multi-instance deployment behind a load
 * balancer, back this with a shared store (Redis) — but a single window per
 * instance still bounds an attacker's rate by (instances × max), which is far
 * below what a 6-digit-code brute force needs.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Record one hit against `key`. Returns ok=false once `max` hits occur within
 * `windowMs`. The window is fixed (resets `windowMs` after the first hit).
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterMs: 0 };
  }
  if (b.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, remaining: max - b.count, retryAfterMs: 0 };
}

/** Drop a key's window (e.g. after a successful, legitimate action). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
