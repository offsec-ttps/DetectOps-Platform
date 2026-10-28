/**
 * POST /api/rule-review  { assessmentId, model?, max? }
 *
 * Rule-review & recommendation agent: reviews a coverage assessment's items
 * that did NOT simulate or were NOT distinctly detected, and returns per-item
 * root cause + a deployable detection (telemetry source + Sigma + SPL), using
 * the configured LLM (RULE_REVIEW_MODEL / provider default). Admin-only — it
 * spends LLM tokens and reads detection content.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-guard";
import { reviewAssessmentGaps } from "@/lib/llm/generators/rule-review";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const assessmentId = String(body.assessmentId || "").trim();
  if (!/^[0-9a-f-]{36}$/.test(assessmentId)) {
    return NextResponse.json({ error: "valid assessmentId required" }, { status: 400 });
  }
  const model = typeof body.model === "string" && body.model ? body.model.slice(0, 120) : undefined;
  const max = Number.isFinite(body.max) ? Math.max(1, Math.min(200, Math.floor(body.max))) : 60;
  try {
    const run = await reviewAssessmentGaps({ assessmentId, model, max });
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), code: e?.code }, { status: e?.code === "missing_api_key" ? 400 : 500 });
  }
}
