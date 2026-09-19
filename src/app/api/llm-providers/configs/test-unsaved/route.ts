/**
 * POST /api/llm-providers/configs/test-unsaved
 *
 * Test a provider configuration BEFORE persisting it. The "Test before save"
 * UX: a user types a key + baseUrl + custom auth header template, clicks Test,
 * sees the probe result, then decides whether to save.
 *
 * Body:
 *   {
 *     kind:            ProviderKind   // required
 *     baseUrl?:        string
 *     apiKey?:         string         // plaintext; never logged, never persisted
 *     defaultModel?:   string         // becomes the testModel for the probe
 *     authHeaderName?: string         // for kind=custom
 *     authHeaderValue?: string        // template; {{key}} substituted
 *     modelsPath?:     string
 *   }
 *
 * Returns the same shape as the saved-config /test endpoint.
 *
 * Security: this endpoint accepts a plaintext key in the body. It is NEVER
 * persisted, NEVER appears in event-log details, and is held only for the
 * duration of the outbound probe.
 */

import { NextRequest, NextResponse } from "next/server";
import { testConnection, type ProviderKind } from "@/lib/llm/test-connection";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const KINDS = new Set([
  "anthropic", "openai", "openrouter", "nvidia", "ollama",
  "openai-compatible", "custom",
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || "");
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of ${[...KINDS].join("|")}` }, { status: 400 });
  }

  const result = await testConnection({
    kind: kind as ProviderKind,
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
    authHeaderName: typeof body.authHeaderName === "string" ? body.authHeaderName : undefined,
    authHeaderValue: typeof body.authHeaderValue === "string" ? body.authHeaderValue : undefined,
    modelsPath: typeof body.modelsPath === "string" ? body.modelsPath : undefined,
    testModel: typeof body.defaultModel === "string" && body.defaultModel.trim() ? body.defaultModel : undefined,
  });

  // Audit-log the test without recording the key
  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "system",
    action: "llm-providers.config.test-unsaved",
    actor: sessionUser?.email || "anonymous",
    status: result.ok ? "ok" : "error",
    targetType: "LlmProviderConfig",
    targetId: "(unsaved)",
    durationMs: result.latencyMs,
    message: `kind=${kind} · ${result.message.slice(0, 200)}`,
    details: { kind, ok: result.ok, model: result.details?.modelUsed, baseUrl: body.baseUrl || "(default)" },
  });

  return NextResponse.json(result);
}
