/**
 * POST /api/llm-providers/configs/[id]/test
 *
 * Connectivity test using the STORED config. Decrypts the API key in-process,
 * fires a minimal probe (chat completion / messages call / `/api/tags` for
 * Ollama), records latency + outcome on the row, and returns the result.
 *
 * Body (optional): { testModel?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { testConnection, type ProviderKind } from "@/lib/llm/test-connection";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const row = await prisma.llmProviderConfig.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await testConnection({
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    apiKeyEnc: row.apiKeyEnc,
    authHeaderName: row.authHeaderName,
    authHeaderValue: row.authHeaderValue,
    modelsPath: row.modelsPath,
    testModel: typeof body.testModel === "string" && body.testModel.trim() ? body.testModel : (row.defaultModel || undefined),
  });

  await prisma.llmProviderConfig.update({
    where: { id },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestLatency: result.latencyMs,
      lastTestMessage: result.message.slice(0, 500),
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "system",
    action: "llm-providers.config.test",
    actor: sessionUser?.email || "anonymous",
    status: result.ok ? "ok" : "error",
    targetType: "LlmProviderConfig",
    targetId: id,
    durationMs: result.latencyMs,
    message: result.message,
    details: { kind: row.kind, ok: result.ok, model: result.details?.modelUsed },
  });

  return NextResponse.json(result);
}
