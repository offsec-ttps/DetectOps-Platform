/**
 * POST /api/llm-providers/test
 *
 * Body: { provider: ProviderId, model?: string }
 *
 * Fires a tiny forced-tool-call against the chosen provider so the UI can
 * surface a "✓ connected · X tok · $Y" badge per provider. The dummy tool
 * just asks for an integer; cheap to run even on paid models.
 *
 * Returns: { ok: true, model, inputTokens, outputTokens, costUsd, durationMs }
 *       or { ok: false, error, code }
 */

import { NextRequest, NextResponse } from "next/server";
import { runTool, PROVIDERS, LlmProviderError, type ProviderId } from "@/lib/llm";
import type { Tool } from "@/lib/llm/providers/types";

const PING_TOOL: Tool = {
  name: "emit_ping",
  description: "Return a single integer to verify connectivity.",
  input_schema: {
    type: "object",
    required: ["answer"],
    properties: {
      answer: { type: "integer", description: "Return exactly the integer 42." },
    },
  } as unknown as Record<string, unknown>,
};

const PING_SYSTEM = "You are a connectivity test. Use the emit_ping tool. Return answer=42 exactly.";
const PING_USER   = "Connectivity probe — return 42 via the emit_ping tool.";

const VALID = new Set<ProviderId>(["anthropic", "openai", "openrouter", "nvidia", "ollama"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider as ProviderId | undefined;
  if (!provider || !VALID.has(provider)) {
    return NextResponse.json({ error: `provider must be one of ${[...VALID].join("|")}` }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model : undefined;

  const t0 = Date.now();
  try {
    const result = await runTool<{ answer: number }>({
      provider,
      model,
      system: PING_SYSTEM,
      user: PING_USER,
      tool: PING_TOOL,
      maxTokens: 256,
    });
    return NextResponse.json({
      ok: true,
      provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      durationMs: Date.now() - t0,
      sample: result.data,
    });
  } catch (err) {
    if (err instanceof LlmProviderError) {
      const status = err.code === "missing_api_key" ? 503
                   : err.code === "unknown_provider" ? 400
                   : 500;
      return NextResponse.json({ ok: false, error: err.message, code: err.code, provider }, { status });
    }
    return NextResponse.json({
      ok: false,
      error: (err as Error).message || String(err),
      provider,
    }, { status: 500 });
  }
}
