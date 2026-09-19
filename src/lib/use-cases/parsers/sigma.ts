/**
 * Sigma YAML parser → RuleContext.
 *
 * SigmaHQ rules carry `tags: [attack.t1234, attack.tactic.execution]`, a
 * `logsource: {category, product, service}` block, a `detection:` block, and
 * `falsepositives:` / `references:`. We extract the structured pieces with
 * js-yaml and fall back to the existing technique regex when tags are noisy.
 */

import * as yaml from "js-yaml";
import { extractTechniqueIds, safeJson, truncateBody, type RuleContext } from "./shared";

interface CommunitySigmaRuleRow {
  id: string;
  sigmaId: string | null;
  title: string;
  description: string;
  level: string;
  tags: string;                                    // JSON
  logsourceCategory: string;
  logsourceProduct: string;
  logsourceService: string;
  detectionYaml: string;
  filePath: string;
  repositoryUrl: string;
  falsepositives: string;                          // JSON
  references: string;                              // JSON
  mitreTechniques: string;                         // JSON
}

interface SigmaYaml {
  title?: string;
  description?: string;
  level?: string;
  tags?: string[];
  logsource?: { category?: string; product?: string; service?: string };
  detection?: Record<string, unknown>;
  falsepositives?: string | string[];
  references?: string[];
}

function tactic_from_tag(tag: string): string | null {
  // attack.execution → execution, attack.credential_access → credential-access
  const m = tag.match(/^attack\.([a-z_-]+)$/i);
  if (!m) return null;
  const v = m[1];
  // Filter to real tactics + ignore technique tags (those start with t#)
  if (/^t\d/i.test(v)) return null;
  // Normalize underscore → hyphen
  return v.replace(/_/g, "-");
}

export function parseSigmaRow(row: CommunitySigmaRuleRow): RuleContext {
  // 1. Try a proper YAML parse first
  let parsed: SigmaYaml = {};
  try { parsed = yaml.load(row.detectionYaml) as SigmaYaml; } catch { /* fall back to tags-only */ }

  // 2. Aggregate technique IDs from tags + the stored JSON column + the description
  const tagTechniques = (parsed.tags || []).map((t) => t.match(/^attack\.(t\d{4}(?:\.\d{3})?)$/i)?.[1]).filter(Boolean) as string[];
  const techniques = [...new Set([
    ...tagTechniques.map((t) => t.toUpperCase()),
    ...safeJson<string[]>(row.mitreTechniques, []),
    ...extractTechniqueIds(row.description, parsed.description || ""),
  ])];

  // 3. Tactics: prefer YAML tags
  const tactics = [...new Set(
    (parsed.tags || []).map(tactic_from_tag).filter(Boolean) as string[],
  )];

  // 4. logsource → flatten to one or more strings
  const logSources: string[] = [];
  if (row.logsourceCategory || parsed.logsource?.category) logSources.push(`category:${parsed.logsource?.category || row.logsourceCategory}`);
  if (row.logsourceProduct || parsed.logsource?.product)  logSources.push(`product:${parsed.logsource?.product  || row.logsourceProduct}`);
  if (row.logsourceService || parsed.logsource?.service)  logSources.push(`service:${parsed.logsource?.service  || row.logsourceService}`);

  const refs = safeJson<string[]>(row.references, []);
  const fps  = safeJson<string[]>(row.falsepositives, []);

  // 5. NL summary for the LLM
  const summary = [
    `Sigma rule "${row.title}" (level=${row.level || "n/a"})`,
    `Logsource: ${logSources.join(", ") || "unspecified"}`,
    techniques.length ? `Techniques: ${techniques.join(", ")}` : "No technique tags",
    row.description ? `Intent: ${row.description.slice(0, 200)}` : "",
  ].filter(Boolean).join(". ");

  const platforms = (parsed.logsource?.product || row.logsourceProduct).toLowerCase() === "windows" ? ["windows"]
                 : (parsed.logsource?.product || row.logsourceProduct).toLowerCase() === "linux"   ? ["linux"]
                 : (parsed.logsource?.product || row.logsourceProduct).toLowerCase() === "macos"   ? ["macos"]
                 : [];

  return {
    sourceTable: "CommunitySigmaRule",
    ruleId: row.id,
    upstreamRuleId: row.sigmaId || "",
    upstreamUrl: row.repositoryUrl || (row.filePath ? `https://github.com/SigmaHQ/sigma/blob/master/${row.filePath}` : ""),
    title: row.title,
    description: row.description,
    ruleLanguage: "sigma",
    detectionLogic: truncateBody(row.detectionYaml),
    mitreTechniques: techniques,
    mitreTactics: tactics,
    logSources,
    platforms,
    products: ["sigma"],
    severity: row.level || "",
    references: refs,
    falsePositives: fps,
    summary,
  };
}
