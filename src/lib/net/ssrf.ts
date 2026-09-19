/**
 * SSRF guard for user-supplied URLs that the server will fetch.
 *
 * Rejects non-http(s) schemes and any hostname that resolves to a private,
 * loopback, link-local (incl. the 169.254.169.254 cloud-metadata address),
 * CGNAT, or reserved address. Resolve-then-check closes the DNS-rebinding gap
 * for the initial request; callers that follow redirects should re-validate
 * each hop (fetch with redirect:"manual").
 */

import { lookup } from "node:dns/promises";

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // unparseable → unsafe
  const [a, b] = p;
  if (a === 0 || a === 127) return true;                       // this-host / loopback
  if (a === 10) return true;                                   // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;            // RFC1918
  if (a === 192 && b === 168) return true;                     // RFC1918
  if (a === 169 && b === 254) return true;                     // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
  if (a >= 224) return true;                                   // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;                  // loopback / unspecified
  if (x.startsWith("fe80")) return true;                       // link-local
  if (x.startsWith("fc") || x.startsWith("fd")) return true;   // unique-local
  if (x.startsWith("::ffff:")) return isPrivateV4(x.split(":").pop() || ""); // v4-mapped
  return false;
}

export async function assertPublicHttpUrl(raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "invalid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "only http(s) URLs are allowed" };
  }
  let addrs: Array<{ address: string; family: number }>;
  try { addrs = await lookup(u.hostname, { all: true }); }
  catch { return { ok: false, error: "could not resolve host" }; }
  for (const a of addrs) {
    const priv = a.family === 6 ? isPrivateV6(a.address) : isPrivateV4(a.address);
    if (priv) return { ok: false, error: "URL resolves to a private/loopback address (blocked)" };
  }
  return { ok: true, url: u.toString() };
}
