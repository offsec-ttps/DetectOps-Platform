/**
 * Top-level LLM dispatcher (Phase 2).
 *
 * Usage:
 *   import { runTool } from "@/lib/llm";
 *   const result = await runTool({
 *     provider: "openai",                 // optional; default from LLM_PROVIDER_DEFAULT env
 *     model: "gpt-4o-mini",                // optional; provider picks its default
 *     system, user, tool,
 *   });
 *
 * The returned `model` is whatever the provider actually used (handy for
 * cost tracking).
 *
 * Anthropic-only callers can continue importing from `@/lib/llm/anthropic`
 * directly — that module is unchanged.
 */

import type { RunToolInput, RunToolResult } from "@/lib/llm/anthropic";
import { PROVIDERS, defaultProviderId, smartDefaultProvider } from "./providers/registry";
import type { ProviderId, LlmProvider } from "./providers/types";

export type { ProviderId, LlmProvider } from "./providers/types";

export interface DispatcherRunToolInput<T> extends RunToolInput<T> {
  /** Force a specific provider. When absent, uses `LLM_PROVIDER_DEFAULT`. */
  provider?: ProviderId;
}

export class LlmProviderError extends Error {
  code: string;
  provider?: string;
  constructor(code: string, message: string, provider?: string) {
    super(message);
    this.code = code;
    this.provider = provider;
  }
}

export async function runTool<T>(input: DispatcherRunToolInput<T>): Promise<RunToolResult<T>> {
  // When the caller didn't specify a provider, pick the BEST configured one
  // (looking at env vars + DB-managed configs) rather than blindly using the
  // env-only "anthropic" fallback. Explicit provider choices are honoured
  // as-is — if the caller asked for anthropic and it's unconfigured we
  // surface that error rather than silently switching.
  const providerId = (input.provider || (await smartDefaultProvider())) as ProviderId;
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new LlmProviderError("unknown_provider", `Unknown LLM provider: ${providerId}`, providerId);
  }
  // Configured iff env-vars say so OR a DB-managed config exists for this
  // provider kind. `provider.isConfigured()` is the sync env-only check kept
  // for back-compat; DB awareness is checked here via listConfiguredKinds()
  // (uses a 30s cache so this is one indexed lookup at most).
  if (!provider.isConfigured()) {
    const { listConfiguredKinds } = await import("./db-config");
    const dbKinds = await listConfiguredKinds().catch(() => new Set<string>());
    if (!dbKinds.has(providerId)) {
      throw new LlmProviderError(
        "missing_api_key",
        `Provider "${providerId}" is not configured. Add an API key at /settings/llm-providers or set the corresponding env var.`,
        providerId,
      );
    }
  }
  return provider.runTool<T>(input);
}

export { PROVIDERS, defaultProviderId, PROVIDER_IDS, anyProviderConfigured } from "./providers/registry";
