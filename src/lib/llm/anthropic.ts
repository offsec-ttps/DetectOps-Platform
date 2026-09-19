/**
 * Anthropic client + structured-output helper.
 *
 * Routes call `runTool<T>(...)` which forces a single tool call so the model
 * returns strict JSON conforming to the tool's input schema. We never accept
 * freeform text — if the model tries, the call errors out.
 *
 * Pricing snapshot (Jun 2026):
 *   claude-opus-4-7:    $15 / 1M in,  $75 / 1M out
 *   claude-sonnet-4-6:  $3  / 1M in,  $15 / 1M out
 *   claude-haiku-4-5:   $0.80/1M in,  $4  / 1M out
 *
 * Returned via the `cost` field on every call so AiGeneration rows can sum
 * spend per generator / per user / per time window.
 */

import Anthropic from "@anthropic-ai/sdk";

const COST_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  "claude-opus-4-7": { in: 15, out: 75 },
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
};

export interface AnthropicConfigError extends Error {
  code: "missing_api_key";
}

let singleton: Anthropic | null = null;

export function isConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function getClient(): Anthropic {
  if (!singleton) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      const err = new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env and restart the server. " +
        "Get a key at https://console.anthropic.com/settings/keys",
      ) as AnthropicConfigError;
      err.code = "missing_api_key";
      throw err;
    }
    singleton = new Anthropic({ apiKey: key });
  }
  return singleton;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface RunToolInput<TOut> {
  model?: string;
  system: string;
  user: string;
  tool: AnthropicTool;
  maxTokens?: number;
  // Type narrowing only — we don't actually validate beyond Anthropic's own JSON-schema check.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _outShape?: TOut;
}

export interface RunToolResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  rawToolCall: unknown;
}

/**
 * Force exactly one tool call from the model and return its parsed input.
 * Retries once on `overloaded_error` with exponential backoff.
 *
 * When the optional `apiKey` / `baseURL` are supplied (e.g. by the
 * provider adapter resolving a DB-managed config), a one-shot Anthropic
 * client is built with those overrides — the env-singleton is left alone
 * so existing callers that rely on `ANTHROPIC_API_KEY` keep working.
 */
export async function runTool<T>(
  input: RunToolInput<T> & { apiKey?: string; baseURL?: string },
): Promise<RunToolResult<T>> {
  const client = (input.apiKey || input.baseURL)
    ? new Anthropic({
        apiKey: input.apiKey || process.env.ANTHROPIC_API_KEY || "",
        ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      })
    : getClient();
  const model = input.model || process.env.ANTHROPIC_MODEL_DEFAULT || "claude-sonnet-4-6";

  const call = async () => client.messages.create({
    model,
    max_tokens: input.maxTokens ?? 4096,
    system: input.system,
    tools: [input.tool as any],
    tool_choice: { type: "tool", name: input.tool.name } as any,
    messages: [{ role: "user", content: input.user }],
  });

  let response;
  try {
    response = await call();
  } catch (err: any) {
    // The SDK surfaces overload as a 529 with `type: "overloaded_error"`.
    const overloaded = err?.status === 529 || err?.error?.type === "overloaded_error";
    if (!overloaded) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    response = await call();
  }

  // Find the tool_use block — Anthropic emits a content block of type "tool_use" when forced.
  const toolUse = response.content.find((c) => c.type === "tool_use") as
    | { type: "tool_use"; name: string; input: unknown } | undefined;
  if (!toolUse) {
    throw new Error("Anthropic returned no tool_use block — refused the structured output.");
  }

  const inputTokens = (response as any).usage?.input_tokens ?? 0;
  const outputTokens = (response as any).usage?.output_tokens ?? 0;
  const cost = COST_PER_M_TOKENS[model];
  const costUsd = cost
    ? (inputTokens * cost.in + outputTokens * cost.out) / 1_000_000
    : 0;

  return {
    data: toolUse.input as T,
    model,
    inputTokens,
    outputTokens,
    costUsd: Math.round(costUsd * 10000) / 10000,        // 4 decimals
    rawToolCall: toolUse,
  };
}
