/**
 * Provider registry. Every concrete provider registers here so the
 * dispatcher + UI can find them by id.
 */

import type { LlmProvider, ProviderId } from "./types";
import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { openrouterProvider } from "./openrouter";
import { nvidiaProvider } from "./nvidia";
import { ollamaProvider } from "./ollama";

export const PROVIDERS: Record<ProviderId, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  nvidia: nvidiaProvider,
  ollama: ollamaProvider,
};

export const PROVIDER_IDS: ProviderId[] = Object.keys(PROVIDERS) as ProviderId[];

/**
 * Resolved default provider — caller's override wins, then
 * LLM_PROVIDER_DEFAULT env, then "anthropic" as the long-standing default.
 *
 * Note: this is a SYNC env-only resolver kept for back-compat. The
 * dispatcher and the status route should prefer `smartDefaultProvider()`
 * below, which also looks at DB-managed configs.
 */
export function defaultProviderId(): ProviderId {
  const fromEnv = process.env.LLM_PROVIDER_DEFAULT as ProviderId | undefined;
  if (fromEnv && PROVIDERS[fromEnv]) return fromEnv;
  return "anthropic";
}

/**
 * Best-default provider that actually has a key.
 *
 *   1. LLM_PROVIDER_DEFAULT env — but ONLY if that provider is actually
 *      configured (env OR DB). Operators can pin a default, but a broken
 *      pin should not block generation.
 *   2. The first provider with a key, in priority order:
 *        anthropic → openai → openrouter → nvidia → ollama
 *      Ollama comes last because its `isConfigured()` always returns true
 *      (local daemon assumed reachable); we don't want to silently default
 *      to ollama when no remote provider is configured.
 *   3. Falls back to `defaultProviderId()` (likely "anthropic") only when
 *      literally no provider has a key — keeps the existing error message
 *      stable so callers can still tell the user "no provider configured".
 */
export async function smartDefaultProvider(): Promise<ProviderId> {
  const { listConfiguredKinds } = await import("../db-config").catch(() => ({ listConfiguredKinds: async () => new Set<string>() }));
  const dbKinds = await listConfiguredKinds().catch(() => new Set<string>());

  const isConfigured = (id: ProviderId): boolean => {
    if (PROVIDERS[id].isConfigured()) return true;
    return dbKinds.has(id);
  };

  // Honour the operator's pinned default when it's configured.
  const pinned = process.env.LLM_PROVIDER_DEFAULT as ProviderId | undefined;
  if (pinned && PROVIDERS[pinned] && isConfigured(pinned)) return pinned;

  // Priority order — Ollama last so we don't auto-pick a local daemon
  // when the user clearly configured a paid provider.
  const ORDER: ProviderId[] = ["anthropic", "openai", "openrouter", "nvidia", "ollama"];
  for (const id of ORDER) {
    if (isConfigured(id)) return id;
  }
  return defaultProviderId();
}

/** True if any provider is configured (used by UI to detect "key absent" mode). */
export function anyProviderConfigured(): boolean {
  for (const id of PROVIDER_IDS) {
    if (PROVIDERS[id].isConfigured()) return true;
  }
  return false;
}
