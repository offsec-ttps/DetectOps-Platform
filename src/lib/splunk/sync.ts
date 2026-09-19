import { prisma } from "@/lib/prisma";
import yaml from "js-yaml";
import crypto from "crypto";

const SPLUNK_REPO = "splunk/security_content";
const SPLUNK_BRANCH = "develop";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const CONCURRENCY = 25;

// ── Types ──

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface SplunkDetectionYaml {
  id?: string;
  name?: string;
  description?: string;
  author?: string;
  date?: string;
  status?: string;
  type?: string;
  search?: string;
  data_source?: string[];
  how_to_implement?: string;
  known_false_positives?: string;
  references?: string[];
  tags?: {
    mitre_attack_id?: string[];
    analytic_story?: string[];
    security_domain?: string;
    asset_type?: string;
    product?: string[];
  };
  version?: number;
}

export interface SplunkSyncResult {
  newCount: number;
  updatedCount: number;
  removedCount: number;
  totalDetections: number;
  commitSha: string;
  errors: string[];
}

// ── Helpers ──

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "detection-platform",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

function hash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

// ── GitHub Fetchers ──

async function fetchGitHubTree(): Promise<{
  items: GitHubTreeItem[];
  sha: string;
}> {
  const url = `${GITHUB_API}/repos/${SPLUNK_REPO}/git/trees/${SPLUNK_BRANCH}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub tree API: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.truncated) {
    console.warn("GitHub tree truncated — some detections may be missing");
  }
  // Filter for detection YAML files under detections/ (exclude deprecated)
  const items = (data.tree as GitHubTreeItem[]).filter(
    (item) =>
      item.type === "blob" &&
      item.path.startsWith("detections/") &&
      item.path.endsWith(".yml") &&
      !item.path.includes("/deprecated/")
  );
  return { items, sha: data.sha };
}

async function fetchLatestCommitSha(): Promise<string> {
  const url = `${GITHUB_API}/repos/${SPLUNK_REPO}/commits/${SPLUNK_BRANCH}`;
  const res = await fetch(url, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.sha" },
  });
  if (!res.ok) throw new Error(`GitHub commit API: ${res.status}`);
  return res.text();
}

async function fetchRawFile(filePath: string): Promise<string> {
  const url = `${GITHUB_RAW}/${SPLUNK_REPO}/${SPLUNK_BRANCH}/${filePath}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "detection-platform" },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  return res.text();
}

// ── MITRE Enrichment ──

async function fetchMitreEnrichment(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const csvUrl = `${GITHUB_RAW}/${SPLUNK_REPO}/${SPLUNK_BRANCH}/app_template/lookups/mitre_enrichment.csv`;
    const res = await fetch(csvUrl, { headers: { "User-Agent": "detection-platform" } });
    if (!res.ok) return map;
    const text = await res.text();
    const lines = text.split("\n").slice(1);
    for (const line of lines) {
      if (!line.trim()) continue;
      // CSV: mitre_id,technique,tactics,groups
      const parts = line.split(",");
      if (parts.length >= 3) {
        const mitreId = parts[0]?.replace(/"/g, "").trim();
        const tactic = parts[2]?.replace(/"/g, "").trim();
        if (mitreId && tactic && !map.has(mitreId)) {
          map.set(mitreId, tactic);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to fetch MITRE enrichment CSV:", err);
  }
  return map;
}

// ── Category from path ──

function categoryFromPath(filePath: string): string {
  const match = filePath.match(/^detections\/([^/]+)\//);
  return match ? match[1] : "";
}

// ── Main Sync ──

export async function syncSplunkDetections(): Promise<SplunkSyncResult> {
  const syncStartedAt = new Date();
  const syncRun = await prisma.splunkSyncMeta.create({
    data: { status: "running" },
  });

  const result: SplunkSyncResult = {
    newCount: 0,
    updatedCount: 0,
    removedCount: 0,
    totalDetections: 0,
    commitSha: "",
    errors: [],
  };

  try {
    // 1. Fetch tree, commit SHA, and MITRE enrichment in parallel
    const [tree, commitSha, mitreMap] = await Promise.all([
      fetchGitHubTree(),
      fetchLatestCommitSha(),
      fetchMitreEnrichment(),
    ]);

    result.commitSha = commitSha;

    // 2. Get existing detections for change detection
    const existing = await prisma.splunkDetection.findMany({
      select: { id: true, detectionId: true, contentHash: true },
    });
    const existingMap = new Map(
      existing.map((d) => [d.detectionId, d])
    );
    const seenIds = new Set<string>();

    // 3. Fetch all YAML files concurrently
    const yamlResults = await pMap(
      tree.items,
      async (item) => {
        try {
          const content = await fetchRawFile(item.path);
          return { path: item.path, content };
        } catch (err) {
          result.errors.push(
            `Fetch failed: ${item.path} — ${err instanceof Error ? err.message : String(err)}`
          );
          return null;
        }
      },
      CONCURRENCY
    );

    // 4. Parse and upsert
    for (const entry of yamlResults) {
      if (!entry) continue;

      let doc: SplunkDetectionYaml;
      try {
        doc = yaml.load(entry.content) as SplunkDetectionYaml;
        if (!doc || !doc.id || !doc.name) continue;
      } catch {
        result.errors.push(`YAML parse failed: ${entry.path}`);
        continue;
      }

      const detectionId = doc.id;
      seenIds.add(detectionId);

      const contentHash = hash(entry.content);
      const existingDet = existingMap.get(detectionId);

      // Resolve MITRE tactics from technique IDs
      const mitreTechniques = doc.tags?.mitre_attack_id || [];
      const mitreTactics = new Set<string>();
      for (const techId of mitreTechniques) {
        const tactic = mitreMap.get(techId);
        if (tactic) mitreTactics.add(tactic);
      }

      const data = {
        detectionId,
        name: doc.name,
        description: doc.description || "",
        author: doc.author || "",
        date: doc.date || "",
        status: doc.status || "",
        type: doc.type || "",
        search: doc.search || "",
        dataSource: JSON.stringify(doc.data_source || []),
        howToImplement: doc.how_to_implement || "",
        knownFalsePositives: doc.known_false_positives || "",
        references: JSON.stringify(doc.references || []),
        mitreTechniques: JSON.stringify(mitreTechniques),
        mitreTactics: JSON.stringify(Array.from(mitreTactics)),
        analyticStories: JSON.stringify(doc.tags?.analytic_story || []),
        securityDomain: doc.tags?.security_domain || "",
        assetType: doc.tags?.asset_type || "",
        products: JSON.stringify(doc.tags?.product || []),
        category: categoryFromPath(entry.path),
        filePath: entry.path,
        sourceUrl: `https://github.com/${SPLUNK_REPO}/blob/${SPLUNK_BRANCH}/${entry.path}`,
        contentHash,
        version: doc.version || 0,
      };

      if (!existingDet) {
        await prisma.splunkDetection.create({ data });
        result.newCount++;
      } else if (existingDet.contentHash !== contentHash) {
        await prisma.splunkDetection.update({
          where: { id: existingDet.id },
          data,
        });
        result.updatedCount++;
      }
    }

    // 5. Remove detections no longer upstream
    for (const [detId, det] of existingMap) {
      if (!seenIds.has(detId)) {
        await prisma.splunkDetection.delete({ where: { id: det.id } });
        result.removedCount++;
      }
    }

    result.totalDetections = await prisma.splunkDetection.count();

    // 6. Complete sync run
    await prisma.splunkSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "completed",
        newCount: result.newCount,
        updatedCount: result.updatedCount,
        removedCount: result.removedCount,
        totalDetections: result.totalDetections,
        commitSha,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await prisma.splunkSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        errorMessage: msg,
        completedAt: new Date(),
      },
    });
    throw err;
  }

  // Phase 3 — enqueue Detection Pack jobs for Splunk detections inserted this sync
  const { enqueueAfterSyncSafe } = await import("@/lib/detection-packs/enqueue");
  await enqueueAfterSyncSafe("splunk", syncStartedAt);

  return result;
}

// ── Update Check ──

export async function checkForSplunkUpdates(): Promise<{
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  lastSyncAt: string | null;
  lastSyncDetections: number;
}> {
  const lastSync = await prisma.splunkSyncMeta.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
  });

  const latestSha = await fetchLatestCommitSha();
  const currentSha = lastSync?.commitSha || "";

  return {
    updateAvailable: !currentSha || currentSha !== latestSha,
    currentSha,
    latestSha,
    lastSyncAt: lastSync?.completedAt?.toISOString() || null,
    lastSyncDetections: lastSync?.totalDetections || 0,
  };
}
