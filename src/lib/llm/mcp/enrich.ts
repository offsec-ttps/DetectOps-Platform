/**
 * MCP enrichment hook.
 *
 * Called by generators *before* the LLM tool call. Receives the structured
 * context the generator built (IOCs, technique IDs, references) and returns
 * an optional `enrichment` block that the generator appends to the user
 * message.
 *
 * Phase 3: for every configured `MCP_SERVERS` entry, lists its tools, picks
 * the ones that look relevant to this call, invokes them, and stitches the
 * results into the enrichment block. A server that's unreachable, slow, or
 * errors never fails the overall call — it just gets a one-line note instead
 * of results, so generation always proceeds.
 */

import { listMcpServers, listMcpServerTools, callMcpTool, type McpServerConfig } from "./client";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface EnrichInput {
  iocs?: Record<string, unknown>;
  techniques?: string[];
  /** Extra free-form hint the caller wants to share. */
  hint?: string;
}

export interface EnrichResult {
  servers: McpServerConfig[];
  /** Pre-rendered block ready to append to the LLM user message. Empty when no MCP servers configured. */
  enrichment: string;
}

const TECHNIQUE_TERMS = ["mitre", "technique", "attack", "tactic"];
const IOC_TERMS = ["ioc", "hash", "ip", "domain", "url", "reputation", "lookup", "intel", "malware", "cve"];
const MAX_TOOLS_PER_SERVER = 2;
const MAX_RESULT_CHARS_PER_TOOL = 1500;
const MAX_TOTAL_ENRICHMENT_CHARS = 6000;

function pickRelevantTools(tools: Tool[], input: EnrichInput): Tool[] {
  const terms: string[] = [];
  if (input.techniques?.length) terms.push(...TECHNIQUE_TERMS);
  if (input.iocs && Object.keys(input.iocs).length) terms.push(...IOC_TERMS);
  if (input.hint) terms.push(...TECHNIQUE_TERMS, ...IOC_TERMS);

  if (terms.length) {
    const matched = tools.filter((t) => {
      const hay = `${t.name} ${t.description ?? ""}`.toLowerCase();
      return terms.some((term) => hay.includes(term));
    });
    if (matched.length) return matched.slice(0, MAX_TOOLS_PER_SERVER);
  }

  // No keyword match — if the server is narrowly-scoped, it was probably
  // configured *for* this kind of enrichment, so try it anyway.
  if (tools.length > 0 && tools.length <= MAX_TOOLS_PER_SERVER) return tools;
  return [];
}

/** Best-effort arg mapping from an EnrichInput onto a tool's declared inputSchema. */
function buildArgs(tool: Tool, input: EnrichInput): Record<string, unknown> {
  const props = (tool.inputSchema as any)?.properties as Record<string, any> | undefined;
  if (!props) return {};

  const candidates: Record<string, unknown> = {
    query: input.hint || input.techniques?.[0],
    q: input.hint || input.techniques?.[0],
    technique: input.techniques?.[0],
    technique_id: input.techniques?.[0],
    hint: input.hint,
  };
  if (input.iocs) {
    for (const key of ["ioc", "value", "hash", "domain", "ip", "url"]) {
      if (input.iocs[key] != null) candidates[key] = input.iocs[key];
    }
  }

  const args: Record<string, unknown> = {};
  for (const propName of Object.keys(props)) {
    if (candidates[propName] != null) args[propName] = candidates[propName];
  }

  if (Object.keys(args).length === 0) {
    // Fall back to the first required string property, filled with whatever
    // we have that's most likely to be useful.
    const required: string[] = (tool.inputSchema as any)?.required ?? [];
    const fallbackValue = input.hint || input.techniques?.[0] || (input.iocs && Object.values(input.iocs)[0]);
    const firstStringProp = required.find((r) => props[r]?.type === "string") ?? Object.keys(props).find((k) => props[k]?.type === "string");
    if (firstStringProp && fallbackValue != null) args[firstStringProp] = fallbackValue;
  }

  return args;
}

async function queryServer(server: McpServerConfig, input: EnrichInput): Promise<string> {
  const tools = await listMcpServerTools(server);
  const chosen = pickRelevantTools(tools, input);
  if (chosen.length === 0) {
    return `  - ${server.name}: ${tools.length} tool(s) available, none matched this context`;
  }

  const results: string[] = [];
  for (const tool of chosen) {
    try {
      const args = buildArgs(tool, input);
      const text = await callMcpTool(server, tool.name, args);
      const trimmed = text.length > MAX_RESULT_CHARS_PER_TOOL ? `${text.slice(0, MAX_RESULT_CHARS_PER_TOOL)}\n…(truncated)` : text;
      results.push(`  - ${server.name}.${tool.name}:\n${trimmed}`);
    } catch (err: any) {
      results.push(`  - ${server.name}.${tool.name}: call failed (${err?.message || String(err)})`);
    }
  }
  return results.join("\n");
}

export async function enrichContext(input: EnrichInput): Promise<EnrichResult> {
  const servers = await listMcpServers();
  if (servers.length === 0) {
    return { servers: [], enrichment: "" };
  }

  const settled = await Promise.allSettled(servers.map((s) => queryServer(s, input)));
  const lines: string[] = ["MCP enrichment:"];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      lines.push(r.value);
    } else {
      lines.push(`  - ${servers[i].name}: unreachable (${r.reason?.message || String(r.reason)})`);
    }
  });

  let enrichment = lines.join("\n");
  if (enrichment.length > MAX_TOTAL_ENRICHMENT_CHARS) {
    enrichment = `${enrichment.slice(0, MAX_TOTAL_ENRICHMENT_CHARS)}\n…(enrichment truncated)`;
  }

  return { servers, enrichment };
}
