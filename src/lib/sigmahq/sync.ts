import { prisma } from "@/lib/prisma";
import yaml from "js-yaml";
import crypto from "crypto";

const SIGMAHQ_REPO = "SigmaHQ/sigma";
const SIGMAHQ_BRANCH = "master";
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

interface SigmaRuleParsed {
  title?: string;
  id?: string;
  status?: string;
  description?: string;
  level?: string;
  tags?: string[];
  logsource?: {
    category?: string;
    product?: string;
    service?: string;
  };
  detection?: unknown;
  falsepositives?: string[];
  references?: string[];
  author?: string;
  date?: string;
  modified?: string;
}

function extractMitreTechniques(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return tags
    .filter((t) => /^attack\.t\d{4}/i.test(t))
    .map((t) => {
      const match = t.match(/^attack\.(t\d{4}(?:\.\d{3})?)/i);
      return match ? match[1].toUpperCase() : null;
    })
    .filter((t): t is string => t !== null);
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function githubFileUrl(filePath: string): string {
  return `https://github.com/${SIGMAHQ_REPO}/blob/${SIGMAHQ_BRANCH}/${filePath}`;
}

async function fetchGitHubTree(): Promise<GitHubTreeItem[]> {
  const url = `${GITHUB_API}/repos/${SIGMAHQ_REPO}/git/trees/${SIGMAHQ_BRANCH}?recursive=1`;
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
      (item.path.endsWith(".yml") || item.path.endsWith(".yaml"))
  );
}

async function fetchFileContent(filePath: string): Promise<string> {
  const url = `${GITHUB_RAW}/${SIGMAHQ_REPO}/${SIGMAHQ_BRANCH}/${filePath}`;
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

function parseSigmaYaml(raw: string): SigmaRuleParsed | null {
  try {
    const doc = yaml.load(raw) as SigmaRuleParsed;
    if (!doc || typeof doc !== "object" || !doc.title) return null;
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

export async function ensureSigmaHQSource(): Promise<string> {
  let source = await prisma.communitySource.findUnique({
    where: { name: "SigmaHQ" },
  });
  if (!source) {
    source = await prisma.communitySource.create({
      data: {
        name: "SigmaHQ",
        type: "sigma",
        description: "SigmaHQ open-source Sigma detection rules",
        url: `https://github.com/${SIGMAHQ_REPO}`,
      },
    });
  }
  return source.id;
}

export async function syncSigmaHQ(): Promise<SyncResult> {
  const sourceId = await ensureSigmaHQSource();
  const syncStartedAt = new Date();

  // Create sync run record
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
    // 1. Fetch the full tree of rule files from GitHub
    const treeItems = await fetchGitHubTree();
    const upstreamPaths = new Set(treeItems.map((t) => t.path));

    // 2. Get all existing rules in DB for this source
    const existingRules = await prisma.communitySigmaRule.findMany({
      where: { sourceId },
      select: { id: true, filePath: true, contentHash: true },
    });
    const existingByPath = new Map(existingRules.map((r) => [r.filePath, r]));

    // 3. Process upstream files in batches
    const allPaths = treeItems.map((t) => t.path);
    for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
      const batch = allPaths.slice(i, i + BATCH_SIZE);
      const contents = await fetchFilesBatch(batch);

      for (const [filePath, raw] of contents) {
        const parsed = parseSigmaYaml(raw);
        if (!parsed) {
          result.errors.push(`Parse failed: ${filePath}`);
          continue;
        }

        const hash = contentHash(raw);
        const existing = existingByPath.get(filePath);
        const mitreTechniques = extractMitreTechniques(parsed.tags);

        const ruleData = {
          sigmaId: parsed.id || null,
          title: parsed.title || filePath.split("/").pop() || filePath,
          description: parsed.description || "",
          status: parsed.status || "",
          level: parsed.level || "",
          tags: JSON.stringify(parsed.tags || []),
          logsourceCategory: parsed.logsource?.category || "",
          logsourceProduct: parsed.logsource?.product || "",
          logsourceService: parsed.logsource?.service || "",
          detectionYaml: raw,
          filePath,
          repositoryUrl: githubFileUrl(filePath),
          author: parsed.author || "",
          date: parsed.date ? String(parsed.date) : "",
          modified: parsed.modified ? String(parsed.modified) : "",
          falsepositives: JSON.stringify(parsed.falsepositives || []),
          references: JSON.stringify(parsed.references || []),
          mitreTechniques: JSON.stringify(mitreTechniques),
          contentHash: hash,
          upstreamLastModifiedAt: parsed.modified
            ? new Date(String(parsed.modified))
            : parsed.date
              ? new Date(String(parsed.date))
              : null,
        };

        if (!existing) {
          // New rule
          await prisma.communitySigmaRule.create({
            data: {
              ...ruleData,
              sourceId,
              changeStatus: "new",
            },
          });
          result.newCount++;
        } else if (existing.contentHash !== hash) {
          // Modified rule
          await prisma.communitySigmaRule.update({
            where: { id: existing.id },
            data: {
              ...ruleData,
              changeStatus: "modified",
            },
          });
          result.modifiedCount++;
        } else {
          // Unchanged — reset change_status if it was previously new/modified
          await prisma.communitySigmaRule.update({
            where: { id: existing.id },
            data: { changeStatus: "unchanged" },
          });
        }

        existingByPath.delete(filePath);
      }
    }

    // 4. Mark rules no longer upstream as deleted
    for (const [filePath, rule] of existingByPath) {
      if (!upstreamPaths.has(filePath)) {
        await prisma.communitySigmaRule.update({
          where: { id: rule.id },
          data: { changeStatus: "deleted" },
        });
        result.deletedCount++;
      }
    }

    // 5. Update source stats
    const totalRules = await prisma.communitySigmaRule.count({
      where: { sourceId, changeStatus: { not: "deleted" } },
    });
    const importedRules = await prisma.communitySigmaRule.count({
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

  // Phase 3 — enqueue Detection Pack jobs for every Sigma rule inserted
  // during this sync. Idempotent via the unique [sourceTable, sourceRefId]
  // key, so re-syncs don't re-enqueue.
  const { enqueueAfterSyncSafe } = await import("@/lib/detection-packs/enqueue");
  await enqueueAfterSyncSafe("sigmahq", syncStartedAt);

  return result;
}
