/**
 * TI → Simulation-Library watcher scan.
 *
 * Scans ThreatIntelReport rows inserted since a watermark, extracts each
 * observed ATT&CK technique, classifies it into the correct Attack-Simulation
 * library (rules-first, AI fallback), dedups against hand-curated library
 * entries and prior contributions, links a vetted AtomicTest where one exists,
 * and writes review-gated SimLibraryContribution rows.
 *
 * Idempotent: contributions are keyed by a unique dedupKey, so re-scanning the
 * same reports creates no duplicates (prior reviews are preserved). Mirrors the
 * detection-pack worker's module-level mutex + run-record pattern.
 */

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { classifyTechnique } from "./classify";
import { coveredByStaticDef, dedupKeyFor, slug } from "./dedup";
import { linkAtomic } from "./atomics";

export interface WatcherScanInput {
  since?: Date;       // default = last successful run's startedAt, else 7 days ago
  cap?: number;       // max reports per scan (default 200)
}

export interface WatcherScanResult {
  runId: string;
  reportsScanned: number;
  contributionsCreated: number;
  updated: number;
  skipped: number;      // covered by a static library def
  unrouted: number;
  durationMs: number;
}

let scanRunning = false;

const TID_RE = /^T\d{4}(\.\d{3})?$/;
/** Max LLM classifications per scan — bounds cost/latency on a busy feed (rules are free and unbounded). */
const MAX_AI_CALLS_PER_SCAN = 25;

interface MitreEntry { technique_id?: string; technique?: string; tactic?: string; tactic_id?: string }

function parseMitre(s: string): MitreEntry[] {
  try {
    const v = JSON.parse(s || "[]");
    if (!Array.isArray(v)) return [];
    return v.map((e): MitreEntry => {
      if (typeof e === "string") return { technique_id: e, technique: e };
      return { technique_id: e?.technique_id, technique: e?.technique, tactic: e?.tactic, tactic_id: e?.tactic_id };
    });
  } catch { return []; }
}

function parseTags(s: string): string[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function mapSeverity(level: string | null | undefined): string {
  const l = (level || "").toLowerCase();
  if (l.includes("critical")) return "critical";
  if (l.includes("high")) return "high";
  if (l.includes("low")) return "low";
  return "medium";
}

async function watermark(explicit?: Date): Promise<Date> {
  if (explicit) return explicit;
  const last = await prisma.simWatcherRun.findFirst({ where: { status: "completed" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }).catch(() => null);
  return last?.startedAt ?? new Date(Date.now() - 7 * 24 * 3600 * 1000);
}

/**
 * Run one watcher scan. Throws only on unexpected infra errors; per-technique
 * failures are swallowed so one bad report never aborts the batch.
 */
export async function runWatcherScan(input: WatcherScanInput = {}): Promise<WatcherScanResult> {
  if (scanRunning) throw new Error("A watcher scan is already running");
  scanRunning = true;
  const startedAt = new Date();
  const since = await watermark(input.since);
  const cap = input.cap ?? 200;

  const run = await prisma.simWatcherRun.create({ data: { startedAt, status: "running" } });
  let reportsScanned = 0, created = 0, updated = 0, skipped = 0, unrouted = 0, aiCalls = 0;

  try {
    const reports = await prisma.threatIntelReport.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: cap,
      select: {
        id: true, title: true, summary: true, category: true, tags: true,
        severityLevel: true, sourceUrl: true, sourceVendor: true, mitreTechniques: true,
      },
    });
    reportsScanned = reports.length;

    for (const report of reports) {
      const techniques = parseMitre(report.mitreTechniques);
      const tags = parseTags(report.tags);
      const seenInReport = new Set<string>();

      for (const t of techniques) {
        const techId = (t.technique_id || "").toUpperCase();
        if (!TID_RE.test(techId) || seenInReport.has(techId)) continue;
        seenInReport.add(techId);

        try {
          const techName = t.technique && t.technique !== t.technique_id ? t.technique : "";
          const cls = await classifyTechnique({
            techniqueId: techId,
            techniqueName: techName || techId,
            tactic: t.tactic && t.tactic.toLowerCase() !== "unknown" ? t.tactic : undefined,
            reportTitle: report.title,
            reportSummary: report.summary,
            reportCategory: report.category,
            tags,
          }, { allowAi: aiCalls < MAX_AI_CALLS_PER_SCAN });
          if (cls.method === "ai") aiCalls++;

          // Skip when a hand-curated library entry already covers this exact ATT&CK (sub-)technique.
          if (cls.libraryKey && coveredByStaticDef(cls.libraryKey, techId)) { skipped++; continue; }

          const displayName = techName || `${techId} (via ${report.sourceVendor || report.title || "Threat Intel"})`;
          const dedupKey = dedupKeyFor(cls.libraryKey, techId, displayName);
          const link = await linkAtomic(techId);

          const existing = await prisma.simLibraryContribution.findUnique({ where: { dedupKey }, select: { id: true } }).catch(() => null);
          if (existing) {
            // Refresh provenance/classifier/atomic link WITHOUT disturbing review status.
            await prisma.simLibraryContribution.update({
              where: { dedupKey },
              data: {
                sourceUrl: report.sourceUrl || null,
                sourceVendor: report.sourceVendor || null,
                sourceTitle: report.title || null,
                classifierMethod: cls.method,
                classifierConfidence: cls.confidence,
                classifierReason: cls.reason,
                ...(link.atomicTestId ? { atomicTestId: link.atomicTestId, atomicTestName: link.atomicTestName, atomicTestNumber: link.atomicTestNumber, needsAtomic: false } : {}),
              },
            }).catch(() => {});
            updated++;
            continue;
          }

          await prisma.simLibraryContribution.create({
            data: {
              libraryKey: cls.libraryKey,
              category: cls.category,
              techniqueKey: `ti-${slug(displayName)}-${techId.toLowerCase().replace(/\./g, "-")}`,
              name: displayName,
              description: (report.summary || "").slice(0, 600),
              summary: techName ? `${techName} — observed in ${report.sourceVendor || "threat intel"}.` : `${techId} observed in ${report.sourceVendor || "threat intel"}.`,
              abuse: "",
              attackTechniques: JSON.stringify([techId]),
              tactic: t.tactic && t.tactic.toLowerCase() !== "unknown" ? t.tactic : null,
              platforms: JSON.stringify(["windows"]),
              severity: mapSeverity(report.severityLevel),
              sourceTable: "ThreatIntelReport",
              sourceRefId: report.id,
              sourceUrl: report.sourceUrl || null,
              sourceVendor: report.sourceVendor || null,
              sourceTitle: report.title || null,
              classifierMethod: cls.method,
              classifierConfidence: cls.confidence,
              classifierReason: cls.reason,
              atomicTestId: link.atomicTestId,
              atomicTestName: link.atomicTestName,
              atomicTestNumber: link.atomicTestNumber,
              needsAtomic: link.needsAtomic,
              status: cls.libraryKey ? "pending" : "unrouted",
              dedupKey,
            },
          }).catch((e: any) => { if (e?.code !== "P2002") throw e; });
          created++;
          if (!cls.libraryKey) unrouted++;
        } catch {
          /* one bad technique must not abort the batch */
        }
      }
    }

    const durationMs = Date.now() - startedAt.getTime();
    await prisma.simWatcherRun.update({
      where: { id: run.id },
      data: { status: "completed", finishedAt: new Date(), reportsScanned, contributionsCreated: created, unrouted },
    });
    if (created > 0 || reportsScanned > 0) {
      void logEvent({
        category: "ti-watcher", action: "ti-watcher.scan.completed", actor: "system", status: "info",
        message: `scanned ${reportsScanned} reports → ${created} new contributions (${updated} updated, ${skipped} already-covered, ${unrouted} unrouted) since ${since.toISOString()}`,
        details: { reportsScanned, created, updated, skipped, unrouted, since: since.toISOString() },
      });
    }
    return { runId: run.id, reportsScanned, contributionsCreated: created, updated, skipped, unrouted, durationMs };
  } catch (err: any) {
    await prisma.simWatcherRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), errorMessage: String(err?.message || err).slice(0, 500) } }).catch(() => {});
    throw err;
  } finally {
    scanRunning = false;
  }
}

/** Fire-and-forget wrapper for sync entry-points — never throws. */
export async function runWatcherScanSafe(input: WatcherScanInput = {}): Promise<void> {
  try { await runWatcherScan(input); } catch { /* must not take down the caller */ }
}
