/**
 * Ollama adapter (local LLMs).
 *
 * Recent Ollama versions support OpenAI-compatible function calling at
 * `${OLLAMA_HOST}/v1/chat/completions` for models that advertise `tools`
 * capability (llama 3.1, mistral, qwen 2.5, …). For older models or models
 * without native tool-use, we fall back to JSON-mode via `/api/chat`:
 *   - request `format: "json"`
 *   - embed the tool's input_schema in the system prompt
 *   - retry once with a corrective message if the model returns invalid JSON
 *
 * Cost is always 0 (local inference). No token usage reported by Ollama
 * pre-v0.5 → we set zero in that case.
 */

import type { LlmProvider } from "./types";
import { runToolOpenAiCompatible } from "./openai-compatible";
import { validateRequiredKeys } from "./types";
import { resolveRuntime } from "@/lib/llm/db-config";
import type { RunToolInput, RunToolResult } from "@/lib/llm/anthropic";

function ollamaHost(): string {
  return (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
}

export const ollamaProvider: LlmProvider = {
  id: "ollama",
  label: "Ollama (local)",
  isConfigured: () => true,                                  // local — assumed reachable when chosen
  defaultModel: () => process.env.OLLAMA_MODEL_DEFAULT || "llama3.1:8b",
  pricingPerMTokens: () => ({ in: 0, out: 0 }),               // local inference
  async runTool<T>(input: RunToolInput<T>): Promise<RunToolResult<T>> {
    // DB config can override OLLAMA_HOST and the default model.
    const rt = await resolveRuntime("ollama", {
      apiKey: "ollama",
      baseUrl: ollamaHost(),
      defaultModel: ollamaProvider.defaultModel(),
    });
    const host = (rt.baseUrl || ollamaHost()).replace(/\/$/, "");
    const model = input.model || rt.defaultModel;

    // 1) Try the OpenAI-compatible path first — fastest for models with
    //    native tool-use support.
    try {
      return await runToolOpenAiCompatible<T>({
        baseUrl: `${host}/v1`,
        apiKey: "ollama",                                     // ignored; Ollama accepts any token
        modelOverride: model,
        pricing: { in: 0, out: 0 },
      }, { ...input, model });
    } catch (err: any) {
      const msg = String(err?.message || err).toLowerCase();
      // Errors that mean "model doesn't support tools" — fall through to JSON-mode.
      const looksToolless = msg.includes("does not support tools")
        || msg.includes("tool calls")
        || msg.includes("tool_choice")
        || msg.includes("400");
      if (!looksToolless) throw err;
    }

    // 2) JSON-mode fallback via /api/chat
    return runOllamaJsonMode<T>(model, input, host);
  },
};

async function runOllamaJsonMode<T>(model: string, input: RunToolInput<T>, host?: string): Promise<RunToolResult<T>> {
  const baseHost = (host || ollamaHost()).replace(/\/$/, "");
  const schemaText = JSON.stringify(input.tool.input_schema, null, 2);
  const augmentedSystem = `${input.system}

You MUST respond with a JSON object that exactly matches this schema. No prose, no Markdown, just the JSON object itself.

JSON Schema:
${schemaText}`;

  const ask = async (corrective?: string) => {
    const messages = [
      { role: "system", content: augmentedSystem },
      { role: "user",   content: input.user },
    ];
    if (corrective) {
      messages.push({ role: "user", content: corrective });
    }
    const res = await fetch(`${baseHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        format: "json",
        stream: false,
        options: { num_predict: input.maxTokens ?? 4096 },
        messages,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 400)}`);
    }
    return await res.json();
  };

  let raw = await ask();
  let parsed: unknown;
  let errors: string[] = [];
  try { parsed = JSON.parse(raw.message?.content || raw.response || "{}"); } catch (e) { errors = [`invalid JSON: ${(e as Error).message}`]; }
  if (parsed) errors = validateRequiredKeys(parsed, input.tool.input_schema);

  if (errors.length > 0) {
    raw = await ask(`Your previous response had errors: ${errors.join("; ")}. Return ONLY the JSON object matching the schema, with all required keys present. No prose.`);
    try { parsed = JSON.parse(raw.message?.content || raw.response || "{}"); } catch (e) { throw new Error(`Ollama returned invalid JSON twice: ${(e as Error).message}`); }
    errors = validateRequiredKeys(parsed, input.tool.input_schema);
    if (errors.length > 0) throw new Error(`Ollama JSON-mode validation failed after retry: ${errors.join("; ")}`);
  }

  const usage = (raw.prompt_eval_count || raw.eval_count)
    ? { in: raw.prompt_eval_count || 0, out: raw.eval_count || 0 }
    : { in: 0, out: 0 };

  return {
    data: parsed as T,
    model: raw.model || model,
    inputTokens: usage.in,
    outputTokens: usage.out,
    costUsd: 0,
    rawToolCall: { ollamaJsonMode: true, content: raw.message?.content },
  };
}
