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

export async function runToolOpenAiCompatible<T>(
  cfg: OpenAiCompatibleConfig,
  input: RunToolInput<T>,
): Promise<RunToolResult<T>> {
  const model = input.model || cfg.modelOverride || "gpt-4o-mini";
  const tool = input.tool;
  const body = {
    model,
    max_tokens: input.maxTokens ?? 4096,
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
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${cfg.apiKey}`,
    ...(cfg.extraHeaders || {}),
  };

  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const json = await postWithRetry(url, headers, body);

  const choice = json.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error(`Provider did not produce a tool call (finish_reason: ${choice?.finish_reason || "?"})`);
  }
  if (toolCall.function?.name !== tool.name) {
    throw new Error(`Provider called wrong tool: expected ${tool.name}, got ${toolCall.function?.name}`);
  }
  let data: T;
  try {
    data = JSON.parse(toolCall.function.arguments || "{}");
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
