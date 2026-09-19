/**
 * POST /api/detection-packs/generate-from-ti
 *
 * Body: {
 *   threatIntelReportId: string,
 *   provider?: "anthropic" | "openai" | "openrouter" | "nvidia" | "ollama",
 *   irpProvider?: same,
 *   packModel?: string,
 *   irpModel?: string,
 * }
 *
 * Returns: { packId, totalCostUsd, totalTokens, costBreakdown }
 *
 * Errors:
 *   503 — chosen provider not configured (missing API key / base URL)
 *   404 — ThreatIntelReport not found
 *   500 — LLM or persistence failure
 */

import { NextRequest, NextResponse } from "next/server";
import { generateDetectionPack, DetectionPackError } from "@/lib/detection-packs/generator";
import { getSessionUser } from "@/lib/auth";
import type { ProviderId } from "@/lib/llm";

const VALID_PROVIDERS = new Set<ProviderId>(["anthropic", "openai", "openrouter", "nvidia", "ollama"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const threatIntelReportId = String(body.threatIntelReportId || "").trim();
  if (!threatIntelReportId) {
    return NextResponse.json({ error: "threatIntelReportId is required" }, { status: 400 });
  }

  const provider = (typeof body.provider === "string" ? body.provider : undefined) as ProviderId | undefined;
  const irpProvider = (typeof body.irpProvider === "string" ? body.irpProvider : undefined) as ProviderId | undefined;
  if (provider && !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: `provider must be one of ${[...VALID_PROVIDERS].join("|")}` }, { status: 400 });
  }
  if (irpProvider && !VALID_PROVIDERS.has(irpProvider)) {
    return NextResponse.json({ error: `irpProvider must be one of ${[...VALID_PROVIDERS].join("|")}` }, { status: 400 });
  }

  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await generateDetectionPack({
      sourceType: "ti",
      sourceTable: "ThreatIntelReport",
      sourceRefId: threatIntelReportId,
      provider,
      irpProvider,
      packModel: typeof body.packModel === "string" ? body.packModel : undefined,
      irpModel:  typeof body.irpModel  === "string" ? body.irpModel  : undefined,
      actor: sessionUser?.email || "anonymous",
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DetectionPackError) {
      const status = err.code === "missing_api_key" ? 503
                   : err.code === "source-not-found" ? 404
                   : err.code === "unknown_provider" ? 400
                   : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ error: (err as Error).message || String(err) }, { status: 500 });
  }
}
