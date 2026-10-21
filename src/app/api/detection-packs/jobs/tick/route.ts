/**
 * POST /api/detection-packs/jobs/tick
 *
 * Manually trigger one worker tick. Useful for tests, CI hooks, and the
 * "Tick now" button on the queue UI. Body is optional:
 *
 *   { maxConcurrent?: number }
 *
 * Also triggers a backstop sweep when `?backstop=1` is set so admins can
 * sanity-check the recovery path without waiting 5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/detection-packs/worker";
import { runBackstop } from "@/lib/detection-packs/backstop";
import { requireRole } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // Clamp: an unbounded value would fan out that many concurrent LLM jobs.
  const maxConcurrent = typeof body.maxConcurrent === "number" && Number.isFinite(body.maxConcurrent)
    ? Math.max(1, Math.min(8, Math.floor(body.maxConcurrent))) : undefined;
  const includeBackstop = req.nextUrl.searchParams.get("backstop") === "1";
  if (includeBackstop) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }

  const result = await tick({ maxConcurrent });

  let backstop = null;
  if (includeBackstop) {
    backstop = await runBackstop({});
  }
  return NextResponse.json({ tick: result, backstop });
}
