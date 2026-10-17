import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { tick } from "@/lib/coverage-assessment/worker";

// POST /api/coverage-assessments/tick — drive the sweep worker one batch.
// Admin session OR x-worker-token: INTERNAL_WORKER_TOKEN (for an external cron).
// The create route also starts an in-process loop, so this is a belt-and-braces
// manual/cron drive (the UI may also poke it while a sweep is running).
export async function POST(req: NextRequest) {
  const workerToken = process.env.INTERNAL_WORKER_TOKEN;
  const presented = req.headers.get("x-worker-token");
  if (!(workerToken && presented && presented === workerToken)) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }
  const max = Number(new URL(req.url).searchParams.get("max")) || 4;
  const res = await tick(Math.max(1, Math.min(20, max)));
  return NextResponse.json(res);
}
