/**
 * Google SecOps / Chronicle Adapter
 *
 * Source: https://github.com/chronicle/detection-rules
 * Format: YARA-L 2.0 — one rule per .yaral file under rules/community/<provider>/<service>/
 *
 * YARA-L files are NOT YAML — they're a custom DSL with sections:
 *   rule <name> {
 *     meta: { author, description, rule_id, mitre_attack_*, severity, ... }
 *     events: { ... pattern matching ... }
 *     outcome: { ... result variables ... }
 *     condition: { ... }
 *   }
 *
 * We parse the meta block via regex (no full grammar) since that's all the
 * UI catalog needs. The full rule body is preserved in detectionLogicRaw.
 */

import type { ICommunitySourceAdapter, NormalizedRule, SyncResult } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  processBatched, extractTechniques, extractTactics,
} from "./_common";

const REPO_OWNER = "chronicle";
const REPO_NAME = "detection-rules";
const BRANCH = "main";
const SOURCE_NAME = "Google SecOps Chronicle";
const SOURCE_TYPE = "google-secops";

/**
 * Parse the `meta:` block of a YARA-L rule via regex.
 * Each entry looks like:    key = "value"
 */
function parseYaralMeta(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Find the meta block boundaries
  const metaMatch = raw.match(/meta:\s*([\s\S]*?)(?:events:|condition:)/);
  if (!metaMatch) return out;
  const block = metaMatch[1];
  // Match key = "value" pairs (handles escaped quotes)
  const kvRegex = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = kvRegex.exec(block)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

/** Get the rule name from `rule <name> {` */
function parseYaralRuleName(raw: string): string | null {
  const m = raw.match(/^\s*rule\s+(\w+)\s*\{/m);
  return m ? m[1] : null;
}

function parseYaralFile(filePath: string, raw: string): NormalizedRule | null {
  const name = parseYaralRuleName(raw);
  if (!name) return null;

  const meta = parseYaralMeta(raw);
  const platform = (meta.platform || meta.data_source || "").toLowerCase();

  // Path-based platform inference: rules/community/aws/cloudtrail/...
  const segments = filePath.split("/");
  const inferredPlatform = segments[2] || ""; // aws, gcp, microsoft, okta, etc.

  // Extract MITRE from meta fields
  const techFromMeta = meta.mitre_attack_technique_id ?? "";
  const techMatches = extractTechniques(techFromMeta, meta.mitre_attack_url ?? "");

  return {
    upstreamRuleId: meta.rule_id || name,
    title: meta.rule_name || name,
    description: meta.description || "",
    author: meta.author || "Google Cloud Security",
    upstreamCreatedAt: null,
    upstreamModifiedAt: null,
    mitreTechniques: techMatches,
    mitreTactics: extractTactics(meta.mitre_attack_tactic ?? ""),
    platforms: [platform || inferredPlatform || "cloud"].filter(Boolean),
    products: [meta.data_source || ""].filter(Boolean),
    logSources: [meta.data_source || ""].filter(Boolean),
    tags: [meta.type || "", meta.priority || ""].filter(Boolean),
    ruleLanguage: "yara-l",
    ruleType: meta.type?.toLowerCase().includes("hunt") ? "hunting" : "detection",
    detectionLogicRaw: raw,
    conversionSupported: false,
    severity: (meta.severity || "").toLowerCase(),
    status: "production",
    references: [
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${filePath}`,
      ...(meta.mitre_attack_url ? [meta.mitre_attack_url] : []),
    ],
    falsePositives: [],
    sourceFilePath: filePath,
    sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
    rawPayload: { name, meta },
  };
}

export const googleSecopsAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "google-secops",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "cloud-siem",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: "Google SecOps / Chronicle YARA-L detection rules.",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Google SecOps Chronicle YARA-L community detection rules.",
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

    const paths = tree
      .filter((n) => n.type === "blob"
        && n.path.startsWith("rules/")
        && !n.path.startsWith("rules/_deprecated/")
        && n.path.endsWith(".yaral"))
      .map((n) => n.path);

    const results = await processBatched(paths, async (p) => {
      const raw = await fetchRawFile(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${p}`);
      return { p, raw };
    }, 25);

    for (const r of results) {
      if (r.status === "rejected") { errors.push({ message: String(r.reason) }); continue; }
      const { p, raw } = r.value;
      seenPaths.add(p);
      const norm = parseYaralFile(p, raw);
      if (!norm) { errors.push({ file: p, message: "yaral parse failed" }); continue; }
      const status = await upsertNormalizedRule(sourceId, norm, hashContent(raw));
      if (status === "new") newCount++;
      else if (status === "modified") modifiedCount++;
    }

    const deletedCount = await markDeletedRules(sourceId, seenPaths);
    return await finalizeSync(sourceId, newCount, modifiedCount, deletedCount, errors);
  },
};
