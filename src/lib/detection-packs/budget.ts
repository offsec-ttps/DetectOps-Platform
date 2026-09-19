/**
 * Daily token budget guard.
 *
 * Sums `inputTokens + outputTokens` from AiGeneration rows whose
 * `generator` starts with "detection-pack:" within the current UTC day.
 * The worker calls `wouldExceed()` before claiming a job; if true, the job
 * is marked status="budget-exceeded" instead of executing.
 *
 * Configure via env:
 *   DETECTION_PACK_DAILY_TOKEN_BUDGET=500000   (default; 0 disables)
 *   DETECTION_PACK_PER_JOB_ESTIMATE=8000        (conservative reserve per job)
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_DAILY_TOKEN_BUDGET = 500_000;
const DEFAULT_PER_JOB_ESTIMATE = 8_000;

export function getBudget(): number {
  const raw = process.env.DETECTION_PACK_DAILY_TOKEN_BUDGET;
  if (raw === undefined || raw === "") return DEFAULT_DAILY_TOKEN_BUDGET;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_TOKEN_BUDGET;
  return n;
}

export function getPerJobEstimate(): number {
  const raw = process.env.DETECTION_PACK_PER_JOB_ESTIMATE;
  if (raw === undefined || raw === "") return DEFAULT_PER_JOB_ESTIMATE;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PER_JOB_ESTIMATE;
}

function utcMidnight(d: Date = new Date()): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

/** Return today's UTC token totals across all detection-pack generations. */
export async function getTodayUsage(): Promise<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  generationCount: number;
}> {
  const since = utcMidnight();
  const rows = await prisma.aiGeneration.findMany({
    where: {
      generator: { startsWith: "detection-pack:" },
      createdAt: { gte: since },
    },
    select: { inputTokens: true, outputTokens: true, costUsd: true },
  });
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const r of rows) {
    inputTokens += r.inputTokens || 0;
    outputTokens += r.outputTokens || 0;
    costUsd += r.costUsd || 0;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    generationCount: rows.length,
  };
}

export interface BudgetSnapshot {
  budget: number;             // hard cap (0 = disabled)
  perJobEstimate: number;
  usedTokens: number;         // today total
  remainingTokens: number;    // budget - used; 0 when budget=0 means disabled (treated as Infinity)
  exhausted: boolean;
  costUsd: number;
  generationCount: number;
  resetsAt: string;           // ISO of next UTC midnight
}

export async function getBudgetSnapshot(): Promise<BudgetSnapshot> {
  const budget = getBudget();
  const perJobEstimate = getPerJobEstimate();
  const usage = await getTodayUsage();
  const reset = new Date(); reset.setUTCDate(reset.getUTCDate() + 1); reset.setUTCHours(0, 0, 0, 0);
  return {
    budget,
    perJobEstimate,
    usedTokens: usage.totalTokens,
    remainingTokens: budget === 0 ? Infinity : Math.max(0, budget - usage.totalTokens),
    exhausted: budget > 0 && usage.totalTokens >= budget,
    costUsd: usage.costUsd,
    generationCount: usage.generationCount,
    resetsAt: reset.toISOString(),
  };
}

/**
 * Would running ONE more job push us over the budget?
 * `extraEstimate` defaults to the per-job estimate; callers can override
 * after a more informed projection (e.g. when re-running a known-large
 * source).
 */
export async function wouldExceedBudget(extraEstimate?: number): Promise<{ exceed: boolean; snapshot: BudgetSnapshot }> {
  const snap = await getBudgetSnapshot();
  if (snap.budget === 0) return { exceed: false, snapshot: snap };          // disabled
  const need = (extraEstimate ?? snap.perJobEstimate);
  return { exceed: snap.usedTokens + need > snap.budget, snapshot: snap };
}
