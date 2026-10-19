import { prisma } from "@/lib/prisma";
import { detonateAtomicTest } from "@/lib/enterprise-use-cases/runner";
import { snapshotActiveLab } from "./snapshot";
import { observeAtomic } from "./observe";
import { aggregate, type ItemLite } from "./aggregate";
import { renderReport, renderBrandedReport, type RenderItem } from "./render";

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
const STALE_CLAIM_MS = 10 * 60_000;    // a claimed-but-unfinished item is reclaimable after this (crash/restart safety)

let ticking = false;
let loopStarted = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Recompute an assessment's roll-up counters from its item rows — authoritative,
 * so progress stays exact regardless of how many times an item was touched. */
async function syncCounters(id: string): Promise<void> {
  const where = (status: string) => ({ assessmentId: id, status });
  const [executedCount, failedCount, naCount, pending] = await Promise.all([
    prisma.coverageAssessmentItem.count({ where: where("executed") }),
    prisma.coverageAssessmentItem.count({ where: where("failed") }),
    prisma.coverageAssessmentItem.count({ where: where("n/a") }),
    prisma.coverageAssessmentItem.count({ where: where("pending") }),
  ]);
  const total = await prisma.coverageAssessmentItem.count({ where: { assessmentId: id } });
  await prisma.coverageAssessment.update({
    where: { id },
    data: { processed: total - pending, executedCount, failedCount, naCount, atomicsTotal: total, heartbeatAt: new Date() },
  });
}

/** Promote a queued assessment to running, taking its pre-simulation snapshot once. */
async function promoteAssessment(a: any): Promise<any> {
  a = await prisma.coverageAssessment.update({ where: { id: a.id }, data: { status: "running", startedAt: a.startedAt ?? new Date() } });
  // Pre-simulation snapshot: a rollback point taken BEFORE the first atomic
  // detonates, so the analyst can restore the lab and knows the run is what
  // changed it. Once only (guarded by empty snapshotName); never blocks the sweep.
  if (a.snapshotRequested && !a.snapshotName) {
    try {
      const snap = await snapshotActiveLab(a.id.slice(0, 8));
      if (snap.name) a = await prisma.coverageAssessment.update({ where: { id: a.id }, data: { snapshotName: snap.name } });
    } catch { /* best-effort */ }
  }
  return a;
}

/** Detonate one batch for a single assessment against its own host. Returns how
 * many items remain pending. Designed to run concurrently for DIFFERENT hosts —
 * the per-item compare-and-set claim keeps two drivers off the same row, and each
 * call targets its own environment, so two labs detonate in parallel while a
 * single host stays sequential (one assessment per host per tick). */
async function processAssessmentBatch(a: any, maxItems: number): Promise<{ assessmentId: string; remaining: number }> {
  const env = a.environmentId ? await prisma.environmentTarget.findUnique({ where: { id: a.environmentId } }) : null;
  if (!env) {
    await prisma.coverageAssessment.update({ where: { id: a.id }, data: { status: "failed", error: "environment not found", completedAt: new Date() } });
    return { assessmentId: a.id, remaining: 0 };
  }

  // CLAIM items before detonating (compare-and-set on processedAt) so overlapping
  // drivers never detonate the same row twice; a claim older than STALE_CLAIM_MS is
  // reclaimable so a crashed run doesn't strand items as permanently pending.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const candidates = await prisma.coverageAssessmentItem.findMany({
    where: { assessmentId: a.id, status: "pending", OR: [{ processedAt: null }, { processedAt: { lt: staleBefore } }] } as any,
    orderBy: { order: "asc" }, take: maxItems,
  });
  const batch: typeof candidates = [];
  for (const c of candidates) {
    const claim = await prisma.coverageAssessmentItem.updateMany({
      where: { id: c.id, status: "pending", OR: [{ processedAt: null }, { processedAt: { lt: staleBefore } }] } as any,
      data: { processedAt: new Date() },
    });
    if (claim.count === 1) batch.push(c);
  }

  for (const item of batch) {
    const fresh = await prisma.coverageAssessment.findUnique({ where: { id: a.id }, select: { status: true } });
    if (!fresh || fresh.status === "cancelled") return { assessmentId: a.id, remaining: 0 };
    await sleep(THROTTLE_MS);
    const det = await detonateAtomicTest(env, item.tech, item.num, PER_ATOMIC_BUDGET_S);
    await prisma.coverageAssessmentItem.update({
      where: { id: item.id },
      data: { status: det.status, executed: det.executed, tail: det.tail.slice(0, 400), processedAt: new Date() },
    });
  }

  await syncCounters(a.id);
  const remaining = await prisma.coverageAssessmentItem.count({ where: { assessmentId: a.id, status: "pending" } });
  if (remaining === 0) await finalize(a.id);
  return { assessmentId: a.id, remaining };
}

/** Process one batch PER DISTINCT HOST, concurrently. Different labs (e.g. the
 * 10.0.1.x SAR DC and a 192.168.56.x Fleet DC) detonate in parallel; each host
 * runs its own assessments one at a time (oldest first). Returns whether any work
 * was done and the total remaining across the hosts touched this tick. */
export async function tick(maxItems = 4): Promise<{ worked: boolean; assessmentId?: string; remaining?: number; hosts?: number }> {
  if (ticking) return { worked: false };
  ticking = true;
  try {
    const running = await prisma.coverageAssessment.findMany({ where: { status: "running" }, orderBy: { createdAt: "asc" } });
    const runningHosts = new Set(running.map((r) => r.environmentId || "none"));
    // Promote the oldest queued assessment for any host that has none running yet,
    // so a newly-queued second lab starts immediately alongside the first.
    const queued = await prisma.coverageAssessment.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
    for (const q of queued) {
      const h = q.environmentId || "none";
      if (!runningHosts.has(h)) {
        running.push(await promoteAssessment(q));
        runningHosts.add(h);
      }
    }
    if (!running.length) return { worked: false };

    // One assessment per host (the oldest), processed concurrently across hosts.
    const perHost = new Map<string, any>();
    for (const r of running) {
      const h = r.environmentId || "none";
      if (!perHost.has(h)) perHost.set(h, r);
    }
    const targets = [...perHost.values()];
    const results = await Promise.all(
      targets.map((a) => processAssessmentBatch(a, maxItems).catch((e) => ({ assessmentId: a.id, remaining: -1, error: String(e?.message || e) })))
    );
    const remaining = results.reduce((s, r) => s + Math.max(0, (r as any).remaining || 0), 0);
    return { worked: true, assessmentId: results[0]?.assessmentId, remaining, hosts: targets.length };
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
    let eventCodes: string[] = [], sources: string[] = [];
    if (siem) {
      const cmd = (await atomicCommand(it.tech, it.num)) || "";
      const obs = await observeAtomic(siem, cmd, windowMinutes);
      bucket = obs.bucket; count = obs.count; indicators = obs.indicators;
      eventCodes = obs.eventCodes || []; sources = obs.sources || [];
    }
    if (bucket === "visible") visible++; else if (bucket === "absent") absent++; else generic++;
    await prisma.coverageAssessmentItem.update({
      where: { id: it.id },
      data: {
        observed: bucket === "visible", visBucket: bucket, obsCount: count,
        indicators: JSON.stringify(indicators),
        obsEventCodes: JSON.stringify(eventCodes),
        obsSources: JSON.stringify(sources),
      },
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
    event_codes: safeArr(i.obsEventCodes), sources: safeArr(i.obsSources),
  }));

  let reportPaths: Record<string, unknown> = {};
  let reportMd = "";
  try {
    const r = await renderReport({
      assessmentId: id, assessor: a.assessor, client: a.client, lab: a.lab,
      // Lead the report branding with the assessing firm (assessor, e.g. RuSecure)
      // and the client; DetectOps is credited as the platform in the cover block.
      brand: a.assessor || "RuSecure", siem: siem?.kind || "splunk",
      detectionNote: a.detectionNote, items: renderItems,
    });
    reportMd = r.markdown;
    // Nested by report type so the UI can offer both Executive + Technical in
    // each format; keep flat md/docx/pdf (= technical) for backward compatibility.
    reportPaths = { executive: r.executive, technical: r.technical, ...r.technical };
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

  // Branded magazine-style report — runs AFTER the row (metrics + items) is saved,
  // since the generator reads them from the DB. Appended to reportPaths so the UI
  // can offer it; a failure here never fails the assessment.
  try {
    const b = await renderBrandedReport(id);
    if (b.pdf || b.html) {
      const branded: Record<string, string> = {};
      if (b.pdf) branded.pdf = b.pdf;
      if (b.html) branded.html = b.html;
      reportPaths.branded = branded;
      await prisma.coverageAssessment.update({ where: { id }, data: { reportPaths: JSON.stringify(reportPaths) } });
    }
  } catch { /* branded report is best-effort */ }
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
