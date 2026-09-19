/**
 * Microsoft Defender XDR Advanced Hunting Adapter
 *
 * Source: https://github.com/Azure/Azure-Sentinel/tree/master/Hunting%20Queries
 *
 * Microsoft maintains the canonical advanced hunting query samples in the same
 * Azure-Sentinel repository under "Hunting Queries". These KQL queries are
 * directly usable in Microsoft Defender XDR's advanced hunting console and can
 * be promoted into custom detection rules.
 *
 * This adapter is intentionally a thin filter on the Sentinel adapter's source
 * data — it scopes to the Hunting Queries directory only, applies a "defender"
 * label, and treats every entry as a hunting/reference rule.
 */

import * as yaml from "js-yaml";
import type { ICommunitySourceAdapter, NormalizedRule, SyncResult } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  processBatched, extractTechniques,
} from "./_common";

const REPO_OWNER = "Azure";
const REPO_NAME = "Azure-Sentinel";
const BRANCH = "master";
const SOURCE_NAME = "Microsoft Defender XDR (Hunting)";
const SOURCE_TYPE = "defender-xdr";

interface HuntingYaml {
  id?: string;
  name?: string;
  description?: string;
  requiredDataConnectors?: Array<{ connectorId?: string; dataTypes?: string[] }>;
  query?: string;
  tactics?: string[];
  relevantTechniques?: string[];
  tags?: any[];
  metadata?: { author?: { name?: string } };
}

function parseHuntingYaml(filePath: string, raw: string): NormalizedRule | null {
  let parsed: HuntingYaml;
  try { parsed = yaml.load(raw) as HuntingYaml; }
  catch { return null; }
  if (!parsed || !parsed.name) return null;

  const dataConnectors = (parsed.requiredDataConnectors ?? [])
    .map((c) => c.connectorId)
    .filter((s): s is string => !!s);

  return {
    upstreamRuleId: parsed.id ?? null,
    title: parsed.name,
    description: (parsed.description ?? "").trim(),
    author: parsed.metadata?.author?.name ?? "Microsoft",
    upstreamCreatedAt: null,
    upstreamModifiedAt: null,
    mitreTechniques: parsed.relevantTechniques ?? extractTechniques(parsed.description ?? ""),
    mitreTactics: parsed.tactics ?? [],
    platforms: ["m365", "defender", "azure"],
    products: dataConnectors,
    logSources: dataConnectors,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: any) => typeof t === "string" ? t : JSON.stringify(t)).slice(0, 20)
      : [],
    ruleLanguage: "kql",
    ruleType: "hunting",
    detectionLogicRaw: parsed.query ?? "",
    conversionSupported: false,
    severity: "",
    status: "production",
    references: [
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${filePath}`,
      "https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-overview",
    ],
    falsePositives: [],
    sourceFilePath: filePath,
    sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${encodeURI(filePath)}`,
    rawPayload: parsed as unknown as Record<string, unknown>,
  };
}

export const defenderXdrAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "defender-xdr",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "edr-hunting",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/Hunting%20Queries`,
    description: "KQL hunting query samples for Microsoft Defender XDR advanced hunting (promotable to custom detection rules).",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Defender XDR advanced hunting query samples (KQL).",
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/Hunting%20Queries`,
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
        && n.path.startsWith("Hunting Queries/")
        && (n.path.endsWith(".yaml") || n.path.endsWith(".yml")))
      .map((n) => n.path);

    const results = await processBatched(paths, async (p) => {
      const raw = await fetchRawFile(`https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${encodeURI(p)}`);
      return { p, raw };
    }, 25);

    for (const r of results) {
      if (r.status === "rejected") { errors.push({ message: String(r.reason) }); continue; }
      const { p, raw } = r.value;
      seenPaths.add(p);
      const norm = parseHuntingYaml(p, raw);
      if (!norm) { errors.push({ file: p, message: "yaml parse failed" }); continue; }
      const status = await upsertNormalizedRule(sourceId, norm, hashContent(raw));
      if (status === "new") newCount++;
      else if (status === "modified") modifiedCount++;
    }

    const deletedCount = await markDeletedRules(sourceId, seenPaths);
    return await finalizeSync(sourceId, newCount, modifiedCount, deletedCount, errors);
  },
};
