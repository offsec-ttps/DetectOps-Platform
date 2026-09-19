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
  { method: "POST", pattern: /^attack-range\/update-name$/ },
  { method: "POST", pattern: /^attack-range\/simulate$/ },
];

function isAllowed(method: string, path: string): boolean {
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

  const upstream = `${SAR_API}/${path}`;
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
