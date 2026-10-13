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
  /** Set false to disable the `LLM_PROVIDER_FALLBACK` retry for this call. */
  fallback?: boolean;
}

/** Provider to retry on when the primary call fails (`LLM_PROVIDER_FALLBACK`), if any. */
export function fallbackProviderId(): ProviderId | undefined {
  const id = process.env.LLM_PROVIDER_FALLBACK as ProviderId | undefined;
  return id && PROVIDERS[id] ? id : undefined;
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
  const explicit = !!input.provider;
  const providerId = (input.provider || (await smartDefaultProvider())) as ProviderId;
  // An explicitly requested provider is honoured as-is: silently re-running the
  // call on a different vendor would change model, cost and data handling
  // behind the caller's (and the user's) back. Fallback applies only to the
  // auto-selected default.
  const fallbackId = explicit || input.fallback === false ? undefined : fallbackProviderId();
  try {
    return await runOn<T>(providerId, input);
  } catch (err) {
    // Configuration errors are not transient — surface them with their original
    // code so the UI can key off it (e.g. "add an API key") instead of
    // masking them behind a fallback attempt.
    if (err instanceof LlmProviderError && (err.code === "missing_api_key" || err.code === "unknown_provider")) throw err;
    if (!fallbackId || fallbackId === providerId) throw err;
    console.warn(`[llm] ${providerId} failed (${(err as Error).message?.slice(0, 200)}); retrying on fallback ${fallbackId}`);
    // The primary's model id means nothing to the fallback — let it use its own default.
    return await runOn<T>(fallbackId, { ...input, model: undefined }).catch((fbErr) => {
      // Preserve the primary's error code when it carried one, so callers that
      // branch on `code` keep working; otherwise report the combined failure.
      const code = err instanceof LlmProviderError ? err.code : "all_providers_failed";
      throw new LlmProviderError(
        code,
        `${providerId} failed: ${(err as Error).message} — fallback ${fallbackId} also failed: ${(fbErr as Error).message}`,
        providerId,
      );
    });
  }
}

async function runOn<T>(providerId: ProviderId, input: DispatcherRunToolInput<T>): Promise<RunToolResult<T>> {
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
