/**
 * Shared OpenAI-compatible Chat Completions tool-call.
 *
 * Used by OpenAI, OpenRouter, and NVIDIA NIM — all three expose the same
 * `POST /v1/chat/completions` shape with `tools` + `tool_choice`.
 *
 * Behaviour:
 *   - Forces exactly one named tool call (`tool_choice: { type: "function", function: { name }}`)
 *   - Returns the parsed tool arguments + token usage if the provider reports it
 *   - Retries once on 429 / 5xx with linear backoff
 */

import type { RunToolInput, RunToolResult } from "@/lib/llm/anthropic";

export interface OpenAiCompatibleConfig {
  /** e.g. https://api.openai.com/v1 — without trailing slash */
  baseUrl: string;
  /** Plain API key; will be sent as `Authorization: Bearer …`. */
  apiKey: string;
  /** Returned in RunToolResult.model — used for cost lookup later. */
  modelOverride?: string;
  /** Optional extra headers (e.g. OpenRouter ranking headers). */
  extraHeaders?: Record<string, string>;
  /** Pricing lookup; null/undefined when the provider doesn't report it. */
  pricing?: { in: number; out: number } | null;
  /** Provider-specific request fields merged into the body (e.g. OpenRouter `provider` routing). */
  extraBody?: Record<string, unknown>;
}

interface OpenAiResponse {
  id: string;
  model: string;
  choices: Array<{
    finish_reason?: string;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; total_cost?: number };
}

/**
 * Known per-model output caps (completion tokens). Callers ask for large
 * budgets (24k/32k for pack + use-case generation) that exceed what the
 * default OpenAI/OpenRouter models accept, which turns every call into an
 * HTTP 400 "max_tokens is too large". Clamp here so the provider never sees
 * more than its model can take. Matched by substring on the (possibly
 * vendor-prefixed, e.g. "openai/gpt-4o-mini") model id. Unknown models are
 * left untouched and rely on the 400-retry below.
 */
const MODEL_OUTPUT_CAPS: Array<[pattern: string, cap: number]> = [
  ["gpt-4o-mini", 16_384],
  ["gpt-4o", 16_384],
  ["gpt-4.1-nano", 32_768],
  ["gpt-4.1-mini", 32_768],
  ["gpt-4.1", 32_768],
  ["gpt-4-turbo", 4_096],
  ["gpt-3.5", 4_096],
  ["llama-3.1", 4_096],
  ["llama-3.3", 4_096],
];

export function clampMaxTokens(model: string, requested: number): number {
  const m = (model || "").toLowerCase();
  for (const [pattern, cap] of MODEL_OUTPUT_CAPS) {
    if (m.includes(pattern)) return Math.min(requested, cap);
  }
  return requested;
}

/** Pull the provider's stated max out of a "max_tokens … supports at most N" style error. */
function suggestedMaxFromError(message: string): number | null {
  const m = /(?:at most|maximum(?: of)?|supports(?: up to)?|limit(?: of)?)\s+(\d{3,6})/i.exec(message)
    || /(\d{3,6})\s*(?:output|completion)?\s*tokens?/i.exec(message);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n >= 256 ? n : null;
}

export async function runToolOpenAiCompatible<T>(
  cfg: OpenAiCompatibleConfig,
  input: RunToolInput<T>,
): Promise<RunToolResult<T>> {
  const model = input.model || cfg.modelOverride || "gpt-4o-mini";
  const tool = input.tool;
  const body = {
    model,
    max_tokens: clampMaxTokens(model, input.maxTokens ?? 4096),
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    tools: [{
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.input_schema,
      },
    }],
    tool_choice: { type: "function", function: { name: tool.name } },
    ...(cfg.extraBody || {}),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${cfg.apiKey}`,
    ...(cfg.extraHeaders || {}),
  };

  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let json: OpenAiResponse;
  try {
    json = await postWithRetry(url, headers, body);
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/max_tokens|max_completion_tokens/i.test(msg) && /HTTP 400/.test(msg)) {
      // Model cap unknown to MODEL_OUTPUT_CAPS — retry once at the limit the
      // provider named in its error (or a conservative 16k when it didn't).
      const cap = suggestedMaxFromError(msg) ?? 16_384;
      if (cap < (body.max_tokens as number)) {
        json = await postWithRetry(url, headers, { ...body, max_tokens: cap });
      } else {
        throw err;
      }
    } else if (/tool_choice/i.test(msg)) {
      // Some models (e.g. newer Claude models routed through OpenRouter) reject a
      // forced tool_choice. Retry letting the model choose, with the only tool on
      // offer and an explicit instruction to call it; the checks below still
      // reject a reply that doesn't.
      json = await postWithRetry(url, headers, {
        ...body,
        tool_choice: "auto",
        messages: [
          { role: "system", content: `${input.system}\n\nRespond ONLY by calling the \`${tool.name}\` tool.` },
          { role: "user", content: input.user },
        ],
      });
    } else {
      throw err;
    }
  }

  const choice = json.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error(`Provider did not produce a tool call (finish_reason: ${choice?.finish_reason || "?"})`);
  }
  if (toolCall.function?.name !== tool.name) {
    throw new Error(`Provider called wrong tool: expected ${tool.name}, got ${toolCall.function?.name}`);
  }
  // Without a forced tool_choice some Claude routes leak their native
  // `<parameter name=…>` markup into string values instead of nesting objects.
  // Reject that outright so the dispatcher can fall back to another provider.
  if ((toolCall.function.arguments || "").includes("<parameter name=")) {
    throw new Error(`Provider returned malformed tool arguments (${model} leaked <parameter> markup; use a model that supports forced tool_choice)`);
  }
  // A truncated tool call may arrive as partial JSON or as empty arguments ("{}"),
  // which would otherwise pass silently as an empty result.
  if (choice?.finish_reason === "length") {
    throw new Error(`Provider output truncated at max_tokens (${input.maxTokens ?? 4096}) — raise maxTokens for this step`);
  }
  let data: T;
  try {
    data = coerceToSchema(JSON.parse(toolCall.function.arguments || "{}"), tool.input_schema) as T;
  } catch (err) {
    throw new Error(`Provider tool arguments not valid JSON: ${(err as Error).message}`);
  }

  const inputTokens = json.usage?.prompt_tokens ?? 0;
  const outputTokens = json.usage?.completion_tokens ?? 0;
  const costUsd = json.usage?.total_cost != null
    ? json.usage.total_cost
    : cfg.pricing
      ? (inputTokens / 1_000_000) * cfg.pricing.in + (outputTokens / 1_000_000) * cfg.pricing.out
      : 0;

  return {
    data,
    model: json.model || model,
    inputTokens,
    outputTokens,
    costUsd,
    rawToolCall: toolCall,
  };
}

/**
 * Some models return a nested array/object as a JSON-encoded string
 * (`"candidateTechniques": "[{…}]"`). Walk the value against the tool schema and
 * decode any string sitting where the schema expects an array or object.
 */
export function coerceToSchema(value: unknown, schema: any): unknown {
  if (!schema || typeof schema !== "object") return value;
  const want = schema.type;
  if (typeof value === "string" && (want === "array" || want === "object")) {
    const s = value.trim();
    if ((want === "array" && s.startsWith("[")) || (want === "object" && s.startsWith("{"))) {
      try {
        value = JSON.parse(s);
      } catch {
        // Windows paths inside the text (\\.\PhysicalDrive0, C:\Users) arrive with
        // backslashes that aren't valid JSON escapes — double those and retry.
        // Consume escapes as pairs so an already-valid "\\" isn't split.
        const repaired = s.replace(/\\(["\\/bfnrtu]?)/g, (m, c) => (c ? m : "\\\\"));
        try { value = JSON.parse(repaired); } catch { return value; }
      }
    }
  }
  if (want === "array" && Array.isArray(value) && schema.items) {
    return value.map((v) => coerceToSchema(v, schema.items));
  }
  if (want === "object" && value && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in out) out[k] = coerceToSchema(out[k], sub);
    }
    return out;
  }
  return value;
}

async function postWithRetry(url: string, headers: Record<string, string>, body: unknown, attempts = 2): Promise<OpenAiResponse> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const transient = res.status === 429 || res.status >= 500;
        if (transient && i < attempts - 1) {
          await sleep(1500 * (i + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err as Error;
      if (i === attempts - 1) throw err;
    }
  }
  throw lastErr || new Error("openai-compatible call failed without specific error");
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
