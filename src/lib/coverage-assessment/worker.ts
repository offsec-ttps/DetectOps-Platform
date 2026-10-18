import { prisma } from "@/lib/prisma";
import { detonateAtomicTest } from "@/lib/enterprise-use-cases/runner";
import { observeAtomic } from "./observe";
import { aggregate, type ItemLite } from "./aggregate";
import { renderReport, type RenderItem } from "./render";

// Tick-driven worker for long-running coverage sweeps (a full sweep is ~hours,
// so it cannot be a synchronous request). Mirrors the detection-packs worker and
// the scheduled-runs tick: claim the oldest active assessment, detonate +
// observe a small throttled batch of its pending items, persist each, and when
// none remain, aggregate + render the report. Idempotent and resumable — items
// are the source of truth, so a restart mid-sweep simply continues.

const THROTTLE_MS = 1200;   // between detonations — avoids WinRM auth hammering
const PER_ATOMIC_BUDGET_S = 45;
const OBSERVE_WINDOW_BUFFER_MIN = 10;  // added to the sweep duration for the visibility re-pass
const OBSERVE_SETTLE_MS = 90_000;      // let the SIEM forwarder/indexer catch up on the last detonations before observing

let ticking = false;
let loopStarted = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Process one batch. Returns whether it did work and how many items remain. */
export async function tick(maxItems = 4): Promise<{ worked: boolean; assessmentId?: string; remaining?: number }> {
  if (ticking) return { worked: false };
  ticking = true;
  try {
    // Promote the oldest queued assessment to running, else pick an already-running one.
    let a = await prisma.coverageAssessment.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
    if (a) {
      a = await prisma.coverageAssessment.update({ where: { id: a.id }, data: { status: "running", startedAt: a.startedAt ?? new Date() } });
    } else {
      a = await prisma.coverageAssessment.findFirst({ where: { status: "running" }, orderBy: { createdAt: "asc" } });
    }
    if (!a) return { worked: false };

    const env = a.environmentId ? await prisma.environmentTarget.findUnique({ where: { id: a.environmentId } }) : null;
    const siem = a.siemConnectionId ? await prisma.siemConnection.findUnique({ where: { id: a.siemConnectionId } }) : null;
    if (!env) {
      await prisma.coverageAssessment.update({ where: { id: a.id }, data: { status: "failed", error: "environment not found", completedAt: new Date() } });
      return { worked: true, assessmentId: a.id, remaining: 0 };
    }

    const batch = await prisma.coverageAssessmentItem.findMany({
      where: { assessmentId: a.id, status: "pending" }, orderBy: { order: "asc" }, take: maxItems,
    });

    for (const item of batch) {
      // Honour cancellation between items.
      const fresh = await prisma.coverageAssessment.findUnique({ where: { id: a.id }, select: { status: true } });
      if (!fresh || fresh.status === "cancelled") return { worked: true, assessmentId: a.id, remaining: 0 };

      await sleep(THROTTLE_MS);
      // Detonation only — telemetry observation happens in a full-window re-pass
      // at finalize (SIEM forwarder/indexing lag means an event is not yet
      // searchable 2–3s after detonation; the proven methodology queries the
      // whole sweep window once execution is done).
      const det = await detonateAtomicTest(env, item.tech, item.num, PER_ATOMIC_BUDGET_S);
      await prisma.coverageAssessmentItem.update({
        where: { id: item.id },
        data: { status: det.status, executed: det.executed, tail: det.tail.slice(0, 400), processedAt: new Date() },
      });
      await prisma.coverageAssessment.update({
        where: { id: a.id },
        data: {
          processed: { increment: 1 },
          executedCount: { increment: det.status === "executed" ? 1 : 0 },
          failedCount: { increment: det.status === "failed" ? 1 : 0 },
          naCount: { increment: det.status === "n/a" ? 1 : 0 },
          heartbeatAt: new Date(),
        },
      });
    }

    const remaining = await prisma.coverageAssessmentItem.count({ where: { assessmentId: a.id, status: "pending" } });
    if (remaining === 0) await finalize(a.id);
    return { worked: true, assessmentId: a.id, remaining };
  } finally {
    ticking = false;
  }
}

async function atomicCommand(tech: string, num: number): Promise<string | null> {
  const r = await prisma.atomicTest.findFirst({ where: { techniqueId: tech, testNumber: num }, select: { command: true } });
  return r?.command || null;
}

/** Observe telemetry for every executed item over the FULL sweep window, then
 * aggregate + render. Run once all items are detonated. */
async function finalize(id: string): Promise<void> {
  const a = await prisma.coverageAssessment.findUnique({ where: { id } });
  if (!a || a.status === "cancelled") return;
  await prisma.coverageAssessment.update({ where: { id }, data: { status: "rendering" } });

  // ── Visibility re-pass over the whole engagement window ──
  const siem = a.siemConnectionId ? await prisma.siemConnection.findUnique({ where: { id: a.siemConnectionId } }) : null;
  // Let the SIEM forwarder/indexer catch up on the final detonations so a short
  // sweep (where observe runs seconds after the last detonation) isn't fooled by
  // indexing lag into reporting a false blind spot.
  if (siem) await sleep(OBSERVE_SETTLE_MS);
  const startMs = (a.startedAt ?? a.createdAt).getTime();
  const windowMinutes = Math.max(15, Math.ceil((Date.now() - startMs) / 60_000) + OBSERVE_WINDOW_BUFFER_MIN);
  const executedItems = await prisma.coverageAssessmentItem.findMany({ where: { assessmentId: id, status: "executed" }, orderBy: { order: "asc" } });
  let visible = 0, generic = 0, absent = 0;
  for (const it of executedItems) {
    let bucket = "generic-only", count = 0, indicators: string[] = [];
    if (siem) {
      const cmd = (await atomicCommand(it.tech, it.num)) || "";
      const obs = await observeAtomic(siem, cmd, windowMinutes);
      bucket = obs.bucket; count = obs.count; indicators = obs.indicators;
    }
    if (bucket === "visible") visible++; else if (bucket === "absent") absent++; else generic++;
    await prisma.coverageAssessmentItem.update({
      where: { id: it.id },
      data: { observed: bucket === "visible", visBucket: bucket, obsCount: count, indicators: JSON.stringify(indicators) },
    });
  }
  await prisma.coverageAssessment.update({ where: { id }, data: { visibleCount: visible, genericCount: generic, absentCount: absent } });

  // Going-forward "tested on SAR" marker: when this sweep ran against a SAR lab,
  // every atomic that executed is now detonated-and-working on SAR — "detected"
  // if its distinctive indicator was visible in the SIEM, else "working". Keeps
  // the coverage badge live as assessments run (backfill handles history).
  const env = a.environmentId ? await prisma.environmentTarget.findUnique({ where: { id: a.environmentId } }) : null;
  const isSar = !!env && (/^sar/i.test(env.templateRef) || /sar/i.test(env.name) || env.hostname === "10.0.1.14");
  if (isSar) {
    const done = await prisma.coverageAssessmentItem.findMany({
      where: { assessmentId: id, status: "executed" },
      select: { tech: true, num: true, visBucket: true },
    });
    for (const it of done) {
      await prisma.atomicTest.updateMany({
        where: { techniqueId: it.tech, testNumber: it.num },
        data: {
          sarTested: true,
          sarStatus: it.visBucket === "visible" ? "detected" : "working",
          sarSource: "coverage",
          sarTestedAt: new Date(),
        },
      });
    }
  }

  const items = await prisma.coverageAssessmentItem.findMany({ where: { assessmentId: id }, orderBy: { order: "asc" } });

  const lite: ItemLite[] = items.map((i) => ({
    tech: i.tech, num: i.num, name: i.name, tactic: i.tactic, library: i.library,
    status: i.status, executed: i.executed, visBucket: i.visBucket,
    indicators: safeArr(i.indicators),
  }));
  const metrics = aggregate(lite);

  const renderItems: RenderItem[] = items.map((i) => ({
    tech: i.tech, num: i.num, name: i.name, tactic: i.tactic,
    status: i.status, executed: i.executed, observed: i.observed,
    vis_bucket: i.visBucket, vis_count: i.obsCount, indicators: safeArr(i.indicators), tail: i.tail,
  }));

  let reportPaths: Record<string, string> = {};
  let reportMd = "";
  try {
    const r = await renderReport({
      assessmentId: id, assessor: a.assessor, client: a.client, lab: a.lab,
      detectionNote: a.detectionNote, items: renderItems,
    });
    reportMd = r.markdown;
    if (r.md) reportPaths.md = r.md;
    if (r.docx) reportPaths.docx = r.docx;
    if (r.pdf) reportPaths.pdf = r.pdf;
  } catch (e: any) {
    reportMd = `Report render failed: ${e?.message || e}`;
  }

  await prisma.coverageAssessment.update({
    where: { id },
    data: {
      status: "completed", completedAt: new Date(),
      metrics: JSON.stringify(metrics), reportMd, reportPaths: JSON.stringify(reportPaths),
    },
  });
}

function safeArr(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

/** Start an in-process drive loop once (dev/self-hosted long-lived Node). The
 * tick endpoint can also drive it externally (cron / UI poll). */
export function ensureWorkerLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  const run = async () => {
    try { await tick(); } catch { /* swallow — next tick retries */ }
    setTimeout(run, 1500);
  };
  setTimeout(run, 500);
}
