/**
 * Input guards for operator-supplied C2 / Caldera / lab-host values.
 *
 * DetectOps legitimately talks to LAN hosts (lab Caldera, SAR endpoints), so we
 * do NOT block private address space. What we do block:
 *   - non-http(s) schemes (file:, gopher:, data: … → SSRF / local file reads)
 *   - URLs carrying embedded credentials
 *   - cloud instance-metadata endpoints (the classic SSRF → credential theft hop)
 *   - host / user values that could be parsed as command-line options or break
 *     out of the URL / command string they are interpolated into.
 */

import { isIP } from "node:net";
import { syncUrlBlockReason, labOutboundPolicy } from "@/lib/net/ssrf";

const METADATA_HOSTS = new Set([
  "169.254.169.254",          // AWS / Azure / GCP / OpenStack IMDS
  "169.254.170.2",            // AWS ECS task metadata
  "fd00:ec2::254",            // AWS IMDS (IPv6)
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "100.100.100.200",          // Alibaba Cloud
]);

/** Hostname / IPv4 / bracket-less IPv6 literal; never starts with "-". */
const HOST_RE = /^(?!-)[A-Za-z0-9.\-:]{1,253}$/;

/** Unwrap an IPv4-mapped IPv6 literal (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) to its
 * embedded IPv4 so string checks can't be bypassed by the v6 form. */
function unwrapMappedV4(h: string): string {
  const m = h.toLowerCase().match(/^::ffff:(.+)$/);
  if (!m) return h;
  const tail = m[1];
  if (isIP(tail) === 4) return tail;                       // ::ffff:169.254.169.254
  const hx = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // ::ffff:a9fe:a9fe
  if (hx) {
    const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return h;
}

export function isSafeHost(host: string): boolean {
  // Normalise: strip brackets, lowercase, drop a trailing dot (FQDN root) — all
  // forms the blocklist must not be bypassed by.
  const h0 = String(host || "").trim().replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!h0 || !HOST_RE.test(h0)) return false;
  if (METADATA_HOSTS.has(h0)) return false;
  const h = unwrapMappedV4(h0);
  if (METADATA_HOSTS.has(h)) return false;
  const fam = isIP(h);
  if (fam) {
    // Delegate IP-literal classification to the shared SSRF guard (link-local
    // 169.254/16, cloud-metadata ranges, reserved/multicast, etc.). LAN/private
    // ranges stay allowed — DetectOps legitimately talks to lab hosts.
    if (syncUrlBlockReason(`http://${fam === 6 ? `[${h}]` : h}`, labOutboundPolicy())) return false;
    if (h.startsWith("169.254.")) return false;   // belt-and-braces link-local
  } else if (h.startsWith("169.254.")) {
    return false;
  }
  return true;
}

/** SSH login name: POSIX-ish username, never an option. */
export function isSafeSshUser(user: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._@-]{0,127}$/.test(String(user || ""));
}

/** Caldera group / bucket names are embedded in beacon one-liners. */
export function isSafeGroup(group: string): boolean {
  return /^[A-Za-z0-9_.-]{1,120}$/.test(String(group || ""));
}

/**
 * Validate a C2 / Caldera base URL. Returns the normalised URL (no trailing
 * slash) or an error string.
 */
export function checkC2Url(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, error: "url must be an absolute http(s) URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "url must use http or https" };
  if (u.username || u.password) return { ok: false, error: "url must not embed credentials" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!isSafeHost(host)) return { ok: false, error: "url host is not allowed" };
  return { ok: true, url: s };
}
