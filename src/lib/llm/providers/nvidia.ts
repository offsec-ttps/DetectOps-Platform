/**
 * NVIDIA NIM adapter — OpenAI-compatible inference at
 * https://integrate.api.nvidia.com/v1
 *
 * Many NIM-served models support function calling (llama-3.x, mistral-large,
 * etc.). For models that don't, the upstream returns a 400 and the caller
 * can fall back to a different model via `model:` override.
 *
 * NVIDIA generally doesn't return per-call cost. Public NIM API is free for
 * a per-month allowance during the build phase.
 */

import { runToolOpenAiCompatible } from "./openai-compatible";
import { resolveRuntime } from "@/lib/llm/db-config";
import type { LlmProvider } from "./types";

export const nvidiaProvider: LlmProvider = {
  id: "nvidia",
  label: "NVIDIA NIM",
  isConfigured: () => !!process.env.NVIDIA_API_KEY,
  defaultModel: () => process.env.NVIDIA_MODEL_DEFAULT || "meta/llama-3.1-70b-instruct",
  pricingPerMTokens: () => null,
  async runTool(input) {
    const rt = await resolveRuntime("nvidia", {
      apiKey: process.env.NVIDIA_API_KEY,
      baseUrl: "https://integrate.api.nvidia.com/v1",
      defaultModel: nvidiaProvider.defaultModel(),
    });
    const model = input.model || rt.defaultModel;
    return runToolOpenAiCompatible({
      baseUrl: rt.baseUrl,
      apiKey: rt.apiKey,
      modelOverride: model,
      pricing: null,
    }, { ...input, model });
  },
};
