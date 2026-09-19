/**
 * Anthropic adapter — delegates to the existing helper in
 * `src/lib/llm/anthropic.ts` so callers that imported `runTool` from there
 * before Phase 2 keep working unchanged.
 */

import { runTool as runToolAnthropic, isConfigured as isConfiguredAnthropic } from "@/lib/llm/anthropic";
import { resolveRuntime } from "@/lib/llm/db-config";
import type { LlmProvider } from "./types";

const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-4-7":     { in: 15.00, out: 75.00 },
  "claude-sonnet-4-6":   { in:  3.00, out: 15.00 },
  "claude-haiku-4-5":    { in:  0.80, out:  4.00 },
};

export const anthropicProvider: LlmProvider = {
  id: "anthropic",
  label: "Anthropic Claude",
  isConfigured: () => isConfiguredAnthropic(),
  defaultModel: () => process.env.ANTHROPIC_MODEL_DEFAULT || "claude-sonnet-4-6",
  pricingPerMTokens: (model) => PRICING[model] || null,
  async runTool(input) {
    // DB config can override ANTHROPIC_API_KEY + base URL + default model.
    const rt = await resolveRuntime("anthropic", {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: "",                                            // SDK default
      defaultModel: anthropicProvider.defaultModel(),
    });
    return runToolAnthropic({
      ...input,
      model: input.model || rt.defaultModel,
      // Only override when DB has its own — keeps the env singleton path
      // unchanged when no DB config exists for "anthropic".
      apiKey: rt.apiKey || undefined,
      baseURL: rt.baseUrl || undefined,
    });
  },
};
