/**
 * Stratus Red Team catalogue syncer.
 *
 * The canonical source of truth is each `main.go` under
 * v2/internal/attacktechniques/<platform>/<tactic>/<attack-name>/main.go in
 * DataDog/stratus-red-team. Each file registers exactly one
 * `stratus.AttackTechnique` literal we parse with light regexes.
 *
 * No upstream JSON catalogue exists — they generate docs at build time
 * (`stratus list --output json` is local-only). We avoid bundling the
 * `stratus` binary by parsing the source directly.
 *
 * Output is upserted into `StratusAttack`, idempotent.
 */

import { prisma } from "@/lib/prisma";

const REPO_OWNER = "DataDog";
const REPO_NAME = "stratus-red-team";
const REPO_BRANCH = "main";
const TREE_PREFIX = "v2/internal/attacktechniques/";
const CONCURRENCY = 10;

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "detection-platform/stratus-sync",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

interface ParsedAttack {
  attackId: string;
  name: string;
  platform: string;                                // aws | azure | gcp | kubernetes | entra-id
  tactic: string;                                  // credential-access | discovery | …
  description: string;
  detection: string;
  isIdempotent: boolean;
  sourceUrl: string;
}

// Backtick-delimited raw strings make this robust without a real Go parser.
function parseMainGo(path: string, raw: string): ParsedAttack | null {
  // path = v2/internal/attacktechniques/aws/credential-access/ec2-get-password-data/main.go
  const segments = path.split("/").slice(2);       // [attacktechniques, aws, credential-access, ec2-get-password-data, main.go]
  if (segments.length < 4) return null;
  const platform = segments[1];                    // aws
  const tactic = segments[2];                      // credential-access
  const attackName = segments[3];

  const idMatch = raw.match(/\bID:\s*"([^"]+)"/);
  if (!idMatch) return null;
  const attackId = idMatch[1];

  const nameMatch = raw.match(/\bFriendlyName:\s*"((?:[^"\\]|\\.)+)"/);
  const name = nameMatch ? nameMatch[1] : attackName;

  const descMatch = raw.match(/\bDescription:\s*`([\s\S]*?)`/);
  const description = descMatch ? descMatch[1].trim() : "";

  const detMatch = raw.match(/\bDetection:\s*"((?:[^"\\]|\\.)+)"/)
    || raw.match(/\bDetection:\s*`([\s\S]*?)`/);
  const detection = detMatch ? detMatch[1].trim() : "";

  const idempotentMatch = raw.match(/\bIsIdempotent:\s*(true|false)\b/);
  const isIdempotent = idempotentMatch ? idempotentMatch[1] === "true" : true;

  return {
    attackId,
    name,
    platform,
    tactic,
    description,
    detection,
    isIdempotent,
    sourceUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${REPO_BRANCH}/${path}`,
  };
}

async function fetchRaw(path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${path}`;
  const r = await fetch(url, { headers: { "User-Agent": "detection-platform/stratus-sync" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.text();
}

/** Run `fn(x)` for every `x` with a small concurrency cap. */
async function inBatches<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export interface StratusSyncResult {
  totalGoFiles: number;
  parsed: number;
  upserted: number;
  unchanged: number;
  errors: Array<{ path: string; message: string }>;
}

export async function syncStratusAttacks(): Promise<StratusSyncResult> {
  // 1. Repository tree
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_BRANCH}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers: ghHeaders() });
  if (!treeRes.ok) throw new Error(`GitHub tree fetch failed: HTTP ${treeRes.status}`);
  const treeJson = await treeRes.json() as { tree?: GhTreeEntry[] };
  const goFiles = (treeJson.tree || [])
    .filter((e) => e.type === "blob"
      && e.path.startsWith(TREE_PREFIX)
      && e.path.endsWith("/main.go"));

  const result: StratusSyncResult = {
    totalGoFiles: goFiles.length,
    parsed: 0,
    upserted: 0,
    unchanged: 0,
    errors: [],
  };

  // 2. Parse each main.go (CDN, no token needed, no rate limit)
  const parsed = await inBatches(goFiles, CONCURRENCY, async (e) => {
    try {
      const raw = await fetchRaw(e.path);
      return { path: e.path, raw, attack: parseMainGo(e.path, raw) };
    } catch (err: any) {
      result.errors.push({ path: e.path, message: err?.message || String(err) });
      return { path: e.path, raw: "", attack: null };
    }
  });

  // 3. Upsert
  for (const item of parsed) {
    if (!item.attack) {
      if (item.raw) result.errors.push({ path: item.path, message: "parse: no ID field" });
      continue;
    }
    result.parsed++;
    const a = item.attack;
    try {
      const existing = await prisma.stratusAttack.findUnique({ where: { attackId: a.attackId } });
      // Cheap drift detection — compare derived fields
      const sig = `${a.name}|${a.platform}|${a.tactic}|${a.isIdempotent}|${a.description.length}`;
      const oldSig = existing
        ? `${existing.name}|${existing.platform}|${existing.tactic}|${existing.isIdempotent}|${existing.description.length}`
        : null;
      if (existing && oldSig === sig) {
        result.unchanged++;
        continue;
      }
      await prisma.stratusAttack.upsert({
        where: { attackId: a.attackId },
        create: {
          attackId: a.attackId,
          name: a.name,
          platform: a.platform,
          tactic: a.tactic,
          mitreTechniques: "[]",
          description: a.description,
          prerequisites: "",
          detonateCmd: `stratus detonate ${a.attackId}`,
          cleanupCmd: `stratus cleanup ${a.attackId}`,
          isIdempotent: a.isIdempotent,
          sourceUrl: a.sourceUrl,
        },
        update: {
          name: a.name,
          platform: a.platform,
          tactic: a.tactic,
          description: a.description,
          isIdempotent: a.isIdempotent,
          detonateCmd: `stratus detonate ${a.attackId}`,
          cleanupCmd: `stratus cleanup ${a.attackId}`,
          sourceUrl: a.sourceUrl,
        },
      });
      result.upserted++;
    } catch (err: any) {
      result.errors.push({ path: item.path, message: err?.message || String(err) });
    }
  }

  return result;
}
