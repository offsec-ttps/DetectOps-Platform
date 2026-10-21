/**
 * LOTL sync engine.
 *
 * Mirrors src/lib/atomic-red-team/sync.ts (GitHub tree + raw fetch, concurrent
 * download via pMap, content-hash upsert, delete-missing, sync metadata) but
 * drives the ported Magic-Atomics ingestors: for a library it fetches the
 * source repo tree, pulls the matching files, parses them into normalized
 * entries, and upserts them into LotlTechnique keyed by (library, sourceRef).
 */

import { prisma } from "@/lib/prisma";
import { getRegistry } from "./registry";
import { contentHash, fetchLatestCommitSha } from "./github";
import type { LotlSyncResult, NormalizedEntry } from "./types";

function hashEntry(e: NormalizedEntry): string {
  return contentHash(JSON.stringify(e));
}

/** Commit SHA is best-effort: synthesized sources (no GitHub repo) skip it. */
async function latestCommitBestEffort(repo: string, branch: string): Promise<string> {
  if (!repo) return "";
  try {
    return await fetchLatestCommitSha(repo, branch);
  } catch {
    return "";
  }
}

export async function syncLotl(library: string): Promise<LotlSyncResult> {
  const ingestor = getRegistry().get(library);
  if (!ingestor) throw new Error(`unknown LOTL library: ${library}`);

  const meta = await prisma.lotlSyncMeta.upsert({
    where: { library },
    create: { library, status: "running", startedAt: new Date(), completedAt: null },
    update: { status: "running", startedAt: new Date(), completedAt: null, errorMessage: null },
  });

  const result: LotlSyncResult = {
    library,
    newCount: 0,
    updatedCount: 0,
    removedCount: 0,
    totalTests: 0,
    commitSha: "",
    errors: [],
  };

  try {
    const [entries, commitSha] = await Promise.all([
      ingestor.collect(),
      latestCommitBestEffort(ingestor.repo, ingestor.branch),
    ]);
    result.commitSha = commitSha;

    // Existing rows for change detection.
    const existing = await prisma.lotlTechnique.findMany({
      where: { library },
      select: { id: true, sourceRef: true, contentHash: true },
    });
    const existingMap = new Map(existing.map((r) => [r.sourceRef, r]));
    const seen = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.sourceRef)) continue; // guard against duplicate refs within a sync
      seen.add(entry.sourceRef);

      const hash = hashEntry(entry);
      const prev = existingMap.get(entry.sourceRef);
      const data = {
        library,
        sourceRef: entry.sourceRef,
        name: entry.name,
        description: entry.description || "",
        command: entry.command || "",
        executor: entry.executor,
        cleanupCommand: entry.cleanupCommand || "",
        techniqueId: entry.techniqueId || "",
        techniqueName: entry.techniqueName || "",
        tactic: entry.tactic || "",
        binaryPath: entry.binaryPath || "",
        elevationRequired: entry.elevationRequired,
        riskLevel: entry.riskLevel,
        platforms: JSON.stringify(entry.platforms || []),
        metadata: JSON.stringify(entry.metadata || {}),
        sourceUrl: entry.sourceUrl || "",
        contentHash: hash,
      };

      if (!prev) {
        await prisma.lotlTechnique.create({ data });
        result.newCount++;
      } else if (prev.contentHash !== hash) {
        await prisma.lotlTechnique.update({ where: { id: prev.id }, data });
        result.updatedCount++;
      }
    }

    // Remove entries no longer upstream.
    for (const [ref, row] of existingMap) {
      // `custom:` rows are analyst-added library entries (Module Builder) — never upstream, never pruned.
      if (!seen.has(ref) && !ref.startsWith("custom:")) {
        await prisma.lotlTechnique.delete({ where: { id: row.id } });
        result.removedCount++;
      }
    }

    result.totalTests = await prisma.lotlTechnique.count({ where: { library } });

    await prisma.lotlSyncMeta.update({
      where: { id: meta.id },
      data: {
        status: "completed",
        newCount: result.newCount,
        updatedCount: result.updatedCount,
        removedCount: result.removedCount,
        totalTests: result.totalTests,
        commitSha,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await prisma.lotlSyncMeta.update({
      where: { id: meta.id },
      data: { status: "failed", errorMessage: msg, completedAt: new Date() },
    });
    throw err;
  }

  return result;
}

export async function checkForUpdates(library: string): Promise<{
  library: string;
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  lastSyncAt: string | null;
  lastSyncTests: number;
}> {
  const ingestor = getRegistry().get(library);
  if (!ingestor) throw new Error(`unknown LOTL library: ${library}`);

  const last = await prisma.lotlSyncMeta.findUnique({ where: { library } });
  const latestSha = await latestCommitBestEffort(ingestor.repo, ingestor.branch);
  const currentSha = last?.status === "completed" ? last.commitSha : "";

  return {
    library,
    updateAvailable: !currentSha || currentSha !== latestSha,
    currentSha,
    latestSha,
    lastSyncAt: last?.completedAt?.toISOString() || null,
    lastSyncTests: last?.totalTests || 0,
  };
}
