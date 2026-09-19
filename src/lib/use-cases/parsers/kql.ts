/**
 * KQL parser → RuleContext.
 *
 * Used for the unified `CommunityRule` table when `ruleLanguage="kql"`
 * (Microsoft Sentinel + Defender XDR + Google SecOps rows). We extract:
 *   - Tables (SecurityEvent, DeviceProcessEvents, SigninLogs, etc.) via
 *     the standard KQL pipe syntax
 *   - Technique tags from `mitreTechniques` JSON + free-text scan
 *
 * Also serves as the generic CommunityRule fallback for other ruleLanguage
 * values (yara-l, falco-yaml, wazuh-xml, pseudocode) since those rule
 * bodies are still usable as LLM context even without a custom extractor.
 */

import { extractTechniqueIds, safeJson, truncateBody, type RuleContext } from "./shared";

interface CommunityRuleRow {
  id: string;
  upstreamRuleId: string | null;
  title: string;
  description: string;
  mitreTechniques: string;
  mitreTactics: string;
  platforms: string;
  products: string;
  logSources: string;
  tags: string;
  ruleLanguage: string;
  ruleType: string;
  detectionLogicRaw: string;
  // sourceId, references not on every row — be defensive in code.
  [key: string]: unknown;
}

const KQL_TABLE_RE = /(?:^|\|\s*)([A-Z][A-Za-z0-9]+)(?=\s*\||\s+where|\s+project|\s+summarize|\s*$)/g;
const KQL_TABLE_HEAD_RE = /^([A-Z][A-Za-z0-9]+)\s*(?:\||$)/m;

function extractKqlTables(body: string): string[] {
  const tables = new Set<string>();
  const head = body.match(KQL_TABLE_HEAD_RE);
  if (head?.[1]) tables.add(head[1]);
  let m: RegExpExecArray | null;
  while ((m = KQL_TABLE_RE.exec(body)) !== null) {
    if (m[1] && /^[A-Z]/.test(m[1])) tables.add(m[1]);
  }
  return [...tables];
}

export function parseCommunityRuleRow(row: CommunityRuleRow): RuleContext {
  const body = row.detectionLogicRaw || "";
  const tables = row.ruleLanguage === "kql" ? extractKqlTables(body) : [];

  const techniques = [...new Set([
    ...safeJson<string[]>(row.mitreTechniques, []),
    ...extractTechniqueIds(row.description, body),
  ])];
  const tactics = safeJson<string[]>(row.mitreTactics, []);
  const platforms = safeJson<string[]>(row.platforms, []);
  const products = safeJson<string[]>(row.products, []);
  const declaredLogSources = safeJson<string[]>(row.logSources, []);

  const logSources = [
    ...tables.map((t) => `table:${t}`),
    ...declaredLogSources,
  ];

  // Build a short readable header for the LLM
  const langPretty = row.ruleLanguage || "rule";
  const summary = [
    `${langPretty.toUpperCase()} ${row.ruleType || "detection"} "${row.title}"`,
    products.length ? `Products: ${products.join(", ")}` : "",
    tables.length ? `Tables: ${tables.join(", ")}` : (declaredLogSources.length ? `Log sources: ${declaredLogSources.slice(0, 6).join(", ")}` : ""),
    techniques.length ? `Techniques: ${techniques.join(", ")}` : "No technique tags",
  ].filter(Boolean).join(". ");

  return {
    sourceTable: "CommunityRule",
    ruleId: row.id,
    upstreamRuleId: row.upstreamRuleId || "",
    upstreamUrl: "",
    title: row.title,
    description: row.description,
    ruleLanguage: row.ruleLanguage || "pseudocode",
    detectionLogic: truncateBody(body),
    mitreTechniques: techniques,
    mitreTactics: tactics,
    logSources,
    platforms,
    products,
    severity: "",
    references: [],
    falsePositives: [],
    summary,
  };
}
