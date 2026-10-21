/**
 * SSRF guard for user-supplied URLs that the server will fetch.
 *
 * Two policies:
 *   - assertPublicHttpUrl(raw)  — strict: public internet only (web ingest,
 *     threat-intel feeds, screenshots). Blocks private, loopback, link-local
 *     (incl. 169.254.169.254 cloud metadata), CGNAT and reserved ranges.
 *   - assertSafeOutboundUrl(raw, { allowPrivate, allowLoopback }) — for
 *     endpoints that legitimately target lab infrastructure (Splunk on 10.x,
 *     a self-hosted Ollama / MCP server). Private ranges can be allowed, but
 *     cloud-metadata / link-local / unspecified / multicast are ALWAYS blocked,
 *     and loopback is blocked unless explicitly allowed (it exposes this app's
 *     own internal admin APIs and co-located services).
 *
 * Resolve-then-check closes the simple DNS-rebinding gap for the initial
 * request. `safeFetch` additionally never lets fetch follow redirects on its
 * own: every hop is re-validated, and credentials (Authorization / x-api-key /
 * custom auth headers) are dropped when a redirect changes origin, so a
 * stored secret is never forwarded to a host other than the configured one.
 */

import { lookup } from "node:dns/promises";
import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { isIP } from "node:net";

export interface OutboundPolicy {
  /** Allow RFC1918 / ULA / CGNAT targets (lab SIEMs, self-hosted LLMs). */
  allowPrivate?: boolean;
  /** Allow 127.0.0.0/8 and ::1 (local Ollama, local MCP server). */
  allowLoopback?: boolean;
}

type Verdict = "ok" | "private" | "loopback" | "blocked";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
]);

function classifyV4(ip: string): Verdict {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return "blocked";
  const [a, b] = p;
  if (a === 0) return "blocked";                                // this-host / unspecified
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "blocked";                 // link-local + cloud metadata
  if (a >= 224) return "blocked";                               // multicast / reserved / broadcast
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";       // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return "private";    // benchmarking
  return "ok";
}

function classifyV6(ip: string): Verdict {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (x === "::") return "blocked";
  if (x === "::1") return "loopback";
  if (x === "fd00:ec2::254") return "blocked";                  // AWS IMDS over IPv6
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyV4(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(x)) {
    // hex-form v4-mapped (::ffff:a9fe:a9fe) → decode
    const [, hi, lo] = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)!;
    const h = parseInt(hi, 16), l = parseInt(lo, 16);
    return classifyV4(`${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`);
  }
  if (/^fe[89ab]/.test(x)) return "blocked";                    // link-local fe80::/10
  if (x.startsWith("ff")) return "blocked";                     // multicast
  if (x.startsWith("fc") || x.startsWith("fd")) return "private"; // unique-local
  if (x.startsWith("64:ff9b:")) return "blocked";               // NAT64 (can reach v4 metadata)
  return "ok";
}

function classify(address: string, family: number): Verdict {
  return family === 6 ? classifyV6(address) : classifyV4(address);
}

function verdictAllowed(v: Verdict, policy: OutboundPolicy): boolean {
  if (v === "ok") return true;
  if (v === "private") return !!policy.allowPrivate;
  if (v === "loopback") return !!policy.allowLoopback;
  return false;
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

export async function assertSafeOutboundUrl(raw: string, policy: OutboundPolicy = {}): Promise<UrlCheck> {
  let u: URL;
  try { u = new URL(String(raw ?? "").trim()); } catch { return { ok: false, error: "invalid URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "only http(s) URLs are allowed" };
  }
  if (u.username || u.password) {
    return { ok: false, error: "credentials in URL are not allowed" };
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, error: "invalid URL host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: "cloud metadata host is blocked" };

  let addrs: Array<{ address: string; family: number }>;
  const literal = isIP(host);
  if (literal) {
    addrs = [{ address: host, family: literal }];
  } else {
    try { addrs = await lookup(host, { all: true, verbatim: true }); }
    catch { return { ok: false, error: "could not resolve host" }; }
    if (addrs.length === 0) return { ok: false, error: "could not resolve host" };
  }
  for (const a of addrs) {
    const v = classify(a.address, a.family);
    if (!verdictAllowed(v, policy)) {
      const why = v === "loopback" ? "loopback" : v === "private" ? "private-network" : "link-local/metadata/reserved";
      return { ok: false, error: `URL resolves to a ${why} address (blocked)` };
    }
  }
  return { ok: true, url: u.toString() };
}

/** Strict public-internet-only check (kept for existing callers). */
export async function assertPublicHttpUrl(raw: string): Promise<UrlCheck> {
  return assertSafeOutboundUrl(raw, { allowPrivate: false, allowLoopback: false });
}

export class SsrfBlockedError extends Error {
  readonly code = "ssrf_blocked";
  constructor(msg: string) { super(msg); this.name = "SsrfBlockedError"; }
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-goog-api-key|x-auth-token|x-splunk-.*|x-key)$/i;

export interface SafeFetchOptions extends OutboundPolicy {
  /** Max redirects to follow (each hop re-validated). Default 0 = return the 3xx as-is. */
  maxRedirects?: number;
  /** Extra header names to strip on a cross-origin redirect (e.g. a custom auth header). */
  sensitiveHeaders?: string[];
}

/**
 * fetch() wrapper that validates the URL (and every redirect hop) against the
 * outbound policy. Throws SsrfBlockedError when a target is disallowed.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 0;
  const extra = new Set((opts.sensitiveHeaders || []).map((h) => h.toLowerCase()));
  let current = rawUrl;
  let headers = new Headers(init.headers || {});
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  const origin0 = (() => { try { return new URL(rawUrl).origin; } catch { return ""; } })();

  for (let hop = 0; ; hop++) {
    const chk = await assertSafeOutboundUrl(current, opts);
    if (!chk.ok) throw new SsrfBlockedError(`${chk.error}: ${redactUrl(current)}`);
    const res = await fetch(chk.url, { ...init, method, body, headers, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc || hop >= maxRedirects) return res;
    const next = new URL(loc, chk.url).toString();
    if (new URL(next).origin !== origin0) {
      const h2 = new Headers();
      headers.forEach((v, k) => { if (!SENSITIVE_HEADER.test(k) && !extra.has(k.toLowerCase())) h2.set(k, v); });
      headers = h2;
    }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET"; body = undefined; headers.delete("content-type");
    }
    current = next;
  }
}

/** Drop query string / userinfo so tokens in URLs never land in logs or errors. */
export function redactUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return "<invalid url>"; }
}

/**
 * Cheap syntactic check for a URL about to be SAVED (the resolve-and-check
 * runs at fetch time). Empty is allowed (= use default). Returns an error
 * message or null.
 */
export function invalidHttpUrl(raw: unknown, field = "url"): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return `${field} must be an http(s) URL`;
    if (u.username || u.password) return `${field} must not embed credentials`;
  } catch { return `${field} is not a valid URL`; }
  return null;
}

/**
 * dns.lookup-compatible resolver for node `http(s).request({ lookup })` that
 * enforces the outbound policy on the address actually connected to — this
 * closes DNS rebinding for callers using the node http stack.
 */
export function safeLookup(policy: OutboundPolicy = {}) {
  return (hostname: string, options: any, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    if (typeof options === "function") { cb = options; options = {}; }
    const h = String(hostname).toLowerCase().replace(/\.$/, "");
    if (BLOCKED_HOSTNAMES.has(h)) { cb(Object.assign(new Error("cloud metadata host is blocked"), { code: "ESSRF" }), ""); return; }
    dnsLookupCb(hostname, { ...(options || {}), all: true }, (err, addrs: LookupAddress[]) => {
      if (err) { cb(err, ""); return; }
      for (const a of addrs) {
        if (!verdictAllowed(classify(a.address, a.family), policy)) {
          cb(Object.assign(new Error(`destination ${a.address} is blocked by outbound policy`), { code: "ESSRF" }), "");
          return;
        }
      }
      if (options?.all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

/** Lab-integration policy: private ranges OK; loopback only in dev or with the env opt-in. */
export function labOutboundPolicy(envFlag = "OUTBOUND_ALLOW_LOOPBACK"): OutboundPolicy {
  return {
    allowPrivate: true,
    allowLoopback: process.env.NODE_ENV !== "production" || process.env[envFlag] === "1" || process.env.OUTBOUND_ALLOW_LOOPBACK === "1",
  };
}

/**
 * Synchronous pre-check for node http(s).request callers: scheme must be
 * http(s), and an IP-literal host (which bypasses `lookup`) is classified
 * here. Hostnames are left to `safeLookup`. Returns an error or null.
 */
export function syncUrlBlockReason(raw: string, policy: OutboundPolicy = {}): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "invalid URL"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "only http(s) URLs are allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) return "invalid URL host";
  if (BLOCKED_HOSTNAMES.has(host)) return "cloud metadata host is blocked";
  const fam = isIP(host);
  if (fam && !verdictAllowed(classify(host, fam), policy)) return `destination ${host} is blocked by outbound policy`;
  return null;
}
