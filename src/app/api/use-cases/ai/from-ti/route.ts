/**
 * POST /api/use-cases/ai/from-ti
 *
 * Body: { threatIntelReportId, frameworks?, withDetectionSamples?, model? }
 * Returns: { useCaseId, atomicGenerationId?, purplesharpGenerationId?,
 *            detectionsGenerationId?, totalCostUsd, totalTokens }
 *
 * Persists a UseCase + Playbooks + AiGeneration rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateFromTi } from "@/lib/llm/generators/ti-to-playbook";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const threatIntelReportId = String(body.threatIntelReportId || "");
  if (!threatIntelReportId) {
    return NextResponse.json({ error: "threatIntelReportId is required" }, { status: 400 });
  }
  const frameworks = Array.isArray(body.frameworks)
    ? body.frameworks.filter((f: unknown): f is "atomic" | "purplesharp" =>
        f === "atomic" || f === "purplesharp")
    : undefined;
  const withDetectionSamples = body.withDetectionSamples !== false;
  const model = typeof body.model === "string" ? body.model : undefined;

  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await generateFromTi({
      actor: sessionUser?.email || "anonymous",
      threatIntelReportId,
      frameworks,
      withDetectionSamples,
      model,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err?.status || (err?.code === "missing_api_key" ? 503 : 500);
    return NextResponse.json({ error: err?.message || String(err), code: err?.code || null }, { status });
  }
}
