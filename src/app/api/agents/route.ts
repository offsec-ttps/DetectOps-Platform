/**
 * GET /api/agents — real agent-workflow runs, derived from SigmaGen pipeline runs.
 *
 * Each SigmaGenRun is one multi-agent workflow; its `steps[]` are the agent
 * stages (intel → map → use-case → detection → simulation → validation).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

interface Step { agent: string; label: string; status: string; startedAt?: string; completedAt?: string; summary?: string; }

// SigmaGenRun.status values (schema): queued | running | completed | failed |
// budget-exceeded. Everything that isn't still queued/running is terminal and
// maps to a completed/failed pill — otherwise a finished run spins forever.
const TERMINAL_STATUS: Record<string, "completed" | "failed"> = {
  completed: "completed",
  failed: "failed",
  error: "failed",
  "budget-exceeded": "failed",
  cancelled: "failed",
};

function fmtDuration(start?: Date | null, end?: Date | null, live = false): string {
  if (!start) return "";
  // Terminal run with no completion timestamp: duration is unknown — don't tick
  // it up against the wall clock on every poll.
  if (!end && !live) return "";
  const e = end ? end.getTime() : Date.now();
  const ms = e - start.getTime();
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export async function GET() {
  const runs = await prisma.sigmaGenRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

  const agentRuns = runs.map((r) => {
    const steps = safeJson<Step[]>(r.steps, []);
    const intel = safeJson<{ threatActor?: string }>(r.intelJson, {});
    const name = r.inputTitle
      ? `${intel.threatActor ? intel.threatActor + ": " : ""}${r.inputTitle}`.slice(0, 120)
      : `SigmaGen run ${r.id.slice(0, 8)}`;
    const uiStatus = TERMINAL_STATUS[r.status] ?? "in_progress";
    const live = !(r.status in TERMINAL_STATUS);
    return {
      id: r.id,
      name,
      status: uiStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      duration: fmtDuration(r.startedAt, r.completedAt, live),
      costUsd: r.costUsd,
      steps: steps.map((s) => ({
        agent: s.agent,
        label: s.label,
        status: s.status,
        input: null,
        output: s.summary || null,
      })),
    };
  });

  return NextResponse.json({ agentRuns });
}
