/**
 * POST /api/replay/refresh — force re-scan of the attack_data repository.
 *   Body: { repoRoot?: string }  // optional admin override
 */

import { NextRequest, NextResponse } from "next/server";
import { scanRepo, clearCache, REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";
import { requireRole } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED) {
    return NextResponse.json({ enabled: false, error: "Replay feature disabled" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  // repoRoot makes the server walk + parse an arbitrary directory → admin only.
  if (body.repoRoot !== undefined) {
    const auth = await requireRole("admin");
    if (!auth.ok) return auth.response;
  }
  clearCache();
  const result = scanRepo({ repoRoot: body.repoRoot, forceRefresh: true });
  return NextResponse.json({
    success: result.status.exists,
    status: result.status,
    rowCount: result.rows.length,
  });
}
