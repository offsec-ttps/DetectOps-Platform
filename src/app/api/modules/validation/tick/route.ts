/**
 * POST /api/modules/validation/tick — run one validation worker iteration.
 * Mirrors /api/detection-packs/jobs/tick. Callable manually or by a cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { tick } from "@/lib/modules/validation/worker";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const max = Number.isFinite(body.maxConcurrent) ? Math.max(1, Math.min(8, Math.round(body.maxConcurrent))) : 2;
  const result = await tick({ maxConcurrent: max });
  return NextResponse.json(result);
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const result = await tick({ maxConcurrent: 2 });
  return NextResponse.json(result);
}
