/**
 * Generator: prompt → single ART YAML test.
 * Wraps the LLM call + records an `AiGeneration` row + emits a usecase event.
 */

import { prisma } from "@/lib/prisma";
import { isConfigured, runTool } from "@/lib/llm/anthropic";
import { ATOMIC_FROM_PROMPT_V1, buildAtomicUserMessage } from "@/lib/llm/prompts/atomic-from-prompt.v1";
import { logEvent } from "@/lib/event-log";
import type { AtomicYamlInput } from "@/lib/use-cases/types";

export interface AtomicFromPromptInput {
  actor: string;                       // user email or "system"
  inputRefId: string;                   // user id (or arbitrary correlation id)
  prompt: string;
  technique?: string;
  platforms?: string[];
  context?: string;
  model?: string;
}

export interface AtomicFromPromptOutput {
  generationId: string;
  yaml: AtomicYamlInput;
  expectedSignal: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface ToolResult {
  attack_technique: string;
  display_name: string;
  name: string;
  description: string;
  supported_platforms: string[];
  input_arguments?: Array<{ name: string; type: string; description?: string; default?: string }>;
  executor: {
    name: string;
    elevation_required: boolean;
    command?: string;
    cleanup_command?: string;
    steps?: string;
  };
  expected_signal?: string;
}

export async function generateAtomicFromPrompt(
  input: AtomicFromPromptInput,
): Promise<AtomicFromPromptOutput> {
  if (!isConfigured()) {
    const err = new Error("ANTHROPIC_API_KEY not configured. Add it to .env and restart.");
    (err as any).code = "missing_api_key";
    throw err;
  }

  const t0 = Date.now();
  const userMsg = buildAtomicUserMessage({
    prompt: input.prompt, technique: input.technique,
    platforms: input.platforms, context: input.context,
  });

  try {
    const result = await runTool<ToolResult>({
      model: input.model,
      system: ATOMIC_FROM_PROMPT_V1.system,
      user: userMsg,
      tool: ATOMIC_FROM_PROMPT_V1.tool,
      maxTokens: 2048,
    });

    // Map tool output → our AtomicYamlInput shape (compatible with the AtomicBuilder form)
    const yaml: AtomicYamlInput = {
      attack_technique: result.data.attack_technique,
      display_name: result.data.display_name,
      name: result.data.name,
      description: result.data.description,
      supported_platforms: result.data.supported_platforms,
      input_arguments: (result.data.input_arguments || []).map((a) => ({
        name: a.name, type: a.type, description: a.description || "", default: a.default || "",
      })),
      dependency_executor_name: "",
      dependencies: [],
      executor: {
        name: result.data.executor.name,
        command: result.data.executor.command ?? null,
        cleanup_command: result.data.executor.cleanup_command ?? null,
        elevation_required: !!result.data.executor.elevation_required,
        steps: result.data.executor.steps ?? null,
      },
      auto_generated_guid: null,
    };
    const expectedSignal = result.data.expected_signal || "";

    const gen = await prisma.aiGeneration.create({
      data: {
        generator: "atomic-from-prompt",
        model: result.model,
        inputRefType: "Prompt",
        inputRefId: input.inputRefId,
        promptVersion: ATOMIC_FROM_PROMPT_V1.version,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        toolName: ATOMIC_FROM_PROMPT_V1.tool.name,
        toolCalls: JSON.stringify([result.rawToolCall]),
        rawResponse: JSON.stringify({ yaml, expectedSignal }),
        status: "ok",
      },
    });

    void logEvent({
      category: "usecase", action: "usecase.ai.atomic",
      actor: input.actor, status: "ok",
      durationMs: Date.now() - t0,
      targetType: "AiGeneration", targetId: gen.id,
      message: `${yaml.attack_technique} · ${result.inputTokens}/${result.outputTokens} tok · $${result.costUsd}`,
      details: {
        generator: "atomic-from-prompt",
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        prompt: input.prompt.slice(0, 200),
        techniqueId: yaml.attack_technique,
      },
    });

    return {
      generationId: gen.id,
      yaml,
      expectedSignal,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Record the error too so the user can debug from the audit log.
    await prisma.aiGeneration.create({
      data: {
        generator: "atomic-from-prompt",
        model: input.model || process.env.ANTHROPIC_MODEL_DEFAULT || "claude-sonnet-4-6",
        inputRefType: "Prompt",
        inputRefId: input.inputRefId,
        promptVersion: ATOMIC_FROM_PROMPT_V1.version,
        toolName: ATOMIC_FROM_PROMPT_V1.tool.name,
        status: "error",
        errorMessage: msg.slice(0, 1000),
      },
    }).catch(() => {});
    void logEvent({
      category: "usecase", action: "usecase.ai.atomic",
      actor: input.actor, status: "error",
      durationMs: Date.now() - t0,
      message: msg.slice(0, 200), errorMessage: msg,
    });
    throw err;
  }
}
