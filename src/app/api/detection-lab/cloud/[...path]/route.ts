/**
 * Transparent proxy to the Splunk Attack Range (SAR) Docker controller's REST API.
 *
 * SAR runs in a Docker stack deployed via the "SAR + Onprem Docker" template.
 * The controller exposes its API at http://localhost:4000 by default.
 * All browser → SAR requests go through this proxy so we can:
 *   - keep same-origin (avoid CORS / mixed-port awkwardness)
 *   - allowlist the paths the UI actually uses
 *   - return a clean "SAR unreachable" payload when the controller is down
 *
 * The UI base URL is /api/detection-lab/cloud/<path> — the path after "cloud/"
 * is forwarded verbatim to SAR.
 *
 * Env var: SAR_API_URL (default http://localhost:4000)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";

const SAR_API = process.env.SAR_API_URL || "http://localhost:4000";

/**
 * Allowlist entries are "METHOD:path-pattern" where "*" matches one path segment.
 * Unknown paths → 403. This is intentional: SAR exposes destructive endpoints
 * (destroy, abort) that we want to name explicitly.
 */
const ALLOW: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "GET",  pattern: /^health$/ },
  { method: "GET",  pattern: /^templates$/ },
  { method: "GET",  pattern: /^templates\/[^/]+$/ },            // cloud-fields/{provider}
  { method: "GET",  pattern: /^templates\/[^/]+\/[^/]+$/ },     // {provider}/{name}
  { method: "GET",  pattern: /^templates\/cloud-fields\/[^/]+(\/[^/]+)?$/ },
  { method: "GET",  pattern: /^providers\/check$/ },
  { method: "GET",  pattern: /^suggested-ip$/ },
  { method: "GET",  pattern: /^public-ip$/ },
  { method: "POST", pattern: /^attack-range\/build$/ },
  { method: "GET",  pattern: /^attack-range\/status\/[^/]+$/ },
  { method: "GET",  pattern: /^attack-range\/list$/ },
  { method: "POST", pattern: /^attack-range\/destroy$/ },
  { method: "POST", pattern: /^attack-range\/abort$/ },
  { method: "POST", pattern: /^attack-range\/share$/ },
  { method: "POST", pattern: /^attack-range\/revoke$/ },        // LMS ops: revoke a student's VPN
  { method: "GET",  pattern: /^attack-range\/clients\/[^/]+$/ },// LMS ops: list VPN clients + status
  { method: "POST", pattern: /^attack-range\/update-name$/ },
  { method: "POST", pattern: /^attack-range\/simulate$/ },
];

// Server-to-server endpoints the RuSecure LMS bridge drives. These bypass the browser
// and must present the shared service key (DETECTOPS_SERVICE_KEY must match the bridge's
// DETECTOPS_API_KEY). Browser-facing endpoints are unchanged.
const SERVICE_ONLY = /^attack-range\/(revoke$|clients\/)/;

// Spend money / grant network access on the cloud — admin only.
const ADMIN_ONLY = /^attack-range\/(build|destroy|abort|share)$/;

// Each segment is decoded by Next before we see it, so "%2e%2e" arrives as "..":
// `[^/]+` in the allowlist would accept it and fetch() would then normalise
// "templates/../x" to an UNLISTED upstream path. Require plain segments only.
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

function isAllowed(method: string, path: string): boolean {
  if (!path.split("/").every((s) => SAFE_SEGMENT.test(s))) return false;
  return ALLOW.some((r) => r.method === method && r.pattern.test(path));
}

async function proxy(req: NextRequest, path: string) {
  const method = req.method.toUpperCase();
  if (!isAllowed(method, path)) {
    return NextResponse.json(
      { status: "error", message: `Path not allowed: ${method} ${path}` },
      { status: 403 },
    );
  }

  if (ADMIN_ONLY.test(path)) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }

  // Service-key gate for the LMS-driven lab-access endpoints.
  if (SERVICE_ONLY.test(path)) {
    const key = process.env.DETECTOPS_SERVICE_KEY || "";
    const provided = req.headers.get("x-detectops-key") || "";
    if (!key || provided !== key) {
      return NextResponse.json(
        { status: "error", message: "Valid X-DetectOps-Key required for this endpoint" },
        { status: 401 },
      );
    }
  }

  // Forward the query string (e.g. ?range_id=…) along with the path.
  const upstream = `${SAR_API}/${path}${req.nextUrl.search || ""}`;
  const init: RequestInit = { method, headers: {} };

  // Only forward a safe subset of headers
  const ct = req.headers.get("content-type");
  if (ct) (init.headers as Record<string, string>)["content-type"] = ct;

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    init.body = await req.text();
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, init);
  } catch (e: any) {
    return NextResponse.json(
      {
        status: "error",
        available: false,
        reason: `SAR controller not reachable at ${SAR_API}: ${e?.message || e}. ` +
                `Make sure the "SAR + Onprem Docker" template is deployed and running.`,
      },
      { status: 503 },
    );
  }

  const body = await upstreamRes.text();
  const headers = new Headers();
  const upstreamCt = upstreamRes.headers.get("content-type");
  if (upstreamCt) headers.set("content-type", upstreamCt);
  return new NextResponse(body, { status: upstreamRes.status, headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path.join("/"));
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxy(req, path.join("/"));
}
