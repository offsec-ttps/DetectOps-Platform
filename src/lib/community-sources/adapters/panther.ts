/**
 * Panther Adapter
 *
 * Source: https://github.com/panther-labs/panther-analysis
 * Format: rules/<vendor>/<rule_name>.yml + sibling .py with detection logic.
 *
 * Panther YAML schema (verified against rules/atlassian_rules/user_logged_in_as_user.yml):
 *   AnalysisType: rule | policy | scheduled | correlation_rule
 *   DisplayName, Enabled, Filename, RuleID, Severity, Description, Runbook
 *   LogTypes: [...]
 *   Tags: [...]
 *   Reference, Reports (mitre attack mappings nested)
 *   Tests: [...]
 *
 * The .py sibling holds the detect() function — we capture it in detectionLogicRaw
 * so analysts can read the actual logic in the catalog.
 */

import * as yaml from "js-yaml";
import type { ICommunitySourceAdapter, NormalizedRule, SyncResult, RuleType } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  processBatched, extractTechniques,
} from "./_common";

const REPO_OWNER = "panther-labs";
const REPO_NAME = "panther-analysis";
const BRANCH = "develop";
const SOURCE_NAME = "Panther Analysis";
const SOURCE_TYPE = "panther";

interface PantherYaml {
  AnalysisType?: string;
  DisplayName?: string;
  Description?: string;
  Filename?: string;
  RuleID?: string;
  PolicyID?: string;
  Severity?: string;
  Enabled?: boolean;
  LogTypes?: string[];
  Tags?: string[];
  Reference?: string;
  Runbook?: string;
  Reports?: { MITRE?: any; "MITRE ATT&CK"?: any };
}

function parsePantherYaml(filePath: string, raw: string): NormalizedRule | null {
  let parsed: PantherYaml;
  try { parsed = yaml.load(raw) as PantherYaml; }
  catch { return null; }
  if (!parsed || (!parsed.RuleID && !parsed.PolicyID && !parsed.DisplayName)) return null;

  const analysisType = (parsed.AnalysisType || "rule").toLowerCase();
  const ruleType: RuleType =
    analysisType === "policy" ? "policy" :
    analysisType === "correlation_rule" ? "correlation" :
    analysisType === "scheduled_rule" ? "scheduled" :
    "detection";

  // MITRE mappings can come from Reports.MITRE or Reports["MITRE ATT&CK"]
  const reportsMitre = parsed.Reports?.["MITRE ATT&CK"] ?? parsed.Reports?.MITRE ?? null;
  const techniques: string[] = [];
  const tactics: string[] = [];
  if (reportsMitre && typeof reportsMitre === "object") {
    // Reports MITRE shape: { TA0001: ['T1078'], TA0003: ['T1136.003'] }
    for (const [k, v] of Object.entries(reportsMitre)) {
      if (k.startsWith("TA")) tactics.push(k);
      if (Array.isArray(v)) for (const t of v as string[]) {
        if (typeof t === "string") techniques.push(t.split(":")[0].trim());
      }
    }
  }

  return {
    upstreamRuleId: parsed.RuleID ?? parsed.PolicyID ?? null,
    title: parsed.DisplayName ?? parsed.RuleID ?? parsed.PolicyID ?? filePath,
    description: (parsed.Description ?? "").trim(),
    author: "Panther Labs",
    upstreamCreatedAt: null,
    upstreamModifiedAt: null,
    mitreTechniques: techniques.length > 0 ? techniques : extractTechniques(parsed.Description ?? ""),
    mitreTactics: tactics,
    platforms: ["cloud", "saas"],
    products: parsed.LogTypes ?? [],
    logSources: parsed.LogTypes ?? [],
    tags: parsed.Tags ?? [],
    ruleLanguage: "python",
    ruleType,
    detectionLogicRaw: "", // Filled in by sibling .py fetch (see syncRule below)
    conversionSupported: false,
    severity: (parsed.Severity ?? "").toLowerCase(),
    status: parsed.Enabled === false ? "deprecated" : "production",
    references: parsed.Reference ? [parsed.Reference] : [],
    falsePositives: [],
    sourceFilePath: filePath,
    sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
    rawPayload: parsed as unknown as Record<string, unknown>,
  };
}

export const pantherAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "panther",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "cloud-siem",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: "Panther's detection-as-code rules and policies (Python + YAML).",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Panther Analysis: rules, policies, correlations.",
      `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    );

    const errors: { file?: string; message: string }[] = [];
    let newCount = 0, modifiedCount = 0;
    const seenPaths = new Set<string>();

    let tree;
    try { tree = await fetchRepoTree(REPO_OWNER, REPO_NAME, BRANCH); }
    catch (e: any) {
      return { newCount, modifiedCount, deletedCount: 0, totalAfterSync: 0,
        errors: [{ message: `tree fetch: ${e.message}` }] };
    }

    // YAML rule manifests under rules/, policies/, correlation_rules/
    const ymlPaths = tree
      .filter((n) => n.type === "blob"
        && (n.path.startsWith("rules/") || n.path.startsWith("policies/") || n.path.startsWith("correlation_rules/"))
        && (n.path.endsWith(".yml") || n.path.endsWith(".yaml")))
      .map((n) => n.path);

    // Build a quick set of .py paths so we can skip fetching siblings that don't exist
    const pyPaths = new Set(
      tree.filter((n) => n.type === "blob" && n.path.endsWith(".py")).map((n) => n.path),
    );

    const results = await processBatched(ymlPaths, async (p) => {
      const raw = await fetchRawFile(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${p}`);
      // Try to fetch the sibling .py based on Filename in the YAML or convention
      let py = "";
      const siblingPyPath = p.replace(/\.ya?ml$/, ".py");
      if (pyPaths.has(siblingPyPath)) {
        try {
          py = await fetchRawFile(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${siblingPyPath}`);
        } catch { /* missing or unreadable, skip */ }
      }
      return { p, raw, py };
    }, 20);

    for (const r of results) {
      if (r.status === "rejected") { errors.push({ message: String(r.reason) }); continue; }
      const { p, raw, py } = r.value;
      seenPaths.add(p);
      const norm = parsePantherYaml(p, raw);
      if (!norm) { errors.push({ file: p, message: "yaml parse failed" }); continue; }
      // Attach the python detection body
      norm.detectionLogicRaw = py || "";
      const status = await upsertNormalizedRule(sourceId, norm, hashContent(raw + py));
      if (status === "new") newCount++;
      else if (status === "modified") modifiedCount++;
    }

    const deletedCount = await markDeletedRules(sourceId, seenPaths);
    return await finalizeSync(sourceId, newCount, modifiedCount, deletedCount, errors);
  },
};
