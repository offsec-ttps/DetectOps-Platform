/**
 * Streamable-HTTP MCP endpoint.
 *
 *   POST /api/mcp    — JSON-RPC (initialize / tools/list / tools/call), API-key gated.
 *   GET  /api/mcp    — 405 (stateless: no server-initiated SSE stream).
 *   OPTIONS /api/mcp — CORS preflight.
 *
 * Uses the SDK's Web-standard transport, which takes a Web `Request` and returns a
 * Web `Response` — so it drops straight into a Next.js route handler with no Node
 * req/res bridge. Stateless (sessionIdGenerator: undefined): a fresh server +
 * transport per request, scoped to the authenticated key.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { requireMcpApiKey } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { mcpFlags } from "@/lib/mcp/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method Not Allowed: this stateless MCP server only accepts POST." }, id: null },
    { status: 405, headers: CORS },
  );
}

export async function POST(req: NextRequest) {
  if (!mcpFlags.enabled) {
    return NextResponse.json({ error: "MCP server disabled (ENABLE_MCP_SERVER=false)" }, { status: 503, headers: CORS });
  }

  // Authenticate + rate-limit + quota before touching the protocol layer.
  const auth = await requireMcpApiKey(req);
  if (!auth.ok) {
    // auth.response already carries Access-Control-Allow-Origin.
    return auth.response;
  }

  const server = buildMcpServer({ keyId: auth.keyId, scopes: auth.scopes, tier: auth.tier });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // return a single JSON response, not an SSE stream
  });

  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    // Re-emit with CORS headers (preserve the transport's body + status).
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (err: any) {
    // Best-effort cleanup only on the error path; on success the transport is
    // owned by the returned Response and GC'd after it flushes.
    void Promise.resolve(transport.close?.()).catch(() => {});
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32603, message: err?.message || "internal error" }, id: null },
      { status: 500, headers: CORS },
    );
  }
}
