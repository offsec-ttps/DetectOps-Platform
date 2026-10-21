/**
 * Only allow same-origin, path-relative redirect targets. Rejects absolute URLs,
 * protocol-relative "//host", backslash tricks ("/\\host"), and anything with a
 * scheme — the classic open-redirect vectors for ?next= style parameters.
 */
export function safeRedirectPath(target: unknown, fallback = "/overview"): string {
  if (typeof target !== "string") return fallback;
  const t = target.trim();
  if (!t.startsWith("/") || t.startsWith("//") || t.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(t)) return fallback;
  if (/^\/[^/?#]*:/.test(t)) return fallback;
  return t;
}
