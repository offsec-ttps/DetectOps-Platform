/**
 * Shared helpers for community-source adapters that fetch from GitHub.
 *
 * Centralizes:
 *   - GitHub API headers (with optional GITHUB_TOKEN)
 *   - Recursive tree fetch + filtering
 *   - Raw file fetch with timeout
 *   - Content hash for change detection
 *   - Generic upsert into community_rules table
 */

import { createHash } from "crypto";
import type { NormalizedRule, SyncResult } from "../types";

export function ghHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export function hashContent(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

interface TreeNode { path: string; type: string; sha: string }

/**
 * Phase 8 hardening — retry-with-backoff wrapper for transient network failures.
 *
 * Retries on:
 *   - thrown exceptions (network reset, DNS, etc.)
 *   - HTTP 429 (rate limited)
 *   - HTTP 5xx (server errors)
 *
 * Honors `Retry-After` headers when present. Capped exponential backoff
 * keeps the worst case bounded (4 attempts × max ~6s) so a sync that hits
 * a flaky upstream still completes in a reasonable time.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  attempts = 4,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : Math.min(500 * 2 ** i, 6_000);
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** i, 6_000)));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed after ${attempts} attempts: ${url}`);
}

export async function fetchRepoTree(
  owner: string, repo: string, branch: string,
): Promise<TreeNode[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetchWithRetry(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub tree ${owner}/${repo}@${branch} → HTTP ${res.status}`);
  const data: { tree?: TreeNode[] } = await res.json();
  if (!data.tree) throw new Error("Unexpected tree response");
  return data.tree;
}

export async function fetchRawFile(rawUrl: string): Promise<string> {
  const res = await fetchWithRetry(rawUrl);
  if (!res.ok) throw new Error(`fetch ${rawUrl} → ${res.status}`);
  return await res.text();
}

/** Extract MITRE ATT&CK technique IDs from any string (handles TXXXX and TXXXX.XXX). */
export function extractTechniques(...strings: (string | undefined | null)[]): string[] {
  const found = new Set<string>();
  for (const s of strings) {
    if (!s) continue;
    const matches = s.match(/T\d{4}(?:\.\d{3})?/g);
    if (matches) for (const m of matches) found.add(m);
  }
  return [...found];
}

/** Extract MITRE ATT&CK tactic IDs (TA0001..TA0043). */
export function extractTactics(...strings: (string | undefined | null)[]): string[] {
  const found = new Set<string>();
  for (const s of strings) {
    if (!s) continue;
    const matches = s.match(/TA\d{4}/g);
    if (matches) for (const m of matches) found.add(m);
  }
  return [...found];
}

/** Sequential parallelism with a small concurrency limit. */
export async function processBatched<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = 20,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map(worker));
    results.push(...settled);
  }
  return results;
}

/**
 * Generic upsert into community_rules. Used by every non-legacy adapter.
 * Returns counts so the caller can build a SyncResult.
 */
export async function upsertNormalizedRule(
  sourceId: string,
  rule: NormalizedRule,
  contentHash: string,
): Promise<"new" | "modified" | "unchanged"> {
  const { prisma } = await import("@/lib/prisma");
  const existing = await prisma.communityRule.findUnique({
    where: { sourceId_sourceFilePath: { sourceId, sourceFilePath: rule.sourceFilePath } },
  });

  const data = {
    sourceId,
    upstreamRuleId: rule.upstreamRuleId,
    title: rule.title,
    description: rule.description,
    author: rule.author,
    upstreamCreatedAt: rule.upstreamCreatedAt,
    upstreamModifiedAt: rule.upstreamModifiedAt,
    mitreTechniques: JSON.stringify(rule.mitreTechniques),
    mitreTactics: JSON.stringify(rule.mitreTactics),
    platforms: JSON.stringify(rule.platforms),
    products: JSON.stringify(rule.products),
    logSources: JSON.stringify(rule.logSources),
    tags: JSON.stringify(rule.tags),
    ruleLanguage: rule.ruleLanguage,
    ruleType: rule.ruleType,
    detectionLogicRaw: rule.detectionLogicRaw,
    conversionSupported: rule.conversionSupported,
    severity: rule.severity,
    status: rule.status,
    references: JSON.stringify(rule.references),
    falsePositives: JSON.stringify(rule.falsePositives),
    sourceFilePath: rule.sourceFilePath,
    sourceUrl: rule.sourceUrl,
    rawPayload: JSON.stringify(rule.rawPayload),
    contentHash,
  };

  if (!existing) {
    await prisma.communityRule.create({ data: { ...data, changeStatus: "new" } });
    return "new";
  }
  if (existing.contentHash !== contentHash) {
    await prisma.communityRule.update({
      where: { id: existing.id },
      data: { ...data, changeStatus: "modified" },
    });
    return "modified";
  }
  return "unchanged";
}

/** Mark every local rule whose path is not in `seenPaths` as deleted. */
export async function markDeletedRules(
  sourceId: string,
  seenPaths: Set<string>,
): Promise<number> {
  const { prisma } = await import("@/lib/prisma");
  const all = await prisma.communityRule.findMany({
    where: { sourceId },
    select: { id: true, sourceFilePath: true, changeStatus: true },
  });
  let deleted = 0;
  for (const r of all) {
    if (!seenPaths.has(r.sourceFilePath) && r.changeStatus !== "deleted") {
      await prisma.communityRule.update({
        where: { id: r.id },
        data: { changeStatus: "deleted" },
      });
      deleted++;
    }
  }
  return deleted;
}

export async function ensureCommunitySource(
  name: string, type: string, description: string, url: string,
): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const source = await prisma.communitySource.upsert({
    where: { name },
    update: {},
    create: { name, type, description, url },
  });
  return source.id;
}

export async function finalizeSync(
  sourceId: string,
  newCount: number,
  modifiedCount: number,
  deletedCount: number,
  errors: { file?: string; message: string }[],
): Promise<SyncResult> {
  const { prisma } = await import("@/lib/prisma");
  const totalAfterSync = await prisma.communityRule.count({
    where: { sourceId, changeStatus: { not: "deleted" } },
  });
  await prisma.communitySource.update({
    where: { id: sourceId },
    data: { lastSyncAt: new Date(), totalRules: totalAfterSync },
  });
  return { newCount, modifiedCount, deletedCount, totalAfterSync, errors };
}
