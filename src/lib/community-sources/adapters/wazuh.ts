/**
 * Wazuh Adapter
 *
 * Source: https://github.com/wazuh/wazuh (ruleset/rules/*.xml)
 *
 * Wazuh rules are XML documents grouped under <group name="..."> tags.
 * Each rule looks like:
 *   <rule id="100001" level="10">
 *     <if_sid>5500</if_sid>
 *     <match>Failed password</match>
 *     <description>Failed login attempt</description>
 *     <mitre><id>T1110</id></mitre>
 *     <group>authentication_failed,</group>
 *   </rule>
 *
 * We parse via lightweight regex (not a full XML parser) which is fine because
 * we only need a few fields for the catalog. The full rule XML is preserved in
 * detectionLogicRaw.
 */

import type { ICommunitySourceAdapter, NormalizedRule, SyncResult } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  extractTechniques, extractTactics,
} from "./_common";

const REPO_OWNER = "wazuh";
const REPO_NAME = "wazuh-ruleset";
const BRANCH = "master";
const SOURCE_NAME = "Wazuh Ruleset";
const SOURCE_TYPE = "wazuh";

interface ParsedWazuhRule {
  id: string;
  level: string;
  description: string;
  mitre: string[];
  groups: string[];
  fullXml: string;
}

function parseWazuhRules(filePath: string, raw: string): ParsedWazuhRule[] {
  const rules: ParsedWazuhRule[] = [];
  // Match each <rule ...> ... </rule> block (non-greedy)
  const ruleRegex = /<rule\s+id="(\d+)"[^>]*level="(\d+)"[^>]*>([\s\S]*?)<\/rule>/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(raw)) !== null) {
    const [fullXml, id, level, body] = m;
    const descMatch = body.match(/<description>([\s\S]*?)<\/description>/);
    const mitreIdsRaw = body.match(/<id>([^<]+)<\/id>/g) ?? [];
    const mitre = mitreIdsRaw.map((s) => s.replace(/<\/?id>/g, "").trim());
    const groupsMatch = body.match(/<group>([\s\S]*?)<\/group>/);
    const groups = groupsMatch
      ? groupsMatch[1].split(",").map((g) => g.trim()).filter(Boolean)
      : [];
    rules.push({
      id,
      level,
      description: descMatch ? descMatch[1].trim() : "",
      mitre,
      groups,
      fullXml,
    });
  }
  return rules;
}

function levelToSeverity(level: string): string {
  const n = parseInt(level, 10);
  if (n >= 12) return "critical";
  if (n >= 8) return "high";
  if (n >= 5) return "medium";
  if (n >= 3) return "low";
  return "info";
}

function inferPlatform(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  if (lower.includes("windows") || lower.includes("win-")) return ["windows"];
  if (lower.includes("linux") || lower.includes("syslog")) return ["linux"];
  if (lower.includes("aws") || lower.includes("amazon")) return ["aws"];
  if (lower.includes("azure")) return ["azure"];
  if (lower.includes("gcp") || lower.includes("google")) return ["gcp"];
  if (lower.includes("o365") || lower.includes("office365")) return ["m365"];
  if (lower.includes("docker") || lower.includes("kubernetes")) return ["container"];
  if (lower.includes("cisco") || lower.includes("checkpoint")) return ["network"];
  return ["multi"];
}

export const wazuhAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "wazuh",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "host-ids",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/rules`,
    description: "Wazuh HIDS XML rules — host log correlation, file integrity, vulnerability detection.",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Wazuh HIDS XML ruleset.",
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/rules`,
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

    const xmlFiles = tree
      .filter((n) => n.type === "blob"
        && n.path.startsWith("rules/")
        && n.path.endsWith(".xml"))
      .map((n) => n.path);

    for (const filePath of xmlFiles) {
      try {
        const raw = await fetchRawFile(
          `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
        );
        const parsedRules = parseWazuhRules(filePath, raw);
        for (const r of parsedRules) {
          const platforms = inferPlatform(filePath);
          const norm: NormalizedRule = {
            upstreamRuleId: r.id,
            title: r.description || `Wazuh rule ${r.id}`,
            description: r.description,
            author: "Wazuh maintainers",
            upstreamCreatedAt: null,
            upstreamModifiedAt: null,
            mitreTechniques: r.mitre.length > 0 ? r.mitre : extractTechniques(r.description),
            mitreTactics: extractTactics(...r.mitre, r.description),
            platforms,
            products: [filePath.split("/").pop()?.replace(".xml", "") || "wazuh"],
            logSources: r.groups,
            tags: r.groups,
            ruleLanguage: "wazuh-xml",
            ruleType: "detection",
            detectionLogicRaw: r.fullXml,
            conversionSupported: false,
            severity: levelToSeverity(r.level),
            status: "production",
            references: [`https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${filePath}`],
            falsePositives: [],
            // One row per rule id (file path + id, since multiple rules per file)
            sourceFilePath: `${filePath}#${r.id}`,
            sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
            rawPayload: r as unknown as Record<string, unknown>,
          };
          seenPaths.add(norm.sourceFilePath);
          const status = await upsertNormalizedRule(sourceId, norm, hashContent(r.fullXml));
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
