import { prisma } from "@/lib/prisma";
import { parse as parseToml } from "smol-toml";
import crypto from "crypto";

const ELASTIC_REPO = "elastic/detection-rules";
const ELASTIC_BRANCH = "main";
const RULES_PATH = "rules";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const BATCH_SIZE = 50;

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface ElasticThreatTechnique {
  id?: string;
  name?: string;
  reference?: string;
  subtechnique?: { id?: string; name?: string; reference?: string }[];
}

interface ElasticThreat {
  framework?: string;
  technique?: ElasticThreatTechnique[];
  tactic?: { id?: string; name?: string; reference?: string };
}

interface ElasticRuleParsed {
  metadata?: {
    creation_date?: string;
    updated_date?: string;
    integration?: string[];
    maturity?: string;
  };
  rule?: {
    rule_id?: string;
    name?: string;
    description?: string;
    severity?: string;
    risk_score?: number;
    type?: string;
    language?: string;
    query?: string;
    index?: string[];
    tags?: string[];
    author?: string[];
    references?: string[];
    false_positives?: string[];
    note?: string;
    setup?: string;
    threat?: ElasticThreat[];
    license?: string;
    from?: string;
    timestamp_override?: string;
    investigation_fields?: { field_names?: string[] };
  };
}

function extractMitreTechniques(threats: ElasticThreat[] | undefined): string[] {
  if (!threats) return [];
  const techniques: string[] = [];
  for (const t of threats) {
    if (t.technique) {
      for (const tech of t.technique) {
        if (tech.id) techniques.push(tech.id);
        if (tech.subtechnique) {
          for (const sub of tech.subtechnique) {
            if (sub.id) techniques.push(sub.id);
          }
        }
      }
    }
  }
  return [...new Set(techniques)];
}

function extractMitreTactics(threats: ElasticThreat[] | undefined): string[] {
  if (!threats) return [];
  const tactics: string[] = [];
  for (const t of threats) {
    if (t.tactic?.name) tactics.push(t.tactic.name);
  }
  return [...new Set(tactics)];
}

function extractPlatform(filePath: string): string {
  const parts = filePath.split("/");
  // rules/<platform>/...
  if (parts.length >= 2) {
    const platform = parts[1];
    const knownPlatforms = [
      "windows", "linux", "macos", "cross-platform", "network",
      "integrations", "ml", "apm", "threat_intel", "promotions",
    ];
    if (knownPlatforms.includes(platform)) return platform;
    if (platform === "_deprecated") return "deprecated";
  }
  return "unknown";
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function githubFileUrl(filePath: string): string {
  return `https://github.com/${ELASTIC_REPO}/blob/${ELASTIC_BRANCH}/${filePath}`;
}

async function fetchGitHubTree(): Promise<GitHubTreeItem[]> {
  const url = `${GITHUB_API}/repos/${ELASTIC_REPO}/git/trees/${ELASTIC_BRANCH}?recursive=1`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "detection-platform",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub tree API failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data.truncated) {
    console.warn("GitHub tree was truncated — some rules may be missing");
  }
  return (data.tree as GitHubTreeItem[]).filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith(`${RULES_PATH}/`) &&
      item.path.endsWith(".toml") &&
      !item.path.includes("_deprecated/")
  );
}

async function fetchFileContent(filePath: string): Promise<string> {
  const url = `${GITHUB_RAW}/${ELASTIC_REPO}/${ELASTIC_BRANCH}/${filePath}`;
  const headers: Record<string, string> = {
    "User-Agent": "detection-platform",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  }
  return res.text();
}

async function fetchFilesBatch(paths: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const promises = paths.map(async (p) => {
    try {
      const content = await fetchFileContent(p);
      results.set(p, content);
    } catch (err) {
      console.error(`Skipping ${p}:`, err);
    }
  });
  await Promise.all(promises);
  return results;
}

function parseElasticToml(raw: string): ElasticRuleParsed | null {
  try {
    const doc = parseToml(raw) as unknown as ElasticRuleParsed;
    if (!doc || typeof doc !== "object" || !doc.rule?.name) return null;
    return doc;
  } catch {
    return null;
  }
}

export interface SyncResult {
  newCount: number;
  modifiedCount: number;
  deletedCount: number;
  totalAfterSync: number;
  errors: string[];
}

export async function ensureElasticSource(): Promise<string> {
  let source = await prisma.communitySource.findUnique({
    where: { name: "Elastic Detection Rules" },
  });
  if (!source) {
    source = await prisma.communitySource.create({
      data: {
        name: "Elastic Detection Rules",
        type: "elastic",
        description: "Elastic Security detection rules for the Elastic SIEM",
        url: `https://github.com/${ELASTIC_REPO}`,
      },
    });
  }
  return source.id;
}

export async function syncElasticRules(): Promise<SyncResult> {
  const sourceId = await ensureElasticSource();
  const syncStartedAt = new Date();

  const syncRun = await prisma.syncRun.create({
    data: { sourceId, status: "running" },
  });

  const result: SyncResult = {
    newCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    totalAfterSync: 0,
    errors: [],
  };

  try {
    // 1. Fetch the full tree of rule files
    const treeItems = await fetchGitHubTree();
    const upstreamPaths = new Set(treeItems.map((t) => t.path));

    // 2. Get existing rules in DB
    const existingRules = await prisma.communityElasticRule.findMany({
      where: { sourceId },
      select: { id: true, filePath: true, contentHash: true },
    });
    const existingByPath = new Map(existingRules.map((r) => [r.filePath, r]));

    // 3. Process in batches
    const allPaths = treeItems.map((t) => t.path);
    for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
      const batch = allPaths.slice(i, i + BATCH_SIZE);
      const contents = await fetchFilesBatch(batch);

      for (const [filePath, raw] of contents) {
        const parsed = parseElasticToml(raw);
        if (!parsed) {
          result.errors.push(`Parse failed: ${filePath}`);
          continue;
        }

        const rule = parsed.rule!;
        const meta = parsed.metadata;
        const hash = contentHash(raw);
        const existing = existingByPath.get(filePath);
        const mitreTechniques = extractMitreTechniques(rule.threat);
        const mitreTactics = extractMitreTactics(rule.threat);
        const platform = extractPlatform(filePath);

        const authorList = rule.author || [];
        const authorStr = Array.isArray(authorList) ? authorList.join(", ") : String(authorList);

        const ruleData = {
          ruleId: rule.rule_id || null,
          name: rule.name || filePath.split("/").pop()?.replace(".toml", "") || filePath,
          description: rule.description || "",
          severity: rule.severity || "",
          riskScore: rule.risk_score || 0,
          type: rule.type || "",
          language: rule.language || "",
          query: rule.query || "",
          index: JSON.stringify(rule.index || []),
          tags: JSON.stringify(rule.tags || []),
          threat: JSON.stringify(rule.threat || []),
          mitreTechniques: JSON.stringify(mitreTechniques),
          mitreTactics: JSON.stringify(mitreTactics),
          author: JSON.stringify(rule.author || []),
          references: JSON.stringify(rule.references || []),
          falsepositives: JSON.stringify(rule.false_positives || []),
          note: rule.note || "",
          setup: rule.setup || "",
          ruleContent: raw,
          filePath,
          repositoryUrl: githubFileUrl(filePath),
          platform,
          maturity: meta?.maturity || "",
          integration: JSON.stringify(meta?.integration || []),
          createdDate: meta?.creation_date || "",
          updatedDate: meta?.updated_date || "",
          contentHash: hash,
        };

        if (!existing) {
          await prisma.communityElasticRule.create({
            data: {
              ...ruleData,
              sourceId,
              changeStatus: "new",
            },
          });
          result.newCount++;
        } else if (existing.contentHash !== hash) {
          await prisma.communityElasticRule.update({
            where: { id: existing.id },
            data: {
              ...ruleData,
              changeStatus: "modified",
            },
          });
          result.modifiedCount++;
        } else {
          await prisma.communityElasticRule.update({
            where: { id: existing.id },
            data: { changeStatus: "unchanged" },
          });
        }

        existingByPath.delete(filePath);
      }
    }

    // 4. Mark deleted
    for (const [filePath, rule] of existingByPath) {
      if (!upstreamPaths.has(filePath)) {
        await prisma.communityElasticRule.update({
          where: { id: rule.id },
          data: { changeStatus: "deleted" },
        });
        result.deletedCount++;
      }
    }

    // 5. Update source stats
    const totalRules = await prisma.communityElasticRule.count({
      where: { sourceId, changeStatus: { not: "deleted" } },
    });
    const importedRules = await prisma.communityElasticRule.count({
      where: { sourceId, importStatus: { not: "not_imported" } },
    });

    await prisma.communitySource.update({
      where: { id: sourceId },
      data: {
        lastSyncAt: new Date(),
        totalRules,
        importedRulesCount: importedRules,
      },
    });

    result.totalAfterSync = totalRules;

    // 6. Complete sync run
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "completed",
        newCount: result.newCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        totalAfterSync: result.totalAfterSync,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        errorMessage: msg,
        completedAt: new Date(),
      },
    });
    throw err;
  }

  // Phase 3 — enqueue Detection Pack jobs for Elastic rules inserted this sync
  const { enqueueAfterSyncSafe } = await import("@/lib/detection-packs/enqueue");
  await enqueueAfterSyncSafe("elastic", syncStartedAt);

  return result;
}
