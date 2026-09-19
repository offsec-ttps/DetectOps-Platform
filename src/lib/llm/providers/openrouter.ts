/**
 * OpenRouter adapter — proxy in front of dozens of providers, exposes the
 * OpenAI Chat Completions shape. Pricing varies per model; OpenRouter
 * reports `usage.total_cost` so we surface that directly.
 *
 * https://openrouter.ai/docs
 */

import { runToolOpenAiCompatible } from "./openai-compatible";
import { resolveRuntime } from "@/lib/llm/db-config";
import type { LlmProvider } from "./types";

export const openrouterProvider: LlmProvider = {
  id: "openrouter",
  label: "OpenRouter",
  isConfigured: () => !!process.env.OPENROUTER_API_KEY,
  defaultModel: () => process.env.OPENROUTER_MODEL_DEFAULT || "openai/gpt-4o-mini",
  // Per-model pricing is huge and changes; rely on the cost field in the response.
  pricingPerMTokens: () => null,
  async runTool(input) {
    const rt = await resolveRuntime("openrouter", {
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: openrouterProvider.defaultModel(),
    });
    const model = input.model || rt.defaultModel;
    return runToolOpenAiCompatible({
      baseUrl: rt.baseUrl,
      apiKey: rt.apiKey,
      modelOverride: model,
      extraHeaders: {
        // OpenRouter optional analytics headers — identify the app in their dashboard
        "HTTP-Referer": process.env.OPENROUTER_APP_URL || "https://detectops.local",
        "X-Title": process.env.OPENROUTER_APP_NAME || "DetectOps",
      },
      pricing: null,
    }, { ...input, model });
  },
};
