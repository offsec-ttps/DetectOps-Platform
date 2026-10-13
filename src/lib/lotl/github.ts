/**
 * Shared GitHub fetch helpers for LOTL ingestion.
 *
 * The platform fetches source data over the GitHub tree + raw APIs rather than
 * cloning repos (mirrors src/lib/atomic-red-team/sync.ts and avoids disk-heavy
 * clones on a space-constrained host). This replaces the git clone/pull used by
 * the Magic-Atomics Python ingestors while keeping the same parse step.
 */

import crypto from "crypto";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";

export interface GitHubTreeItem {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

export function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "detection-platform",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
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
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/** Fetch a repo's full recursive tree, filtered by a path predicate. */
export async function fetchTree(
  repo: string,
  branch: string,
  match: (path: string) => boolean,
): Promise<{ items: GitHubTreeItem[]; sha: string; truncated: boolean }> {
  const url = `${GITHUB_API}/repos/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub tree API ${repo}@${branch}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const items = (data.tree as GitHubTreeItem[]).filter(
    (it) => it.type === "blob" && match(it.path),
  );
  return { items, sha: data.sha as string, truncated: !!data.truncated };
}

export async function fetchLatestCommitSha(repo: string, branch: string): Promise<string> {
  const url = `${GITHUB_API}/repos/${repo}/commits/${branch}`;
  const res = await fetch(url, { headers: { ...ghHeaders(), Accept: "application/vnd.github.sha" } });
  if (!res.ok) throw new Error(`GitHub commit API ${repo}: ${res.status}`);
  return res.text();
}

export async function fetchRaw(repo: string, branch: string, filePath: string): Promise<string> {
  const url = `${GITHUB_RAW}/${repo}/${branch}/${encodeURI(filePath)}`;
  const res = await fetch(url, { headers: { "User-Agent": "detection-platform" } });
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  return res.text();
}

export function rawUrl(repo: string, branch: string, filePath: string): string {
  return `${GITHUB_RAW}/${repo}/${branch}/${filePath}`;
}
