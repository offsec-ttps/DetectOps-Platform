/**
 * Job-enqueue helpers for the Detection Pack auto-pipeline.
 *
 * - `enqueuePackJob` upserts a single (sourceTable, sourceRefId) tuple. The
 *   `@@unique` constraint on DetectionPackJob makes this idempotent.
 * - `enqueueAfterSync` looks up rows by source kind newer than `since` and
 *   batch-enqueues them. Used both by sync entry-points and by the
 *   backstop poller.
 */

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";

export interface EnqueueInput {
  sourceType: "ti" | "rule";
  sourceTable: string;                                       // ThreatIntelReport | CommunityRule | CommunitySigmaRule | CommunityElasticRule | SplunkDetection
  sourceRefId: string;
}

export type SourceKind = "ti" | "sigmahq" | "elastic" | "splunk" | "community-rule";

interface SourceKindConfig {
  sourceType: "ti" | "rule";
  sourceTable: string;
  scan: (since: Date) => Promise<Array<{ id: string }>>;
}

const SOURCE_CONFIG: Record<SourceKind, SourceKindConfig> = {
  "ti":             { sourceType: "ti",   sourceTable: "ThreatIntelReport",     scan: (since) => prisma.threatIntelReport.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, take: 500 }) },
  "sigmahq":        { sourceType: "rule", sourceTable: "CommunitySigmaRule",    scan: (since) => prisma.communitySigmaRule.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, take: 500 }) },
  "elastic":        { sourceType: "rule", sourceTable: "CommunityElasticRule",  scan: (since) => prisma.communityElasticRule.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, take: 500 }) },
  "splunk":         { sourceType: "rule", sourceTable: "SplunkDetection",       scan: (since) => prisma.splunkDetection.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, take: 500 }) },
  "community-rule": { sourceType: "rule", sourceTable: "CommunityRule",         scan: (since) => prisma.communityRule.findMany({ where: { createdAt: { gte: since } }, select: { id: true }, take: 500 }) },
};

export async function enqueuePackJob(input: EnqueueInput): Promise<{ created: boolean; id: string | null }> {
  // Idempotent via @@unique([sourceTable, sourceRefId]) — create only if absent.
  const existing = await prisma.detectionPackJob.findUnique({
    where: { sourceTable_sourceRefId: { sourceTable: input.sourceTable, sourceRefId: input.sourceRefId } },
  }).catch(() => null);
  if (existing) return { created: false, id: existing.id };

  try {
    const row = await prisma.detectionPackJob.create({
      data: {
        sourceType: input.sourceType,
        sourceTable: input.sourceTable,
        sourceRefId: input.sourceRefId,
        status: "queued",
      },
    });
    return { created: true, id: row.id };
  } catch (err: any) {
    // P2002 = the constraint won the race — treat as "already exists"
    if (err?.code === "P2002") return { created: false, id: null };
    throw err;
  }
}

export interface EnqueueAfterSyncResult {
  source: SourceKind;
  scanned: number;
  enqueued: number;
  skipped: number;
}

/**
 * Scan a source for rows newer than `since` and enqueue any that don't yet
 * have a job. Bounded to 500 rows per call (the upper limit on findMany
 * `take:`); a large backfill will spread across multiple ticks.
 */
export async function enqueueAfterSync({
  source,
  since,
  silent = false,
}: { source: SourceKind; since: Date; silent?: boolean }): Promise<EnqueueAfterSyncResult> {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) throw new Error(`Unknown source kind: ${source}`);
  const rows = await cfg.scan(since);
  let enqueued = 0, skipped = 0;
  for (const row of rows) {
    const r = await enqueuePackJob({
      sourceType: cfg.sourceType,
      sourceTable: cfg.sourceTable,
      sourceRefId: row.id,
    });
    if (r.created) enqueued++;
    else skipped++;
  }
  if (!silent && enqueued > 0) {
    void logEvent({
      category: "detection-pack",
      action: "detection-pack.job.enqueued",
      actor: "system",
      status: "info",
      message: `${source} · enqueued ${enqueued} (skipped ${skipped} duplicates) since ${since.toISOString()}`,
      details: { source, enqueued, skipped, scanned: rows.length, since: since.toISOString() },
    });
  }
  return { source, scanned: rows.length, enqueued, skipped };
}

/**
 * Fire-and-forget wrapper for sync entry-points: enqueue Detection Pack jobs
 * for rows inserted since `since`, swallowing any failure so a broken enqueue
 * never takes down the surrounding sync. Centralizes the try/catch that every
 * source sync would otherwise copy-paste.
 */
export async function enqueueAfterSyncSafe(source: SourceKind, since: Date): Promise<void> {
  try {
    await enqueueAfterSync({ source, since });
  } catch {
    /* enqueue failure must NOT take down the sync result */
  }
}
