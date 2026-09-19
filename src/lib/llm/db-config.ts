/**
 * Resolves LLM provider configs from the DB (LlmProviderConfig) so the
 * `runTool()` dispatcher can use user-managed keys + models + custom
 * endpoints alongside the env-default registry.
 *
 * Lookup order for a given provider kind:
 *   1. Enabled DB config marked isDefault=true for that kind
 *   2. Any enabled DB config for that kind
 *   3. Env-default behaviour (existing registry providers)
 *
 * Custom endpoints (kind="custom" or "openai-compatible") are addressed by
 * their config id directly, not by kind.
 */

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/credential-vault";
import type { ProviderKind } from "./test-connection";

export interface ResolvedConfig {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;                  // already-decrypted plaintext at the resolve boundary
  defaultModel: string;
  authHeaderName: string;
  authHeaderValue: string;
  modelsPath: string;
}

let CACHE: { at: number; map: Map<string, ResolvedConfig>; byKind: Map<string, ResolvedConfig> } | null = null;
const TTL_MS = 30_000;

function safeDecrypt(s: string): string {
  if (!s) return "";
  try { return decrypt(s); } catch { return ""; }
}

async function loadConfigs(): Promise<{ map: Map<string, ResolvedConfig>; byKind: Map<string, ResolvedConfig> }> {
  const rows = await prisma.llmProviderConfig.findMany({
    where: { enabled: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const map = new Map<string, ResolvedConfig>();
  const byKind = new Map<string, ResolvedConfig>();
  for (const r of rows) {
    const cfg: ResolvedConfig = {
      id: r.id,
      kind: r.kind as ProviderKind,
      baseUrl: r.baseUrl,
      apiKey: safeDecrypt(r.apiKeyEnc),
      defaultModel: r.defaultModel,
      authHeaderName: r.authHeaderName,
      authHeaderValue: r.authHeaderValue,
      modelsPath: r.modelsPath,
    };
    map.set(r.id, cfg);
    // First-seen wins per kind (orderBy puts isDefault=true first)
    if (!byKind.has(r.kind)) byKind.set(r.kind, cfg);
  }
  return { map, byKind };
}

/**
 * Get a resolved config by config id (custom endpoints + explicit selection).
 * Bypasses any caching when `fresh=true`.
 */
export async function getConfigById(id: string, fresh = false): Promise<ResolvedConfig | null> {
  if (!fresh && CACHE && Date.now() - CACHE.at < TTL_MS) {
    const hit = CACHE.map.get(id);
    if (hit) return hit;
  }
  const r = await prisma.llmProviderConfig.findUnique({ where: { id } });
  if (!r || !r.enabled) return null;
  return {
    id: r.id,
    kind: r.kind as ProviderKind,
    baseUrl: r.baseUrl,
    apiKey: safeDecrypt(r.apiKeyEnc),
    defaultModel: r.defaultModel,
    authHeaderName: r.authHeaderName,
    authHeaderValue: r.authHeaderValue,
    modelsPath: r.modelsPath,
  };
}

/**
 * Get the active (default-flagged or first-enabled) config for a provider
 * kind. Returns null when nothing is configured in the DB — callers should
 * fall back to the existing env-driven providers.
 */
export async function getConfigByKind(kind: ProviderKind): Promise<ResolvedConfig | null> {
  if (!CACHE || Date.now() - CACHE.at >= TTL_MS) {
    const fresh = await loadConfigs();
    CACHE = { at: Date.now(), ...fresh };
  }
  return CACHE.byKind.get(kind) || null;
}

/**
 * Invalidate the cache so the next resolve picks up freshly saved configs.
 * Call this from the API routes that create / update / delete configs.
 */
export function invalidateConfigCache(): void {
  CACHE = null;
}

/**
 * One-stop runtime resolver used by every provider adapter.
 *
 * Returns the effective apiKey + baseUrl + defaultModel for a given provider
 * kind, with DB configs OVERRIDING the env-var fallback supplied by the
 * caller. This is how a user can configure (say) OpenAI through the UI without
 * setting OPENAI_API_KEY in `.env` and still have `runTool({provider:"openai"})`
 * work end-to-end.
 *
 * Lookup order (highest wins):
 *   1. DB config (when present)
 *   2. Caller-supplied env fallback
 */
export async function resolveRuntime(kind: ProviderKind, envFallback: { apiKey?: string; baseUrl?: string; defaultModel?: string }): Promise<{
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  source: "db" | "env" | "mixed";
}> {
  const db = await getConfigByKind(kind).catch(() => null);
  if (!db) {
    return {
      apiKey: envFallback.apiKey || "",
      baseUrl: envFallback.baseUrl || "",
      defaultModel: envFallback.defaultModel || "",
      source: "env",
    };
  }
  // DB wins per-field — but if any field in DB is empty, fall back to env so
  // a partial config (e.g. baseUrl only) doesn't wipe the env-supplied key.
  const apiKey       = db.apiKey       || envFallback.apiKey       || "";
  const baseUrl      = db.baseUrl      || envFallback.baseUrl      || "";
  const defaultModel = db.defaultModel || envFallback.defaultModel || "";
  const allFromDb = !!db.apiKey && !!db.baseUrl && !!db.defaultModel;
  return { apiKey, baseUrl, defaultModel, source: allFromDb ? "db" : "mixed" };
}

/**
 * Synchronous check used by API listing routes to surface "this kind has a
 * DB config" without paying the round-trip per provider. Uses the same TTL
 * cache as the async path so it is cheap and consistent.
 */
export async function listConfiguredKinds(): Promise<Set<ProviderKind>> {
  if (!CACHE || Date.now() - CACHE.at >= TTL_MS) {
    const fresh = await loadConfigs();
    CACHE = { at: Date.now(), ...fresh };
  }
  return new Set([...CACHE.byKind.keys()] as ProviderKind[]);
}
