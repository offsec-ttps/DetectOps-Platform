/**
 * Falco Adapter
 *
 * Source: https://github.com/falcosecurity/rules
 * Format: rules/falco_rules.yaml — ONE big YAML stream containing many documents:
 *   - macro: ...    (re-usable conditions)
 *   - list: ...     (re-usable lists)
 *   - rule: ...     (the actual detection rules — what we want)
 *
 * Each rule has:
 *   rule, desc, condition, output, priority, tags[], source
 *
 * Files: falco_rules.yaml, falco-incubating_rules.yaml, falco-sandbox_rules.yaml
 */

import * as yaml from "js-yaml";
import type { ICommunitySourceAdapter, NormalizedRule, SyncResult } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  extractTechniques, extractTactics,
} from "./_common";

const REPO_OWNER = "falcosecurity";
const REPO_NAME = "rules";
const BRANCH = "main";
const SOURCE_NAME = "Falco";
const SOURCE_TYPE = "falco";

interface FalcoRuleDoc {
  rule?: string;
  desc?: string;
  condition?: string;
  output?: string;
  priority?: string;
  tags?: string[];
  source?: string;
  enabled?: boolean;
}

function parseFalcoRules(filePath: string, raw: string): NormalizedRule[] {
  const docs = yaml.loadAll(raw) as unknown[];
  // The YAML file is a single document containing a list of mixed entries
  // (macros, lists, rules), not multiple documents — handle both cases.
  const entries: FalcoRuleDoc[] = [];
  for (const doc of docs) {
    if (Array.isArray(doc)) {
      for (const entry of doc as FalcoRuleDoc[]) {
        if (entry && typeof entry === "object" && entry.rule) entries.push(entry);
      }
    } else if (doc && typeof doc === "object" && (doc as FalcoRuleDoc).rule) {
      entries.push(doc as FalcoRuleDoc);
    }
  }

  const fileBase = filePath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? filePath;

  return entries.map((e, idx) => {
    const tags = e.tags ?? [];
    const techniques = extractTechniques(...tags, e.desc ?? "");
    const tactics = extractTactics(...tags);

    return {
      upstreamRuleId: e.rule!,
      title: e.rule!,
      description: (e.desc ?? "").trim(),
      author: "Falco maintainers",
      upstreamCreatedAt: null,
      upstreamModifiedAt: null,
      mitreTechniques: techniques,
      mitreTactics: tactics,
      platforms: ["linux", "container"],
      products: e.source ? [e.source] : ["syscall"],
      logSources: e.source ? [e.source] : [],
      tags,
      ruleLanguage: "falco-yaml",
      ruleType: "behavior",
      detectionLogicRaw: [
        `# rule: ${e.rule}`,
        `# desc: ${e.desc ?? ""}`,
        `condition: ${e.condition ?? ""}`,
        `output:    ${e.output ?? ""}`,
        `priority:  ${e.priority ?? ""}`,
      ].join("\n"),
      conversionSupported: false,
      severity: (e.priority ?? "").toLowerCase(),
      status: e.enabled === false ? "deprecated" : "production",
      references: [`https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${filePath}`],
      falsePositives: [],
      // Compose a stable per-rule path so deduplication works (multiple rules per file)
      sourceFilePath: `${filePath}#${fileBase}-${idx}`,
      sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
      rawPayload: e as unknown as Record<string, unknown>,
    } as NormalizedRule;
  });
}

export const falcoAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "falco",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "runtime-security",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: "Falco runtime security rules for Linux hosts and containers (syscall + Kubernetes audit).",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Falco syscall + Kubernetes audit rules.",
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

    const rulesFiles = tree
      .filter((n) => n.type === "blob"
        && n.path.startsWith("rules/")
        && (n.path.endsWith(".yaml") || n.path.endsWith(".yml")))
      .map((n) => n.path);

    for (const filePath of rulesFiles) {
      try {
        const raw = await fetchRawFile(
          `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
        );
        const rules = parseFalcoRules(filePath, raw);
        for (const norm of rules) {
          seenPaths.add(norm.sourceFilePath);
          const status = await upsertNormalizedRule(
            sourceId, norm,
            hashContent(JSON.stringify(norm.rawPayload)),
          );
          if (status === "new") newCount++;
          else if (status === "modified") modifiedCount++;
        }
      } catch (e: any) {
        errors.push({ file: filePath, message: e.message });
      }
    }

    const deletedCount = await markDeletedRules(sourceId, seenPaths);
    return await finalizeSync(sourceId, newCount, modifiedCount, deletedCount, errors);
  },
};
