/**
 * Attack Data Repository Scanner
 *
 * Discovers and parses YAML metadata files from a local Splunk attack_data
 * checkout. Normalizes records into UI-friendly rows with stable row IDs.
 *
 * Mirrors the behavior of attack_data/bin/replay.py:
 *   - recursive .yml/.yaml scan
 *   - default index=attack_data, source=attack_data, sourcetype=_json
 *   - one YAML may declare multiple datasets[]; each becomes a separate row
 *
 * Caches results in-memory keyed by repo root + mtime fingerprint.
 */

import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as yaml from "js-yaml";

// ── Config ──

export const ATTACK_DATA_ROOT =
  process.env.ATTACK_DATA_ROOT || "/media/nested/SamsungEvo/DE/attack_data";

export const REPLAY_FEATURE_ENABLED =
  (process.env.ENABLE_ATTACK_DATA_REPLAY ?? "true").toLowerCase() !== "false";

export const REPLAY_BUILD_ENABLED =
  (process.env.ENABLE_REPLAY_BUILD ?? "true").toLowerCase() !== "false";

export const REPLAY_SAVE_ENABLED =
  (process.env.ENABLE_REPLAY_SAVE_FOR_LATER ?? "true").toLowerCase() !== "false";

// ── Types ──

export interface ReplayDatasetRow {
  row_id: string;
  dataset_id: string;          // YAML id field
  dataset_name: string;        // datasets[].name
  title: string | null;
  description: string | null;
  platform: string | null;     // inferred from path/sourcetype
  log_type: string | null;     // windows | linux | aws | azure | network | etc.
  mitre_attack_ids: string[];
  environment: string | null;
  data_file_path: string;      // absolute path
  metadata_file_path: string;  // absolute path
  index: string;
  source: string;
  sourcetype: string;
  replay_supported: boolean;
  build_replay_available: boolean;
  replay_now_available: boolean;
  data_file_exists: boolean;
  data_file_size_bytes: number;
  needs_download: boolean;       // present on disk only as a Git-LFS pointer — must be pulled before replay
  category: string | null;     // top-level subfolder under datasets/
  author: string | null;
  date: string | null;
  directory: string | null;
}

export interface RepoStatus {
  root: string;
  exists: boolean;
  configured: boolean;
  scannedAt: string | null;
  totalYamlFiles: number;
  totalDatasets: number;
  parseErrors: { file: string; error: string }[];
  facets: {
    platforms: string[];
    categories: string[];
    logTypes: string[];
    environments: string[];
    sourcetypes: string[];
    mitreIds: string[];
  };
}

// ── Cache ──

interface CacheEntry {
  rows: ReplayDatasetRow[];
  status: RepoStatus;
  fingerprint: string;
  cachedAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Helpers ──

/** Find the actual attack_data root, handling subfolder layout. */
export function resolveRepoRoot(configured: string = ATTACK_DATA_ROOT): {
  root: string;
  exists: boolean;
} {
  if (!configured) return { root: configured, exists: false };

  // direct: configured contains datasets/
  if (fs.existsSync(path.join(configured, "datasets"))) {
    return { root: configured, exists: true };
  }
  // nested: configured/attack_data/datasets/
  const nested = path.join(configured, "attack_data");
  if (fs.existsSync(path.join(nested, "datasets"))) {
    return { root: nested, exists: true };
  }
  return { root: configured, exists: fs.existsSync(configured) };
}

/** Recursively walk a directory, yielding all .yml/.yaml file paths. */
function walkYamlFiles(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(full, acc);
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Infer platform from sourcetype/path heuristics. */
function inferPlatform(sourcetype: string, dataFilePath: string): string | null {
  const st = (sourcetype || "").toLowerCase();
  const p = (dataFilePath || "").toLowerCase();
  if (st.includes("xmlwineventlog") || st.includes("wineventlog") || st.includes("windows")) return "windows";
  if (st.includes("linux") || st.includes("syslog") || p.includes("/linux/")) return "linux";
  if (st.includes("aws") || p.includes("/aws/")) return "aws";
  if (st.includes("azure") || p.includes("/azure/")) return "azure";
  if (st.includes("o365") || st.includes("m365") || p.includes("/m365") || p.includes("/o365")) return "m365";
  if (st.includes("gcp") || p.includes("/gcp/")) return "gcp";
  if (st.includes("kube") || p.includes("/kubernetes/")) return "kubernetes";
  if (st.includes("cisco") || p.includes("/cisco")) return "network";
  if (p.includes("/macos/")) return "macos";
  return null;
}

/** Infer log type from sourcetype patterns. */
function inferLogType(sourcetype: string): string | null {
  const st = (sourcetype || "").toLowerCase();
  if (st.includes("sysmon")) return "sysmon";
  if (st.includes("powershell")) return "powershell";
  if (st.includes("security")) return "winsecurity";
  if (st.includes("dns")) return "dns";
  if (st.includes("network") || st.includes("netflow")) return "network";
  if (st.includes("syslog")) return "syslog";
  if (st.includes("cloudtrail")) return "cloudtrail";
  if (st.includes("json") || st === "_json") return "json";
  if (st.includes("malware")) return "malware";
  return null;
}

/** Resolve dataset path field — may be absolute or repo-relative (with leading /). */
function resolveDatasetPath(repoRoot: string, datasetPath: string): string {
  if (!datasetPath) return "";
  if (path.isAbsolute(datasetPath)) {
    // attack_data uses leading-/ relative paths like "/datasets/..."
    // Strip leading slash and resolve under repoRoot
    if (datasetPath.startsWith("/datasets/") || datasetPath.startsWith("/environments/")) {
      return path.join(repoRoot, datasetPath.replace(/^\//, ""));
    }
    return datasetPath; // truly absolute
  }
  return path.join(repoRoot, datasetPath);
}

/** Stable row ID derived from metadata file + dataset name. */
function makeRowId(metadataPath: string, repoRoot: string, datasetName: string, idx: number): string {
  // Shortened but GLOBALLY unique & deterministic. The attack_data repo has many
  // identically-named metadata files (e.g. remcom.yml) under different technique
  // directories, so the basename alone collides. Fold a short hash of the full
  // repo-relative path into the id to disambiguate while keeping it readable.
  const base = path.basename(metadataPath, path.extname(metadataPath));
  const safeName = (datasetName || `ds${idx}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const rel = path.relative(repoRoot, metadataPath) || metadataPath;
  const pathHash = crypto.createHash("sha1").update(rel).digest("hex").slice(0, 8);
  return `${base}__${safeName}__${idx}__${pathHash}`;
}

// ── Parse a single YAML ──

interface ParsedYaml {
  id?: string;
  author?: string;
  date?: string | Date;
  description?: string;
  environment?: string;
  directory?: string;
  mitre_technique?: string[] | string;
  index?: string;
  source?: string;
  sourcetype?: string;
  datasets?: Array<{
    name?: string;
    path?: string;
    source?: string;
    sourcetype?: string;
    index?: string;
  }>;
}

function parseYamlFile(
  filePath: string,
  repoRoot: string,
  errors: { file: string; error: string }[]
): ReplayDatasetRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    errors.push({ file: filePath, error: `read failed: ${err.message}` });
    return [];
  }

  let parsed: ParsedYaml | null = null;
  try {
    parsed = yaml.load(raw) as ParsedYaml;
  } catch (err: any) {
    errors.push({ file: filePath, error: `yaml parse failed: ${err.message}` });
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const datasets = Array.isArray(parsed.datasets) ? parsed.datasets : [];
  if (datasets.length === 0) return [];

  // Defaults from replay.py
  const defaultIndex = parsed.index || "attack_data";
  const defaultSource = parsed.source || "attack_data";
  const defaultSourcetype = parsed.sourcetype || "_json";

  const mitreRaw = parsed.mitre_technique;
  const mitreIds = (Array.isArray(mitreRaw) ? mitreRaw : mitreRaw ? [mitreRaw] : [])
    .filter((v) => typeof v === "string")
    .map((v) => String(v).trim().toUpperCase());

  // Determine top-level category from path under datasets/
  // Only count if there's a directory between datasets/ and the file
  // (i.e., datasets/<category>/.../file.yml — exclude datasets/TEMPLATE.yml)
  const relFromRepo = path.relative(repoRoot, filePath);
  const segments = relFromRepo.split(path.sep);
  const category =
    segments.length >= 3 && segments[0] === "datasets" ? segments[1] : null;

  const dateStr =
    parsed.date instanceof Date
      ? parsed.date.toISOString().split("T")[0]
      : parsed.date
        ? String(parsed.date)
        : null;

  const rows: ReplayDatasetRow[] = [];
  datasets.forEach((ds, idx) => {
    if (!ds || typeof ds !== "object") return;
    const dsName = ds.name || `dataset_${idx}`;
    const dsRawPath = ds.path || "";
    const dataFilePath = resolveDatasetPath(repoRoot, dsRawPath);
    const sourcetype = ds.sourcetype || defaultSourcetype;
    const source = ds.source || defaultSource;
    const index = ds.index || defaultIndex;

    let exists = false;
    let size = 0;
    let isPointer = false;
    if (dataFilePath) {
      try {
        const st = fs.statSync(dataFilePath);
        size = st.size;
        // A small file may be a Git-LFS pointer (clone without blobs) rather than
        // real logs — read the head and check, so the catalog doesn't advertise a
        // not-yet-downloaded dataset as replayable (HEC would ingest the pointer).
        if (st.size > 0 && st.size <= 1024) {
          try {
            const fd = fs.openSync(dataFilePath, "r");
            const head = Buffer.alloc(45);
            fs.readSync(fd, head, 0, 45, 0);
            fs.closeSync(fd);
            isPointer = head.toString("latin1").startsWith("version https://git-lfs.github.com/spec/v1");
          } catch { /* ignore */ }
        }
        exists = !isPointer;   // a pointer stub is NOT a usable data file
      } catch { /* missing */ }
    }

    const platform = inferPlatform(sourcetype, dataFilePath);
    const logType = inferLogType(sourcetype);

    rows.push({
      row_id: makeRowId(filePath, repoRoot, dsName, idx),
      dataset_id: parsed!.id || path.basename(filePath, path.extname(filePath)),
      dataset_name: dsName,
      title: dsName,
      description: parsed!.description || null,
      platform,
      log_type: logType,
      mitre_attack_ids: mitreIds,
      environment: parsed!.environment || null,
      data_file_path: dataFilePath,
      metadata_file_path: filePath,
      index,
      source,
      sourcetype,
      replay_supported: exists && dataFilePath.startsWith(repoRoot),
      build_replay_available: REPLAY_BUILD_ENABLED && exists,
      replay_now_available: exists,
      data_file_exists: exists,
      data_file_size_bytes: isPointer ? 0 : size,
      needs_download: isPointer,
      category,
      author: parsed!.author || null,
      date: dateStr,
      directory: parsed!.directory || null,
    });
  });

  return rows;
}

// ── Public scan ──

export interface ScanOptions {
  repoRoot?: string;
  forceRefresh?: boolean;
}

export function scanRepo(options: ScanOptions = {}): {
  rows: ReplayDatasetRow[];
  status: RepoStatus;
} {
  const configuredRoot = options.repoRoot || ATTACK_DATA_ROOT;
  const { root, exists } = resolveRepoRoot(configuredRoot);

  if (!exists) {
    return {
      rows: [],
      status: {
        root,
        exists: false,
        configured: !!configuredRoot,
        scannedAt: null,
        totalYamlFiles: 0,
        totalDatasets: 0,
        parseErrors: [],
        facets: {
          platforms: [], categories: [], logTypes: [],
          environments: [], sourcetypes: [], mitreIds: [],
        },
      },
    };
  }

  // Cache check (fingerprint = root only; cheap TTL-based invalidation)
  const fingerprint = root;
  if (
    !options.forceRefresh &&
    cache &&
    cache.fingerprint === fingerprint &&
    Date.now() - cache.cachedAt < CACHE_TTL_MS
  ) {
    return { rows: cache.rows, status: cache.status };
  }

  // Walk
  const datasetsDir = path.join(root, "datasets");
  const yamlFiles = walkYamlFiles(datasetsDir);

  const errors: { file: string; error: string }[] = [];
  const allRows: ReplayDatasetRow[] = [];
  for (const file of yamlFiles) {
    const rows = parseYamlFile(file, root, errors);
    allRows.push(...rows);
  }

  // Build facets
  const facets = {
    platforms: dedupSorted(allRows.map((r) => r.platform).filter(Boolean) as string[]),
    categories: dedupSorted(allRows.map((r) => r.category).filter(Boolean) as string[]),
    logTypes: dedupSorted(allRows.map((r) => r.log_type).filter(Boolean) as string[]),
    environments: dedupSorted(allRows.map((r) => r.environment).filter(Boolean) as string[]),
    sourcetypes: dedupSorted(allRows.map((r) => r.sourcetype)),
    mitreIds: dedupSorted(allRows.flatMap((r) => r.mitre_attack_ids)),
  };

  const status: RepoStatus = {
    root,
    exists: true,
    configured: true,
    scannedAt: new Date().toISOString(),
    totalYamlFiles: yamlFiles.length,
    totalDatasets: allRows.length,
    parseErrors: errors.slice(0, 50),
    facets,
  };

  cache = { rows: allRows, status, fingerprint, cachedAt: Date.now() };
  return { rows: allRows, status };
}

function dedupSorted(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

/** Force-clear the cache (called after admin path change). */
export function clearCache() { cache = null; }

/** Get a single row by row_id, scanning if not cached. */
export function getRowById(rowId: string): ReplayDatasetRow | null {
  const { rows } = scanRepo();
  return rows.find((r) => r.row_id === rowId) || null;
}

// ── Search/filter helpers ──

export interface CatalogQuery {
  q?: string;
  platform?: string;
  category?: string;
  logType?: string;
  environment?: string;
  sourcetype?: string;
  mitreId?: string;
  replayableOnly?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: keyof ReplayDatasetRow;
  sortDir?: "asc" | "desc";
}

export function queryCatalog(opts: CatalogQuery = {}): {
  rows: ReplayDatasetRow[];
  total: number;
  filtered: number;
  page: number;
  pageSize: number;
  status: RepoStatus;
} {
  const { rows, status } = scanRepo();
  let filtered = rows;

  if (opts.q) {
    const q = opts.q.toLowerCase();
    filtered = filtered.filter((r) => {
      const haystack = [
        r.dataset_name, r.dataset_id, r.title, r.description,
        r.directory, r.category, r.author,
        ...(r.mitre_attack_ids || []),
        r.platform, r.environment, r.source, r.sourcetype,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  if (opts.platform) filtered = filtered.filter((r) => r.platform === opts.platform);
  if (opts.category) filtered = filtered.filter((r) => r.category === opts.category);
  if (opts.logType) filtered = filtered.filter((r) => r.log_type === opts.logType);
  if (opts.environment) filtered = filtered.filter((r) => r.environment === opts.environment);
  if (opts.sourcetype) filtered = filtered.filter((r) => r.sourcetype === opts.sourcetype);
  if (opts.mitreId) {
    const mid = opts.mitreId.toUpperCase();
    filtered = filtered.filter((r) => r.mitre_attack_ids.some((id) => id.includes(mid)));
  }
  if (opts.replayableOnly) filtered = filtered.filter((r) => r.replay_supported);

  // Sort
  const sortBy = opts.sortBy || "dataset_name";
  const dir = opts.sortDir === "desc" ? -1 : 1;
  filtered = [...filtered].sort((a: any, b: any) => {
    const av = a[sortBy] ?? "";
    const bv = b[sortBy] ?? "";
    return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
  });

  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize || 50));
  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  return {
    rows: paged,
    total: rows.length,
    filtered: filtered.length,
    page,
    pageSize,
    status,
  };
}
