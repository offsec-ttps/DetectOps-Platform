/**
 * MCP tool catalog for the detection-content server.
 *
 * Each tool declares a name, description, required scope, a zod raw-shape
 * inputSchema (the SDK turns it into JSON Schema for tools/list), and a handler
 * that calls the read-only query layer (src/lib/mcp/query.ts) and returns a
 * plain object (the server wraps it into MCP text content).
 */

import { z } from "zod";
import type { McpScope } from "./auth";
import * as q from "./query";

export interface McpTool {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: z.ZodRawShape;
  handler: (args: any) => Promise<unknown>;
}

const storeEnum = z.enum(["unified", "sigma", "elastic", "splunk"]);

export const MCP_TOOLS: McpTool[] = [
  {
    name: "search_detections",
    description:
      "Search security detection rules across all sources (SigmaHQ, Elastic, Splunk, Microsoft Sentinel/Defender, Wazuh, Panther, Falco, MITRE CAR, Google SecOps). Filter by free text, MITRE technique/tactic, platform, severity, rule language, or rule type.",
    scope: "detections:read",
    inputSchema: {
      q: z.string().optional().describe("Free-text query over title/description"),
      technique: z.string().optional().describe("MITRE ATT&CK technique id, e.g. T1059 or T1059.001"),
      tactic: z.string().optional().describe("MITRE tactic id or name, e.g. TA0002 or Execution"),
      platform: z.string().optional().describe("Platform substring, e.g. windows, linux, azure, m365"),
      severity: z.string().optional().describe("info | low | medium | high | critical"),
      ruleLanguage: z.string().optional().describe("sigma | spl | kql | eql | yara-l | python | falco-yaml | wazuh-xml"),
      ruleType: z.string().optional().describe("detection | hunting | analytic | correlation"),
      stores: z.array(storeEnum).optional().describe("Restrict to specific stores"),
      limit: z.number().int().optional().describe("Max results (default 25, max 100)"),
      offset: z.number().int().optional().describe("Pagination offset"),
    },
    handler: (a) => q.searchDetections(a),
  },
  {
    name: "get_detection",
    description: "Retrieve one detection rule in full, including its native detection logic (Sigma YAML / SPL / KQL / EQL / raw rule body). Use the `store` and `id` from a search result.",
    scope: "detections:read",
    inputSchema: {
      store: storeEnum.describe("Which store the rule lives in (from search results)"),
      id: z.string().describe("Rule id (from search results)"),
    },
    handler: async (a) => (await q.getDetection(a)) ?? { error: "not found" },
  },
  {
    name: "search_sigma_rules",
    description: "Search only SigmaHQ rules by free text and/or MITRE technique. Returns Sigma rule metadata; use get_detection with store=sigma for the full YAML.",
    scope: "detections:read",
    inputSchema: {
      q: z.string().optional(),
      technique: z.string().optional().describe("MITRE technique id, e.g. T1566"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.searchDetections({ ...a, stores: ["sigma"] }),
  },
  {
    name: "list_by_mitre",
    description: "List detection rules mapped to a MITRE ATT&CK technique (e.g. T1059.001) or tactic (e.g. TA0002 / Execution), across all sources.",
    scope: "detections:read",
    inputSchema: {
      technique: z.string().optional().describe("Technique id, e.g. T1059 (matches sub-techniques too)"),
      tactic: z.string().optional().describe("Tactic id or name"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.listByMitre(a),
  },
  {
    name: "list_by_platform",
    description: "List detection rules for a platform/product (windows, linux, macos, azure, aws, gcp, m365, kubernetes, …).",
    scope: "detections:read",
    inputSchema: {
      platform: z.string().describe("Platform/product substring"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.listByPlatform(a),
  },
  {
    name: "list_sources",
    description: "List all detection content sources/vendors we aggregate and how many rules each contributes.",
    scope: "detections:read",
    inputSchema: {},
    handler: () => q.listSources(),
  },
  {
    name: "list_by_vendor",
    description: "List detection rules from a specific vendor/source (e.g. Microsoft, Elastic, Splunk, Wazuh, Panther, SigmaHQ).",
    scope: "detections:read",
    inputSchema: {
      vendor: z.string().describe("Vendor/source name substring"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.listByVendor(a),
  },
  {
    name: "latest_detections",
    description: "Retrieve the most recently added/updated detection rules across all sources.",
    scope: "detections:read",
    inputSchema: { limit: z.number().int().optional().describe("How many (default 25, max 100)") },
    handler: (a) => q.latestDetections(a),
  },
  {
    name: "get_stats",
    description: "Repository statistics: detection-rule counts per source, threat-intel report + IOC counts, and IOC breakdown by type.",
    scope: "detections:read",
    inputSchema: {},
    handler: () => q.getStats(),
  },
  {
    name: "search_iocs",
    description: "Search Indicators of Compromise (IOCs): filter by type (ipv4, ipv6, domain, url, sha256, sha1, md5, email, cve, filename, registry) and/or value substring.",
    scope: "intel:read",
    inputSchema: {
      type: z.string().optional().describe("IOC type, e.g. domain, sha256, ipv4, cve"),
      value: z.string().optional().describe("Value substring to match (indexed → fast)"),
      confidence: z.string().optional().describe("high | medium | low"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.searchIocs(a),
  },
  {
    name: "search_by_cve",
    description: "Find IOCs and threat-intel reports referencing a specific CVE, e.g. CVE-2024-3400.",
    scope: "intel:read",
    inputSchema: {
      cve: z.string().describe("CVE id, e.g. CVE-2024-3400"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.searchByCve(a),
  },
  {
    name: "search_threat_actors",
    description: "Find threat-intel reports for a threat actor / APT group by name or alias (e.g. LockBit, APT29, Cozy Bear).",
    scope: "intel:read",
    inputSchema: {
      actor: z.string().describe("Threat actor / APT group name or alias"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.searchThreatActors(a),
  },
  {
    name: "search_by_malware_family",
    description: "Find threat-intel reports mentioning a malware family (best-effort text match, e.g. Emotet, Qakbot, Cobalt Strike).",
    scope: "intel:read",
    inputSchema: {
      family: z.string().describe("Malware family name"),
      limit: z.number().int().optional(),
    },
    handler: (a) => q.searchByMalwareFamily(a),
  },
];
