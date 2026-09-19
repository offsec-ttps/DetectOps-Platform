/**
 * GET /api/llm-providers/configs/[id]/models
 *
 * Live list of models available to this provider configuration.
 *   - Anthropic: returns a curated static list (Anthropic has no list endpoint)
 *   - Ollama:    GET /api/tags on the configured baseUrl
 *   - Everything else: GET /v1/models (or modelsPath when set) with the
 *                       config's auth header
 *
 * Returns: { ok, latencyMs, models: [{id, label?, context?}], message }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listModels, type ProviderKind } from "@/lib/llm/test-connection";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.llmProviderConfig.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await listModels({
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    apiKeyEnc: row.apiKeyEnc,
    authHeaderName: row.authHeaderName,
    authHeaderValue: row.authHeaderValue,
    modelsPath: row.modelsPath,
  });
  return NextResponse.json(result);
}
