/**
 * Connectivity + model-list probes for LLM providers.
 *
 * Used by the `/api/llm-providers/[id]/test` + `/test-unsaved` + `/models`
 * endpoints. Each function returns a uniform shape:
 *
 *   { ok: boolean; latencyMs: number; message: string; details?: object }
 *
 * The probe is kind-aware:
 *   - anthropic           → POST https://api.anthropic.com/v1/messages (1-token reply)
 *   - openai              → POST https://api.openai.com/v1/chat/completions
 *   - openrouter          → POST https://openrouter.ai/api/v1/chat/completions
 *   - nvidia              → POST https://integrate.api.nvidia.com/v1/chat/completions
 *   - ollama              → GET  http://localhost:11434/api/tags (or baseUrl)
 *   - openai-compatible   → POST <baseUrl>/chat/completions (Bearer key)
 *   - custom              → POST <baseUrl>/<modelsPath || chat/completions> with
 *                            a configurable auth-header template
 *
 * Model lists:
 *   - openai / openrouter / openai-compatible / custom: GET <baseUrl>/models
 *   - anthropic: returns a curated static list (Anthropic has no public list endpoint)
 *   - nvidia: GET https://integrate.api.nvidia.com/v1/models
 *   - ollama: GET <baseUrl>/api/tags → list of installed model names
 */

import { decrypt } from "@/lib/crypto/credential-vault";

export type ProviderKind =
  | "anthropic" | "openai" | "openrouter" | "nvidia" | "ollama"
  | "openai-compatible" | "custom";

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  details?: {
    httpStatus?: number;
    modelUsed?: string;
    sampleResponse?: string;
    endpointUsed?: string;
  };
}

export interface ModelListResult {
  ok: boolean;
  latencyMs: number;
  models: Array<{ id: string; label?: string; context?: number }>;
  message: string;
}

export interface ProviderProbeInput {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;                     // already-decrypted plaintext
  apiKeyEnc?: string;                  // OR encrypted form to decrypt
  authHeaderName?: string;             // for kind="custom"
  authHeaderValue?: string;            // template; {{key}} substituted
  modelsPath?: string;
  testModel?: string;                  // override the model used by the probe
}

function nowMs(): number { return Date.now(); }

function pickKey(input: ProviderProbeInput): string {
  if (input.apiKey) return input.apiKey;
  if (input.apiKeyEnc) {
    try { return decrypt(input.apiKeyEnc); } catch { return ""; }
  }
  return "";
}

function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":  return "https://api.anthropic.com";
    case "openai":     return "https://api.openai.com/v1";
    case "openrouter": return "https://openrouter.ai/api/v1";
    case "nvidia":     return "https://integrate.api.nvidia.com/v1";
    case "ollama":     return process.env.OLLAMA_HOST || "http://localhost:11434";
    default:           return "";
  }
}

function defaultProbeModel(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":  return "claude-haiku-4-5-20251001";
    case "openai":     return "gpt-4o-mini";
    case "openrouter": return "openai/gpt-4o-mini";
    case "nvidia":     return "meta/llama-3.1-8b-instruct";
    case "ollama":     return process.env.OLLAMA_MODEL_DEFAULT || "llama3.2";
    default:           return "gpt-4o-mini";
  }
}

function buildHeaders(input: ProviderProbeInput, key: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (input.kind === "anthropic") {
    h["x-api-key"] = key;
    h["anthropic-version"] = "2023-06-01";
    return h;
  }
  if (input.kind === "ollama") {
    return h;        // typically no auth
  }
  if (input.kind === "custom") {
    const tpl = input.authHeaderValue || "Bearer {{key}}";
    const name = input.authHeaderName || "Authorization";
    h[name] = tpl.replace(/\{\{\s*key\s*\}\}/g, key);
    return h;
  }
  // openai / openrouter / nvidia / openai-compatible
  if (key) h["Authorization"] = `Bearer ${key}`;
  return h;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

// ─── Connectivity test ─────────────────────────────────────────────────────

export async function testConnection(input: ProviderProbeInput): Promise<TestResult> {
  const t0 = nowMs();
  const baseUrl = (input.baseUrl || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, message: `baseUrl required for kind="${input.kind}"` };
  }
  const key = pickKey(input);
  const requiresKey = input.kind !== "ollama";
  if (requiresKey && !key) {
    return { ok: false, latencyMs: 0, message: "API key required (or paste an unencrypted key in test-unsaved)" };
  }

  // ─── Ollama: just hit /api/tags (cheap, no model needed) ────────────────
  if (input.kind === "ollama") {
    try {
      const r = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 10_000);
      const dt = nowMs() - t0;
      if (!r.ok) {
        return { ok: false, latencyMs: dt, message: `Ollama HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`, details: { httpStatus: r.status, endpointUsed: `${baseUrl}/api/tags` } };
      }
      const j = await r.json().catch(() => ({}));
      const count = Array.isArray(j?.models) ? j.models.length : 0;
      return { ok: true, latencyMs: dt, message: `Ollama reachable · ${count} installed model(s)`, details: { httpStatus: r.status, endpointUsed: `${baseUrl}/api/tags` } };
    } catch (err: any) {
      return { ok: false, latencyMs: nowMs() - t0, message: `Ollama probe failed: ${err?.message || err}` };
    }
  }

  // ─── Anthropic ──────────────────────────────────────────────────────────
  if (input.kind === "anthropic") {
    const model = input.testModel || defaultProbeModel("anthropic");
    const url = `${baseUrl}/v1/messages`;
    try {
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: buildHeaders(input, key),
        body: JSON.stringify({
          model, max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      }, 30_000);
      const dt = nowMs() - t0;
      const body = await r.text();
      if (!r.ok) {
        return { ok: false, latencyMs: dt, message: `Anthropic HTTP ${r.status}: ${body.slice(0, 200)}`, details: { httpStatus: r.status, endpointUsed: url } };
      }
      const j = JSON.parse(body);
      const reply = j?.content?.[0]?.text || "";
      return { ok: true, latencyMs: dt, message: `Anthropic reachable · model=${model}`, details: { httpStatus: r.status, modelUsed: model, sampleResponse: reply.slice(0, 80), endpointUsed: url } };
    } catch (err: any) {
      return { ok: false, latencyMs: nowMs() - t0, message: `Anthropic probe failed: ${err?.message || err}` };
    }
  }

  // ─── OpenAI-style (openai / openrouter / nvidia / openai-compatible / custom) ──
  const model = input.testModel || defaultProbeModel(input.kind);
  const path = input.modelsPath && input.kind === "custom" ? input.modelsPath : "/chat/completions";
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(input, key),
      body: JSON.stringify({
        model, max_tokens: 8, temperature: 0,
        messages: [{ role: "user", content: "ping" }],
      }),
    }, 30_000);
    const dt = nowMs() - t0;
    const body = await r.text();
    if (!r.ok) {
      return { ok: false, latencyMs: dt, message: `HTTP ${r.status}: ${body.slice(0, 200)}`, details: { httpStatus: r.status, modelUsed: model, endpointUsed: url } };
    }
    let reply = "";
    try {
      const j = JSON.parse(body);
      reply = j?.choices?.[0]?.message?.content || j?.message?.content || "";
    } catch { reply = body.slice(0, 80); }
    return { ok: true, latencyMs: dt, message: `${input.kind} reachable · model=${model}`, details: { httpStatus: r.status, modelUsed: model, sampleResponse: String(reply).slice(0, 80), endpointUsed: url } };
  } catch (err: any) {
    return { ok: false, latencyMs: nowMs() - t0, message: `${input.kind} probe failed: ${err?.message || err}` };
  }
}

// ─── Model listing ─────────────────────────────────────────────────────────

const ANTHROPIC_STATIC: Array<{ id: string; label: string; context: number }> = [
  { id: "claude-opus-4-7",          label: "Claude Opus 4.7",          context: 200_000 },
  { id: "claude-opus-4-8",          label: "Claude Opus 4.8",          context: 200_000 },
  { id: "claude-sonnet-4-6",        label: "Claude Sonnet 4.6",        context: 200_000 },
  { id: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5",         context: 200_000 },
];

export async function listModels(input: ProviderProbeInput): Promise<ModelListResult> {
  const t0 = nowMs();
  const baseUrl = (input.baseUrl || defaultBaseUrl(input.kind)).replace(/\/+$/, "");
  const key = pickKey(input);

  // Anthropic has no public model-list endpoint; return curated static list.
  if (input.kind === "anthropic") {
    return { ok: true, latencyMs: 0, models: ANTHROPIC_STATIC, message: "static catalogue (Anthropic exposes no model-list API)" };
  }

  // Ollama: GET /api/tags
  if (input.kind === "ollama") {
    try {
      const r = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 8_000);
      const dt = nowMs() - t0;
      if (!r.ok) return { ok: false, latencyMs: dt, models: [], message: `Ollama HTTP ${r.status}` };
      const j = await r.json().catch(() => ({}));
      const models = (j?.models || []).map((m: any) => ({ id: String(m.name || m.model || ""), label: String(m.name || ""), context: m?.details?.parameter_size ? undefined : undefined }));
      return { ok: true, latencyMs: dt, models, message: `${models.length} model(s)` };
    } catch (err: any) {
      return { ok: false, latencyMs: nowMs() - t0, models: [], message: err?.message || "ollama list failed" };
    }
  }

  // OpenAI-style — GET /models (or modelsPath when custom)
  const path = input.modelsPath || "/models";
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const r = await fetchWithTimeout(url, { method: "GET", headers: buildHeaders(input, key) }, 12_000);
    const dt = nowMs() - t0;
    if (!r.ok) return { ok: false, latencyMs: dt, models: [], message: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = await r.json().catch(() => ({}));
    const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : Array.isArray(j?.models) ? j.models : [];
    const models = raw
      .map((m: any) => ({
        id: String(m.id || m.name || ""),
        label: String(m.name || m.id || ""),
        context: Number(m.context_length || m.max_context_tokens || 0) || undefined,
      }))
      .filter((m: any) => m.id);
    return { ok: true, latencyMs: dt, models, message: `${models.length} model(s)` };
  } catch (err: any) {
    return { ok: false, latencyMs: nowMs() - t0, models: [], message: err?.message || "list failed" };
  }
}
