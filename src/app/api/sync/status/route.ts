/** GET /api/sync/status — sync config + last-run state (admin). Starts the loop. */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { syncStatus, ensureSyncScheduler } from "@/lib/sync/scheduler";

export async function GET() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  ensureSyncScheduler();
  return NextResponse.json(syncStatus());
}
