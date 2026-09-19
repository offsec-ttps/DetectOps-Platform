/**
 * Elastic detection-rule TOML → RuleContext.
 *
 * Elastic stores its threat mappings as a nested JSON array in
 * `CommunityElasticRule.threat`. The rule body itself is TOML; the actual
 * detection logic lives in the `query` field (KQL, EQL, or Lucene). We
 * normalise index patterns from `index`, infer platform from the rule's
 * `platform` column, and surface `note`+`setup` as auxiliary context.
 */

import { extractTechniqueIds, safeJson, truncateBody, type RuleContext } from "./shared";

interface CommunityElasticRuleRow {
  id: string;
  ruleId: string | null;
  name: string;
  description: string;
  severity: string;
  type: string;
  language: string;                                // kuery | eql | lucene
  query: string;
  index: string;                                   // JSON array
  tags: string;                                    // JSON
  threat: string;                                  // JSON array of threat objects
  mitreTechniques: string;                         // JSON
  mitreTactics: string;                            // JSON
  author: string;                                  // JSON
  references: string;                              // JSON
  falsepositives: string;                          // JSON
  note: string;
  setup: string;
  ruleContent: string;                             // full TOML
  filePath: string;
  repositoryUrl: string;
  platform: string;
  integration: string;                             // JSON
}

interface ElasticThreatEntry {
  framework?: string;
  technique?: Array<{ id: string; name?: string; subtechnique?: Array<{ id: string; name?: string }> }>;
  tactic?: { id: string; name: string };
}

export function parseElasticTomlRow(row: CommunityElasticRuleRow): RuleContext {
  const threats = safeJson<ElasticThreatEntry[]>(row.threat, []);
  const tagTechniques: string[] = [];
  const tagTactics: string[] = [];
  for (const t of threats) {
    if (t.tactic?.name) tagTactics.push(t.tactic.name);
    for (const tech of t.technique || []) {
      if (tech.id) tagTechniques.push(tech.id);
      for (const sub of tech.subtechnique || []) {
        if (sub.id) tagTechniques.push(sub.id);
      }
    }
  }

  const techniques = [...new Set([
    ...tagTechniques,
    ...safeJson<string[]>(row.mitreTechniques, []),
    ...extractTechniqueIds(row.description, row.query),
  ])];
  const tactics = [...new Set([
    ...tagTactics,
    ...safeJson<string[]>(row.mitreTactics, []),
  ])];

  const indexes = safeJson<string[]>(row.index, []);
  const integration = safeJson<string[]>(row.integration, []);
  const references = safeJson<string[]>(row.references, []);
  const fps = safeJson<string[]>(row.falsepositives, []);
  const logSources = [
    ...indexes.map((i) => `index:${i}`),
    ...integration.map((i) => `integration:${i}`),
  ];

  const platforms = row.platform === "windows" ? ["windows"]
                  : row.platform === "linux"   ? ["linux"]
                  : row.platform === "macos"   ? ["macos"]
                  : row.platform === "network" ? ["network"]
                  : [];

  const summary = [
    `Elastic ${row.type || "query"} detection "${row.name}" (severity=${row.severity || "n/a"}, language=${row.language || "kuery"})`,
    `Indices: ${indexes.slice(0, 6).join(", ") || "unspecified"}`,
    techniques.length ? `Techniques: ${techniques.join(", ")}` : "No technique tags",
  ].join(". ");

  return {
    sourceTable: "CommunityElasticRule",
    ruleId: row.id,
    upstreamRuleId: row.ruleId || "",
    upstreamUrl: row.repositoryUrl || (row.filePath ? `https://github.com/elastic/detection-rules/blob/main/${row.filePath}` : ""),
    title: row.name,
    description: row.description,
    ruleLanguage: row.language || "kuery",
    // For Elastic, ship the query body as the primary; carry the TOML if there's room.
    detectionLogic: truncateBody(
      [row.query, row.note ? `\n# Note: ${row.note}` : "", row.setup ? `\n# Setup: ${row.setup}` : ""]
        .filter(Boolean).join("\n"),
    ),
    mitreTechniques: techniques,
    mitreTactics: tactics,
    logSources,
    platforms,
    products: ["elastic"],
    severity: row.severity || "",
    references,
    falsePositives: fps,
    summary,
  };
}
