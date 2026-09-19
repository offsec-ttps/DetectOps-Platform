/**
 * GET /api/llm-providers
 *
 * Per-provider configuration status (NO secrets in the response):
 *   - id / label / configured flag
 *   - default model
 *   - which env variables would unlock the provider when missing
 *   - the resolved "default" provider for new generation calls
 *   - configured MCP enrichment servers
 */

import { NextResponse } from "next/server";
import { PROVIDERS, PROVIDER_IDS, defaultProviderId } from "@/lib/llm";
import { smartDefaultProvider } from "@/lib/llm/providers/registry";
import { listConfiguredKinds, getConfigByKind } from "@/lib/llm/db-config";
import { listMcpServers } from "@/lib/llm/mcp/client";

const ENV_HINTS: Record<string, { keys: string[]; baseUrl?: string }> = {
  anthropic:  { keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_DEFAULT"] },
  openai:     { keys: ["OPENAI_API_KEY",    "OPENAI_MODEL_DEFAULT"] },
  openrouter: { keys: ["OPENROUTER_API_KEY","OPENROUTER_MODEL_DEFAULT", "OPENROUTER_APP_URL", "OPENROUTER_APP_NAME"] },
  nvidia:     { keys: ["NVIDIA_API_KEY",    "NVIDIA_MODEL_DEFAULT"] },
  ollama:     { keys: ["OLLAMA_HOST",       "OLLAMA_MODEL_DEFAULT"], baseUrl: process.env.OLLAMA_HOST || "http://127.0.0.1:11434" },
};

export async function GET() {
  // Surface DB-managed configs so the UI shows a provider as "configured"
  // when the user has saved a key through /settings/llm-providers — even
  // when the corresponding env var is unset.
  const dbConfiguredKinds = await listConfiguredKinds().catch(() => new Set<string>());

  const providers = await Promise.all(PROVIDER_IDS.map(async (id) => {
    const p = PROVIDERS[id];
    const hint = ENV_HINTS[id] || { keys: [] };
    const dbHas = dbConfiguredKinds.has(id);
    const envHas = p.isConfigured();
    // When DB config exists, prefer its default model so the UI displays the
    // model the user actually picked.
    let effectiveModel = p.defaultModel();
    if (dbHas) {
      const cfg = await getConfigByKind(id as any).catch(() => null);
      if (cfg?.defaultModel) effectiveModel = cfg.defaultModel;
    }
    return {
      id: p.id,
      label: p.label,
      // Single boolean the GenerateButton already consumes; OR of env + db.
      configured: envHas || dbHas,
      envConfigured: envHas,
      dbConfigured: dbHas,
      defaultModel: effectiveModel,
      envVarHints: hint.keys,
      baseUrl: hint.baseUrl,
    };
  }));

  // Never echo the decrypted token — just whether one is set.
  const mcpServers = (await listMcpServers()).map((s) => ({
    name: s.name,
    transport: s.transport,
    address: s.address,
    hasToken: !!s.options.token,
  }));

  // Smart default = the provider the UI should highlight as "the one that
  // will actually be used when you click Generate Detection Pack". Prefers a
  // configured provider (env or DB) over the historical "anthropic" fallback,
  // so users who configure OpenAI through the UI see the button do the right
  // thing without manually opening the dropdown.
  const smartDefault = await smartDefaultProvider().catch(() => defaultProviderId());

  return NextResponse.json({
    defaultProvider: smartDefault,
    envDefaultProvider: defaultProviderId(),
    providers,
    mcpServers,
  });
}
