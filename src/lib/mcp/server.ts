/**
 * Builds a configured MCP server instance for a single authenticated request.
 *
 * Stateless: one McpServer is created per request with the caller's scope context,
 * so tools/list only advertises tools the key is allowed to call. Handlers call the
 * read-only query layer and return JSON text content. Each tools/call is audited.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logEvent } from "@/lib/event-log";
import { MCP_SERVER_INFO } from "./flags";
import { hasScope, type McpScope } from "./auth";
import { MCP_TOOLS } from "./tools";

export interface McpCtx {
  keyId: string;
  scopes: string[];
  tier: string;
}

export function buildMcpServer(ctx: McpCtx): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version },
    {
      capabilities: { tools: {} },
      instructions:
        "DetectOps detection-content server. Search 14k+ security detection rules (Sigma, Elastic, " +
        "Splunk, Sentinel, Defender, Wazuh, Panther, Falco), IOCs, CVEs, and threat-actor intel. " +
        "Start with search_detections or list_by_mitre; call get_detection for full rule logic.",
    },
  );

  for (const tool of MCP_TOOLS) {
    // Only register tools this key is scoped for.
    if (!hasScope(ctx, tool.scope as McpScope)) continue;

    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: any) => {
        const started = Date.now();
        try {
          const result = await tool.handler(args ?? {});
          void logEvent({
            category: "mcp",
            action: "mcp.tools.call",
            actor: `key:${ctx.keyId}`,
            status: "ok",
            targetType: "McpTool",
            targetId: tool.name,
            durationMs: Date.now() - started,
            message: `tools/call ${tool.name}`,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          void logEvent({
            category: "mcp",
            action: "mcp.tools.call",
            actor: `key:${ctx.keyId}`,
            status: "error",
            targetType: "McpTool",
            targetId: tool.name,
            durationMs: Date.now() - started,
            errorMessage: err?.message || String(err),
          });
          return { content: [{ type: "text", text: JSON.stringify({ error: err?.message || "tool error" }) }], isError: true };
        }
      },
    );
  }

  return server;
}
