/**
 * Multi-provider LLM abstraction (Phase 2).
 *
 * Every concrete provider implements `LlmProvider`. The top-level
 * `runTool()` dispatcher in `src/lib/llm/index.ts` resolves the provider
 * (from caller's `provider:` override OR `LLM_PROVIDER_DEFAULT` env) and
 * delegates the actual call.
 *
 * Existing callers that import from `src/lib/llm/anthropic.ts` keep working
 * unchanged — that file is the Anthropic implementation; the registry just
 * wraps it.
 */

import type { RunToolInput, RunToolResult, AnthropicTool } from "@/lib/llm/anthropic";

export type ProviderId = "anthropic" | "openai" | "openrouter" | "nvidia" | "ollama";

export interface LlmProvider {
  id: ProviderId;
  /** Human-readable label for UI. */
  label: string;
  /** True if the provider can be used right now (api key + base url present). */
  isConfigured(): boolean;
  /** Default model used when caller doesn't pass one. */
  defaultModel(): string;
  /** Per-million-token pricing if known; `null` for usage-billed providers (free or per-request). */
  pricingPerMTokens(model: string): { in: number; out: number } | null;
  /** Force a single tool call and return its parsed input. */
  runTool<T>(input: RunToolInput<T>): Promise<RunToolResult<T>>;
}

/** Re-export the tool type so adapters don't have to dig through the Anthropic module. */
export type Tool = AnthropicTool;

/**
 * Minimal structured "presence" check used by the validator fallback for
 * providers that lack first-class tool-use (Ollama). We only verify the
 * top-level required keys exist — schema-deep validation is left to the
 * caller because Anthropic-style schemas don't always round-trip 1:1
 * through ajv.
 */
export function validateRequiredKeys(data: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("output is not an object");
    return errors;
  }
  const required = (schema as any)?.required;
  if (!Array.isArray(required)) return errors;
  for (const key of required) {
    if (!(key in (data as Record<string, unknown>))) {
      errors.push(`missing required key: ${key}`);
    }
  }
  return errors;
}
