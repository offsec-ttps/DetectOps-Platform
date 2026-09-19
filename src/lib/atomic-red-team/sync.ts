import { prisma } from "@/lib/prisma";
import yaml from "js-yaml";
import crypto from "crypto";

const ART_REPO = "redcanaryco/atomic-red-team";
const ART_BRANCH = "master";
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

interface AtomicYaml {
  attack_technique: string;
  display_name: string;
  atomic_tests?: AtomicTestYaml[];
}

interface AtomicTestYaml {
  name: string;
  auto_generated_guid?: string;
  description?: string;
  supported_platforms?: string[];
  executor?: {
    name?: string;
    elevation_required?: boolean;
    command?: string;
    cleanup_command?: string;
  };
  input_arguments?: Record<string, unknown>;
  dependency_executor_name?: string;
  dependencies?: unknown[];
}

export interface SyncResult {
  newCount: number;
  updatedCount: number;
  removedCount: number;
  totalTechniques: number;
  totalTests: number;
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

function contentHash(content: string): string {
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
  const url = `${GITHUB_API}/repos/${ART_REPO}/git/trees/${ART_BRANCH}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub tree API: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.truncated) {
    console.warn("GitHub tree truncated — some atomics may be missing");
  }
  const items = (data.tree as GitHubTreeItem[]).filter(
    (item) =>
      item.type === "blob" &&
      /^atomics\/T[\d.]+\/T[\d.]+\.yaml$/.test(item.path)
  );
  return { items, sha: data.sha };
}

async function fetchLatestCommitSha(): Promise<string> {
  const url = `${GITHUB_API}/repos/${ART_REPO}/commits/${ART_BRANCH}`;
  const res = await fetch(url, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github.sha" },
  });
  if (!res.ok) throw new Error(`GitHub commit API: ${res.status}`);
  return res.text();
}

async function fetchRawFile(filePath: string): Promise<string> {
  const url = `${GITHUB_RAW}/${ART_REPO}/${ART_BRANCH}/${filePath}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "detection-platform" },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  return res.text();
}

// ── Tactic Mapping ──

async function fetchTacticMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const csvUrl = `${GITHUB_RAW}/${ART_REPO}/${ART_BRANCH}/atomics/Indexes/Indexes-CSV/index.csv`;
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": "detection-platform" },
    });
    if (!res.ok) return map;
    const text = await res.text();
    const lines = text.split("\n").slice(1); // skip header
    for (const line of lines) {
      if (!line.trim()) continue;
      // CSV: Tactic,Technique #,Technique Name,Test #,Test Name,Test GUID,Executor Name
      const match = line.match(/^"?([^",]+)"?,\s*"?([^",]+)"?/);
      if (match) {
        const tactic = match[1].trim();
        const techId = match[2].trim();
        if (tactic && techId && !map.has(techId)) {
          map.set(techId, tactic);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to fetch tactic CSV index:", err);
  }
  return map;
}

// ── Main Sync ──

export async function syncAtomicRedTeam(): Promise<SyncResult> {
  const syncRun = await prisma.atomicSyncMeta.create({
    data: { status: "running" },
  });

  const result: SyncResult = {
    newCount: 0,
    updatedCount: 0,
    removedCount: 0,
    totalTechniques: 0,
    totalTests: 0,
    commitSha: "",
    errors: [],
  };

  try {
    // 1. Fetch GitHub tree + commit SHA + tactic mapping in parallel
    const [tree, commitSha, tacticMap] = await Promise.all([
      fetchGitHubTree(),
      fetchLatestCommitSha(),
      fetchTacticMap(),
    ]);

    result.commitSha = commitSha;

    // 2. Get existing tests for change detection
    const existingTests = await prisma.atomicTest.findMany({
      select: { id: true, techniqueId: true, testNumber: true, contentHash: true },
    });
    const existingMap = new Map(
      existingTests.map((t) => [`${t.techniqueId}:${t.testNumber}`, t])
    );
    const seenKeys = new Set<string>();

    // 3. Fetch all YAML files concurrently
    const yamlResults = await pMap(
      tree.items,
      async (item) => {
        try {
          const content = await fetchRawFile(item.path);
          return { path: item.path, sha: item.sha, content };
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
    const techniques = new Set<string>();

    for (const entry of yamlResults) {
      if (!entry) continue;

      let doc: AtomicYaml;
      try {
        doc = yaml.load(entry.content) as AtomicYaml;
        if (!doc || !doc.attack_technique || !doc.atomic_tests) continue;
      } catch {
        result.errors.push(`YAML parse failed: ${entry.path}`);
        continue;
      }

      const techniqueId = String(doc.attack_technique);
      techniques.add(techniqueId);
      const tactic = tacticMap.get(techniqueId) || "";

      for (let i = 0; i < doc.atomic_tests.length; i++) {
        const test = doc.atomic_tests[i];
        const testNumber = i + 1;
        const key = `${techniqueId}:${testNumber}`;
        seenKeys.add(key);

        const hash = contentHash(
          JSON.stringify({ techniqueId, testNumber, test })
        );
        const existing = existingMap.get(key);

        const data = {
          techniqueId,
          techniqueName: doc.display_name || techniqueId,
          testNumber,
          testGuid: test.auto_generated_guid || "",
          testName: test.name || `Test #${testNumber}`,
          testDescription: test.description || "",
          platforms: JSON.stringify(test.supported_platforms || []),
          elevationRequired: test.executor?.elevation_required || false,
          executorName: test.executor?.name || "",
          command: test.executor?.command || "",
          cleanupCommand: test.executor?.cleanup_command || "",
          inputArguments: JSON.stringify(test.input_arguments || {}),
          dependencies: JSON.stringify(test.dependencies || []),
          tactic,
          sourceUrl: `https://github.com/${ART_REPO}/blob/${ART_BRANCH}/${entry.path}`,
          contentHash: hash,
        };

        if (!existing) {
          await prisma.atomicTest.create({ data });
          result.newCount++;
        } else if (existing.contentHash !== hash) {
          await prisma.atomicTest.update({
            where: { id: existing.id },
            data,
          });
          result.updatedCount++;
        }
      }
    }

    // 5. Remove tests no longer upstream
    for (const [key, test] of existingMap) {
      if (!seenKeys.has(key)) {
        await prisma.atomicTest.delete({ where: { id: test.id } });
        result.removedCount++;
      }
    }

    result.totalTechniques = techniques.size;
    result.totalTests = await prisma.atomicTest.count();

    // 6. Complete sync run
    await prisma.atomicSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "completed",
        newCount: result.newCount,
        updatedCount: result.updatedCount,
        removedCount: result.removedCount,
        totalTechniques: result.totalTechniques,
        totalTests: result.totalTests,
        commitSha,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await prisma.atomicSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        errorMessage: msg,
        completedAt: new Date(),
      },
    });
    throw err;
  }

  return result;
}

// ── Update Check ──

export async function checkForUpdates(): Promise<{
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  lastSyncAt: string | null;
  lastSyncTests: number;
}> {
  const lastSync = await prisma.atomicSyncMeta.findFirst({
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
    lastSyncTests: lastSync?.totalTests || 0,
  };
}
