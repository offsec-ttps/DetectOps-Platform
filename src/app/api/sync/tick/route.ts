/**
 * GET|POST /api/sync/tick — run every due, enabled content-sync job (config/
 * sync-jobs.json). Auth: an admin session OR the x-worker-token: INTERNAL_WORKER_TOKEN
 * header (external cron), matching the other *-tick routes. Also starts the
 * in-process scheduler loop so syncing continues automatically after boot.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { requireRole } from "@/lib/auth-guard";
import { syncTick, ensureSyncScheduler } from "@/lib/sync/scheduler";

function workerAuthorized(req: NextRequest): boolean {
  const token = process.env.INTERNAL_WORKER_TOKEN;
  const presented = req.headers.get("x-worker-token") || "";
  if (!token || !presented) return false;
  try { return timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(token).digest()); }
  catch { return false; }
}

async function handle(req: NextRequest) {
  if (!workerAuthorized(req)) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }
  ensureSyncScheduler();
  return NextResponse.json(await syncTick());
}
export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
