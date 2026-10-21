/**
 * MCP server registry + client.
 *
 * Two sources feed the registry, merged by `listMcpServers()`:
 *   1. DB — `McpClientServer` rows, managed via the Settings UI
 *      (/settings/mcp-servers) and its `/api/mcp/servers` CRUD routes. This
 *      is the primary, user-facing way to configure servers.
 *   2. Env — `MCP_SERVERS`, a fallback/import path for self-hosters who
 *      prefer config-as-code. Semicolon-separated entries:
 *        name=transport:address[|option=value,...]
 *      Example:
 *        MCP_SERVERS="virustotal=stdio:/usr/local/bin/mcp-virustotal;misp=http:http://misp.local/mcp|token=abc123"
 *
 * DB rows win on name collision. `connectClient` / `listMcpServerTools` /
 * `callMcpTool` do the actual MCP handshake (tools/list, tools/call) over
 * stdio/http — used by `./enrich.ts` to pull real data from configured
 * servers.
 *
 * Auth convention: an `options.token` entry is sent as `Authorization: Bearer
 * <token>` for http-transport servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";
import { assertSafeOutboundUrl } from "@/lib/net/ssrf";

export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  /** Full command line for stdio, or URL for http. */
  address: string;
  /** Optional key=value flags appended after a colon in the env. */
  options: Record<string, string>;
}

let envCache: McpServerConfig[] | null = null;

/** Parses the `MCP_SERVERS` env var. Sync, cheap — cached until reset. */
export function listEnvMcpServers(force = false): McpServerConfig[] {
  if (envCache && !force) return envCache;
  const raw = process.env.MCP_SERVERS || "";
  if (!raw.trim()) { envCache = []; return envCache; }

  const servers: McpServerConfig[] = [];
  for (const entry of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const name = entry.slice(0, eq).trim();
    const rest = entry.slice(eq + 1).trim();
    const colon = rest.indexOf(":");
    if (colon < 0) continue;
    const transport = rest.slice(0, colon).trim() as McpTransport;
    if (transport !== "stdio" && transport !== "http") continue;
    const tail = rest.slice(colon + 1).trim();

    // Options are pipe-separated kv pairs after a `|` — keeps URL colons intact.
    const [address, optsTail = ""] = tail.split("|");
    const options: Record<string, string> = {};
    for (const kv of optsTail.split(",").map((s) => s.trim()).filter(Boolean)) {
      const eqi = kv.indexOf("=");
      if (eqi > 0) options[kv.slice(0, eqi)] = kv.slice(eqi + 1);
    }
    servers.push({ name, transport, address: address.trim(), options });
  }
  envCache = servers;
  return envCache;
}

let dbCache: { at: number; servers: McpServerConfig[] } | null = null;
const DB_CACHE_TTL_MS = 30_000;

function safeDecrypt(s: string): string {
  if (!s) return "";
  try { return decrypt(s); } catch { return ""; }
}

/** Loads enabled `McpClientServer` rows from the DB, decrypting tokens. Cached briefly. */
async function loadDbServers(force = false): Promise<McpServerConfig[]> {
  if (dbCache && !force && Date.now() - dbCache.at < DB_CACHE_TTL_MS) return dbCache.servers;
  const rows = await prisma.mcpClientServer.findMany({ where: { enabled: true } });
  const servers: McpServerConfig[] = rows.map((r) => {
    const token = safeDecrypt(r.tokenEnc);
    const options: Record<string, string> = {};
    if (token) options.token = token;
    return { name: r.label, transport: r.transport as McpTransport, address: r.address, options };
  });
  dbCache = { at: Date.now(), servers };
  return servers;
}

/** Merged registry: DB-managed servers (Settings UI) + `MCP_SERVERS` env fallback. DB wins on name collision. */
export async function listMcpServers(force = false): Promise<McpServerConfig[]> {
  const [dbServers, envServers] = await Promise.all([loadDbServers(force), Promise.resolve(listEnvMcpServers(force))]);
  const byName = new Map<string, McpServerConfig>();
  for (const s of envServers) byName.set(s.name, s);
  for (const s of dbServers) byName.set(s.name, s); // DB wins
  return [...byName.values()];
}

/** Reset both caches — used after DB writes (CRUD routes) or env mutations (tests). */
export function invalidateMcpServerCache(): void {
  envCache = null;
  dbCache = null;
}

/** @deprecated use invalidateMcpServerCache */
export function resetMcpServerCache(): void { invalidateMcpServerCache(); }

// ── live client ──────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 10_000;
const TOOLS_CACHE_TTL_MS = 5 * 60_000;

const toolsCache = new Map<string, { at: number; tools: Tool[] }>();

/** Connects to a configured server and returns a live, ready-to-use client. Caller must close() it. */
export async function connectClient(config: McpServerConfig): Promise<Client> {
  const client = new Client({ name: "detectops-detection-platform", version: "1.0.0" }, { capabilities: {} });

  if (config.transport === "stdio") {
    const [command, ...args] = config.address.split(/\s+/).filter(Boolean);
    const transport = new StdioClientTransport({ command, args });
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  } else {
    // Admin-configured, so LAN / localhost MCP servers are allowed — but never
    // cloud metadata / link-local (would hand the bearer token + IAM creds over).
    const chk = await assertSafeOutboundUrl(config.address, { allowPrivate: true, allowLoopback: true });
    if (!chk.ok) throw new Error(`MCP server address rejected: ${chk.error}`);
    const headers: Record<string, string> = {};
    if (config.options.token) headers.Authorization = `Bearer ${config.options.token}`;
    const transport = new StreamableHTTPClientTransport(new URL(config.address), { requestInit: { headers } });
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  }

  return client;
}

/** Lists the tools a configured server exposes. Cached in-process for a few minutes. */
export async function listMcpServerTools(config: McpServerConfig, force = false): Promise<Tool[]> {
  const hit = toolsCache.get(config.name);
  if (!force && hit && Date.now() - hit.at < TOOLS_CACHE_TTL_MS) return hit.tools;

  const client = await connectClient(config);
  try {
    const result = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS });
    toolsCache.set(config.name, { at: Date.now(), tools: result.tools });
    return result.tools;
  } finally {
    await client.close();
  }
}

/** Calls a tool on a configured server and returns its concatenated text content. */
export async function callMcpTool(config: McpServerConfig, toolName: string, args: Record<string, unknown>): Promise<string> {
  const client = await connectClient(config);
  try {
    const result = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
    const parts = Array.isArray(result.content)
      ? result.content.filter((c: any) => c?.type === "text").map((c: any) => String(c.text))
      : [];
    const text = parts.join("\n");
    if (result.isError) throw new Error(text || `tool "${toolName}" returned an error`);
    return text;
  } finally {
    await client.close();
  }
}
