/**
 * Microsoft Sentinel Adapter
 *
 * Source: https://github.com/Azure/Azure-Sentinel
 *   - Detections/<DataSource>/*.yaml         — scheduled analytic rules
 *   - Hunting Queries/<DataSource>/*.yaml    — exploratory hunting queries
 *
 * Both folders share a similar YAML schema:
 *   id, name, description, severity, requiredDataConnectors[],
 *   query, queryFrequency, queryPeriod, triggerOperator, triggerThreshold,
 *   tactics[], relevantTechniques[], tags[], entityMappings[],
 *   version, kind (Scheduled / NRT / Hunting), metadata.author{}
 *
 * Hunting queries use the same shape with `kind: Hunting` and no triggers.
 * We surface both as KQL detections in the unified catalog.
 */

import * as yaml from "js-yaml";
import type { ICommunitySourceAdapter, NormalizedRule, SyncResult } from "../types";
import {
  fetchRepoTree, fetchRawFile, hashContent,
  upsertNormalizedRule, markDeletedRules, ensureCommunitySource, finalizeSync,
  processBatched, extractTechniques, extractTactics,
} from "./_common";

const REPO_OWNER = "Azure";
const REPO_NAME = "Azure-Sentinel";
const BRANCH = "master";
const SOURCE_NAME = "Microsoft Sentinel";
const SOURCE_TYPE = "sentinel";

interface SentinelYaml {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  severity?: string;
  query?: string;
  queryFrequency?: string;
  queryPeriod?: string;
  triggerOperator?: string;
  triggerThreshold?: number;
  tactics?: string[];
  relevantTechniques?: string[];
  tags?: any[];
  kind?: string;
  version?: string;
  requiredDataConnectors?: Array<{ connectorId?: string; dataTypes?: string[] }>;
  metadata?: { author?: { name?: string }; source?: { kind?: string }; categories?: any };
}

function parseSentinelYaml(filePath: string, raw: string): NormalizedRule | null {
  let parsed: SentinelYaml;
  try { parsed = yaml.load(raw) as SentinelYaml; }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.name && !parsed.displayName) return null;

  const isHunting = filePath.startsWith("Hunting Queries/") || (parsed.kind ?? "").toLowerCase() === "hunting";
  const dataConnectors = (parsed.requiredDataConnectors ?? [])
    .map((c) => c.connectorId)
    .filter((s): s is string => !!s);

  return {
    upstreamRuleId: parsed.id ?? null,
    title: parsed.name ?? parsed.displayName ?? filePath,
    description: (parsed.description ?? "").trim(),
    author: parsed.metadata?.author?.name ?? "",
    upstreamCreatedAt: null,
    upstreamModifiedAt: null,
    mitreTechniques: parsed.relevantTechniques ?? extractTechniques(parsed.description ?? ""),
    mitreTactics: parsed.tactics ?? [],
    platforms: ["azure", "m365", "cloud"],
    products: dataConnectors,
    logSources: dataConnectors,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t: any) => typeof t === "string" ? t : JSON.stringify(t)).slice(0, 20)
      : [],
    ruleLanguage: "kql",
    ruleType: isHunting ? "hunting" : "detection",
    detectionLogicRaw: parsed.query ?? "",
    conversionSupported: false,
    severity: (parsed.severity ?? "").toLowerCase(),
    status: "production",
    references: [`https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${filePath}`],
    falsePositives: [],
    sourceFilePath: filePath,
    sourceUrl: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`,
    rawPayload: parsed as unknown as Record<string, unknown>,
  };
}

export const sentinelAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "sentinel",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "cloud-siem",
    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: "Microsoft Sentinel detections and hunting queries (KQL).",
    sigmaConvertible: false,
    nativeUI: true,
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const sourceId = await ensureCommunitySource(
      SOURCE_NAME, SOURCE_TYPE,
      "Microsoft Sentinel detections and hunting queries (KQL).",
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
        && (n.path.startsWith("Detections/") || n.path.startsWith("Hunting Queries/"))
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
      const norm = parseSentinelYaml(p, raw);
      if (!norm) { errors.push({ file: p, message: "yaml parse failed" }); continue; }
      const status = await upsertNormalizedRule(sourceId, norm, hashContent(raw));
      if (status === "new") newCount++;
      else if (status === "modified") modifiedCount++;
    }

    const deletedCount = await markDeletedRules(sourceId, seenPaths);
    return await finalizeSync(sourceId, newCount, modifiedCount, deletedCount, errors);
  },
};
