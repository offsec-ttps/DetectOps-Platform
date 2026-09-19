/**
 * Detection Pack auto-pipeline worker.
 *
 *   tick()       — single iteration: claim ≤ N jobs, process each, return summary
 *   processOne() — internal: run the generator for one job, persist outcome
 *
 * Concurrency is naturally bounded by the tick interval × `maxConcurrent`.
 * No persistent semaphore needed — `tick()` claims at most N jobs per call
 * and `setInterval` reschedules every 30 s.
 *
 * A module-level mutex prevents two ticks from overlapping when one runs
 * long (e.g. a slow LLM provider). The mutex is reset on next-tick if the
 * holder errors so we don't deadlock.
 */

import { prisma } from "@/lib/prisma";
import { generateDetectionPack, DetectionPackError } from "./generator";
import { wouldExceedBudget, getBudgetSnapshot, type BudgetSnapshot } from "./budget";
import { logEvent } from "@/lib/event-log";
import { defaultProviderId } from "@/lib/llm";

const MAX_ATTEMPTS = 3;

let tickRunning = false;

export interface TickInput {
  maxConcurrent?: number;
}

export interface TickResult {
  claimed: number;
  completed: number;
  failed: number;
  requeued: number;                                           // transient failure → re-queued for a later attempt
  budgetExceeded: number;
  skipped: number;                                            // mutex held — tick was already running
  budget: BudgetSnapshot;
  durationMs: number;
}

export async function tick({ maxConcurrent = 2 }: TickInput = {}): Promise<TickResult> {
  const t0 = Date.now();
  if (tickRunning) {
    const snap = await getBudgetSnapshot();
    return { claimed: 0, completed: 0, failed: 0, requeued: 0, budgetExceeded: 0, skipped: 1, budget: snap, durationMs: 0 };
  }
  tickRunning = true;
  try {
    let snap = await getBudgetSnapshot();
    if (snap.exhausted) {
      // Convert any new "queued" jobs to budget-exceeded so the UI surfaces the state
      const flipped = await prisma.detectionPackJob.findMany({
        where: { status: "queued" }, take: maxConcurrent * 2, orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      for (const j of flipped) {
        await prisma.detectionPackJob.update({
          where: { id: j.id },
          data: {
            status: "budget-exceeded",
            errorMessage: `Daily token budget exhausted (${snap.usedTokens}/${snap.budget}). Resets at ${snap.resetsAt}.`,
            completedAt: new Date(),
          },
        });
      }
      void logEvent({
        category: "detection-pack",
        action: "detection-pack.job.budget-exceeded",
        actor: "system", status: "info",
        message: `Budget exhausted; flipped ${flipped.length} queued jobs`,
        details: { ...snap, jobsFlipped: flipped.length },
      });
      return { claimed: 0, completed: 0, failed: 0, requeued: 0, budgetExceeded: flipped.length, skipped: 0, budget: snap, durationMs: Date.now() - t0 };
    }

    // Claim up to N oldest queued jobs; serialise the status flip inside a transaction
    // so two parallel server instances (or tick races) can't double-claim the same job.
    const claimed = await prisma.$transaction(async (tx) => {
      const candidates = await tx.detectionPackJob.findMany({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
        take: maxConcurrent,
        select: { id: true },
      });
      if (candidates.length === 0) return [];
      const now = new Date();
      const updated: { id: string }[] = [];
      for (const c of candidates) {
        // Set running ONLY if still queued (handles race with manual tick)
        const r = await tx.detectionPackJob.updateMany({
          where: { id: c.id, status: "queued" },
          data: { status: "running", startedAt: now, attempts: { increment: 1 } },
        });
        if (r.count === 1) updated.push({ id: c.id });
      }
      return updated;
    });

    if (claimed.length === 0) {
      return { claimed: 0, completed: 0, failed: 0, requeued: 0, budgetExceeded: 0, skipped: 0, budget: snap, durationMs: Date.now() - t0 };
    }

    // Process claimed jobs SEQUENTIALLY. Each generation writes its token-usage
    // AiGeneration rows only after it finishes, and processOne's per-job budget
    // check reads committed usage — so running in parallel let N jobs all pass
    // the same pre-spend check and collectively blow the daily cap. Sequential
    // execution makes each job's budget check observe the prior jobs' spend.
    let completed = 0, failed = 0, requeued = 0, budgetExceeded = 0;
    for (const j of claimed) {
      let outcome: Awaited<ReturnType<typeof processOne>>;
      try { outcome = await processOne(j.id); } catch { outcome = "failed"; }
      if (outcome === "completed") completed++;
      else if (outcome === "budget-exceeded") budgetExceeded++;
      else if (outcome === "requeued") requeued++;
      else failed++;
    }

    snap = await getBudgetSnapshot();
    return { claimed: claimed.length, completed, failed, requeued, budgetExceeded, skipped: 0, budget: snap, durationMs: Date.now() - t0 };
  } finally {
    tickRunning = false;
  }
}

/**
 * Process one claimed job. The job is already in "running" state.
 * Returns the resulting status so tick() can tally.
 */
async function processOne(jobId: string): Promise<"completed" | "failed" | "budget-exceeded" | "requeued"> {
  const job = await prisma.detectionPackJob.findUnique({ where: { id: jobId } });
  if (!job) return "failed";

  // Per-job budget check — protects against many parallel jobs each blowing the cap
  const { exceed, snapshot } = await wouldExceedBudget();
  if (exceed) {
    await prisma.detectionPackJob.update({
      where: { id: jobId },
      data: {
        status: "budget-exceeded",
        errorMessage: `Daily token budget would be exceeded (${snapshot.usedTokens}/${snapshot.budget} + ~${snapshot.perJobEstimate}).`,
        completedAt: new Date(),
      },
    });
    void logEvent({
      category: "detection-pack",
      action: "detection-pack.job.budget-exceeded",
      actor: "system", status: "info",
      targetType: "DetectionPackJob", targetId: jobId,
      message: `Job ${jobId.slice(0, 8)} skipped — budget would exceed`,
      details: { ...snapshot, jobId, sourceTable: job.sourceTable, sourceRefId: job.sourceRefId },
    });
    return "budget-exceeded";
  }

  try {
    const result = await generateDetectionPack({
      sourceType: job.sourceType as "ti" | "rule",
      sourceTable: job.sourceTable,
      sourceRefId: job.sourceRefId,
      // Don't pass a provider here — let generateDetectionPack call
      // smartDefaultProvider() so the auto-pipeline picks whatever the
      // operator has configured (env or DB) rather than always Anthropic.
      provider: undefined,
      actor: "auto-pipeline",
    });
    await prisma.detectionPackJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        completedAt: new Date(),
        packId: result.packId,
        costEstimateUsd: result.totalCostUsd,
      },
    });
    void logEvent({
      category: "detection-pack",
      action: "detection-pack.job.completed",
      actor: "system", status: "ok",
      targetType: "DetectionPackJob", targetId: jobId,
      message: `pack ${result.packId.slice(0, 8)} · $${result.totalCostUsd.toFixed(4)}`,
      details: {
        jobId, packId: result.packId,
        cost: result.totalCostUsd,
        tokens: result.totalTokens,
        sourceTable: job.sourceTable, sourceRefId: job.sourceRefId,
      },
    });
    return "completed";
  } catch (err) {
    const message = err instanceof DetectionPackError
      ? `[${err.code}] ${err.message}`
      : ((err as Error).message || String(err));
    const newAttempts = job.attempts;
    const willRetry = newAttempts < MAX_ATTEMPTS && isRetryable(err);
    await prisma.detectionPackJob.update({
      where: { id: jobId },
      data: {
        status: willRetry ? "queued" : "failed",
        errorMessage: message.slice(0, 1000),
        completedAt: willRetry ? null : new Date(),
        startedAt: willRetry ? null : job.startedAt,
      },
    });
    void logEvent({
      category: "detection-pack",
      action: willRetry ? "detection-pack.job.retry" : "detection-pack.job.failed",
      actor: "system", status: "error",
      targetType: "DetectionPackJob", targetId: jobId,
      message: `attempt ${newAttempts}/${MAX_ATTEMPTS}: ${message.slice(0, 160)}`,
      details: { jobId, attempts: newAttempts, willRetry, sourceTable: job.sourceTable, sourceRefId: job.sourceRefId, error: message.slice(0, 600) },
    });
    return willRetry ? "requeued" : "failed";
  }
}

/**
 * Tell apart transient errors (retry) from permanent ones (fail fast).
 *
 * Retryable: LLM/network failures, provider overload.
 * NOT retryable: missing API key (config won't fix itself between ticks),
 * unknown provider, source-not-found, malformed tool output.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof DetectionPackError) {
    return err.code === "pack-llm-failed";
  }
  // Generic Errors from upstream (network glitches, provider 5xx) → retry once
  return true;
}
