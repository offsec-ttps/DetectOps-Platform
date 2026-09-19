/**
 * Splunk SPL / Splunk ESCU parser → RuleContext.
 *
 * Splunk ESCU YAMLs land in `SplunkDetection`. We additionally support
 * `CustomDetection` (analyst-authored / uploaded SPL). The detection logic
 * field is the raw SPL string; we pull `index=`, `sourcetype=`, `eventtype=`
 * to identify log sources, plus the structured MITRE arrays.
 */

import { extractTechniqueIds, safeJson, truncateBody, type RuleContext } from "./shared";

interface SplunkDetectionRow {
  id: string;
  detectionId: string;
  name: string;
  description: string;
  search: string;
  type: string;
  dataSource: string;                              // JSON
  mitreTechniques: string;                         // JSON
  mitreTactics: string;                            // JSON
  references: string;                              // JSON
  knownFalsePositives: string;
  filePath: string;
  sourceUrl: string;
  products: string;                                // JSON
  category: string;
  status: string;
}

interface CustomDetectionRow {
  id: string;
  name: string;
  description: string;
  search: string;
  type: string;
  mitreTechniques: string;                         // JSON
  mitreTactics: string;                            // JSON
  category: string;
  tags: string;                                    // JSON
}

/** Extract canonical Splunk pieces from a raw SPL string. */
function extractSplPieces(spl: string): { indexes: string[]; sourcetypes: string[]; eventtypes: string[]; tables: string[] } {
  const indexes = new Set<string>();
  const sourcetypes = new Set<string>();
  const eventtypes = new Set<string>();
  const tables = new Set<string>();

  // Simple key=value extraction
  for (const m of spl.matchAll(/\bindex\s*=\s*["']?([A-Za-z0-9_\-*]+)["']?/g)) indexes.add(m[1]);
  for (const m of spl.matchAll(/\bsourcetype\s*=\s*["']?([A-Za-z0-9_:\-\\.\*]+)["']?/g)) sourcetypes.add(m[1]);
  for (const m of spl.matchAll(/\beventtype\s*=\s*["']?([A-Za-z0-9_\-]+)["']?/g)) eventtypes.add(m[1]);
  // tstats / datamodel
  for (const m of spl.matchAll(/\bdatamodel\s*=?\s*["']?([A-Za-z0-9_]+)["']?/g)) tables.add(`datamodel:${m[1]}`);
  for (const m of spl.matchAll(/\bfrom\s+datamodel:([A-Za-z0-9_\.]+)/gi)) tables.add(`datamodel:${m[1]}`);

  return {
    indexes: [...indexes],
    sourcetypes: [...sourcetypes],
    eventtypes: [...eventtypes],
    tables: [...tables],
  };
}

function buildSummary(name: string, type: string, pieces: ReturnType<typeof extractSplPieces>, techniques: string[]): string {
  const logSourcesPretty = [
    pieces.indexes.length ? `index=${pieces.indexes.join("|")}` : "",
    pieces.sourcetypes.length ? `sourcetype=${pieces.sourcetypes.join("|")}` : "",
    pieces.eventtypes.length ? `eventtype=${pieces.eventtypes.join("|")}` : "",
    pieces.tables.length ? pieces.tables.join("|") : "",
  ].filter(Boolean).join(", ") || "unspecified";
  return [
    `Splunk SPL detection "${name}" (type=${type || "n/a"})`,
    `Log sources: ${logSourcesPretty}`,
    techniques.length ? `Techniques: ${techniques.join(", ")}` : "No technique tags",
  ].join(". ");
}

export function parseSplunkDetectionRow(row: SplunkDetectionRow): RuleContext {
  const pieces = extractSplPieces(row.search);
  const techniques = [...new Set([
    ...safeJson<string[]>(row.mitreTechniques, []),
    ...extractTechniqueIds(row.description, row.search),
  ])];
  const tactics = safeJson<string[]>(row.mitreTactics, []);
  const references = safeJson<string[]>(row.references, []);
  const products = safeJson<string[]>(row.products, []);
  const dataSources = safeJson<string[]>(row.dataSource, []);
  const logSources = [
    ...pieces.indexes.map((i) => `index:${i}`),
    ...pieces.sourcetypes.map((s) => `sourcetype:${s}`),
    ...pieces.eventtypes.map((e) => `eventtype:${e}`),
    ...pieces.tables,
    ...dataSources.map((d) => `datasource:${d}`),
  ];

  return {
    sourceTable: "SplunkDetection",
    ruleId: row.id,
    upstreamRuleId: row.detectionId,
    upstreamUrl: row.sourceUrl || (row.filePath ? `https://github.com/splunk/security_content/blob/develop/${row.filePath}` : ""),
    title: row.name,
    description: row.description,
    ruleLanguage: "spl",
    detectionLogic: truncateBody(row.search),
    mitreTechniques: techniques,
    mitreTactics: tactics,
    logSources,
    platforms: [],                                   // Splunk ESCU doesn't carry platform reliably
    products: products.length ? products : ["splunk"],
    severity: "",
    references,
    falsePositives: row.knownFalsePositives ? [row.knownFalsePositives] : [],
    summary: buildSummary(row.name, row.type, pieces, techniques),
  };
}

export function parseCustomDetectionRow(row: CustomDetectionRow): RuleContext {
  const pieces = extractSplPieces(row.search);
  const techniques = [...new Set([
    ...safeJson<string[]>(row.mitreTechniques, []),
    ...extractTechniqueIds(row.description, row.search),
  ])];
  const tactics = safeJson<string[]>(row.mitreTactics, []);
  const logSources = [
    ...pieces.indexes.map((i) => `index:${i}`),
    ...pieces.sourcetypes.map((s) => `sourcetype:${s}`),
    ...pieces.eventtypes.map((e) => `eventtype:${e}`),
    ...pieces.tables,
  ];

  return {
    sourceTable: "CustomDetection",
    ruleId: row.id,
    upstreamRuleId: row.id,
    upstreamUrl: "",
    title: row.name,
    description: row.description,
    ruleLanguage: "spl",
    detectionLogic: truncateBody(row.search),
    mitreTechniques: techniques,
    mitreTactics: tactics,
    logSources,
    platforms: [],
    products: ["splunk"],
    severity: "",
    references: [],
    falsePositives: [],
    summary: buildSummary(row.name, row.type, pieces, techniques),
  };
}
