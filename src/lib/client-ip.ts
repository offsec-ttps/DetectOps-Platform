import type { NextRequest } from "next/server";

/**
 * Best-effort client IP for rate-limiting / audit.
 *
 * X-Forwarded-For is a client-appendable list: the LEFT-most entry is whatever
 * the caller sent (spoofable), while each trusted proxy APPENDS the address it
 * saw on the RIGHT. So we count `TRUSTED_PROXY_HOPS` entries in from the right
 * (default 1 — a single reverse proxy in front of the app) and take that one;
 * anything the client prepended is ignored. With no XFF we fall back to
 * X-Real-IP, then "unknown". Never trust the left-most value for throttling.
 */
export function clientIp(req: NextRequest): string {
  const hops = Math.max(0, parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10) || 0);
  const xff = (req.headers.get("x-forwarded-for") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length) {
    // Take the entry `hops` positions from the right (clamped into range).
    const idx = Math.min(Math.max(xff.length - hops, 0), xff.length - 1);
    return xff[idx] || "unknown";
  }
  return (req.headers.get("x-real-ip") || "").trim() || "unknown";
}
