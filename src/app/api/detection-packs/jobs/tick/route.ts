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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const maxConcurrent = typeof body.maxConcurrent === "number" ? body.maxConcurrent : undefined;
  const includeBackstop = req.nextUrl.searchParams.get("backstop") === "1";

  const result = await tick({ maxConcurrent });

  let backstop = null;
  if (includeBackstop) {
    backstop = await runBackstop({});
  }
  return NextResponse.json({ tick: result, backstop });
}
