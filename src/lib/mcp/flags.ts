/**
 * Feature flags + config for the detection-content MCP server.
 * All env-driven so deployment can toggle without a rebuild.
 */

function boolEnv(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === "") return def;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

export const mcpFlags = {
  /** Master switch for the MCP server + its /api/mcp routes. */
  enabled: boolEnv("ENABLE_MCP_SERVER", true),
};

/** Public base URL advertised to clients (docs, registry console snippet). */
export function mcpPublicBaseUrl(): string {
  return (process.env.MCP_PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Server identity reported in the MCP `initialize` handshake. */
export const MCP_SERVER_INFO = {
  name: "detectops-detections",
  version: "1.0.0",
  title: "DetectOps Detection Content",
} as const;
