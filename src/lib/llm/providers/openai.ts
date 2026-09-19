/**
 * OpenAI adapter — native function calling via the v1/chat/completions REST.
 * No SDK dependency; pure fetch through the shared OpenAI-compatible helper.
 *
 * Pricing as of 2025-Q1 — keep in sync with https://openai.com/pricing
 */

import { runToolOpenAiCompatible } from "./openai-compatible";
import { resolveRuntime } from "@/lib/llm/db-config";
import type { LlmProvider } from "./types";

const PRICING: Record<string, { in: number; out: number }> = {
  // $/M tokens
  "gpt-4o":            { in:  2.50, out: 10.00 },
  "gpt-4o-mini":       { in:  0.15, out:  0.60 },
  "gpt-4.1":           { in:  2.00, out:  8.00 },
  "gpt-4.1-mini":      { in:  0.40, out:  1.60 },
  "gpt-4.1-nano":      { in:  0.10, out:  0.40 },
  "o3-mini":           { in:  1.10, out:  4.40 },
};

export const openaiProvider: LlmProvider = {
  id: "openai",
  label: "OpenAI",
  // The UI may now also enable this provider when a DB config exists for it
  // (see GET /api/llm-providers — `configured` is env|db). isConfigured() stays
  // sync env-only since the runtime resolver handles DB at call time.
  isConfigured: () => !!process.env.OPENAI_API_KEY,
  defaultModel: () => process.env.OPENAI_MODEL_DEFAULT || "gpt-4o-mini",
  pricingPerMTokens: (model) => PRICING[model] || null,
  async runTool(input) {
    // DB config (when present) overrides the env defaults.
    const rt = await resolveRuntime("openai", {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1",
      defaultModel: openaiProvider.defaultModel(),
    });
    const model = input.model || rt.defaultModel;
    const pricing = PRICING[model] || null;
    return runToolOpenAiCompatible({
      baseUrl: rt.baseUrl,
      apiKey: rt.apiKey,
      modelOverride: model,
      pricing,
    }, { ...input, model });
  },
};
