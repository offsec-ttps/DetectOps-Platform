/**
 * Generator: detection rule → UseCase that would trigger it.
 *
 * 1. Load + parse the rule into a RuleContext.
 * 2. Call Anthropic in parallel: emit_atomic_playbook + emit_purplesharp_playbook.
 * 3. Persist a UseCase with steps + Playbook rows per requested framework.
 * 4. Each sub-call records an AiGeneration row with token usage + cost.
 *
 * No detection-samples sub-call here — the input IS a detection sample.
 */

import { prisma } from "@/lib/prisma";
import { isConfigured, runTool } from "@/lib/llm/anthropic";
import { loadRuleContext, type RuleSourceTable } from "@/lib/use-cases/parsers";
import {
  RULE_TO_PLAYBOOK_V1, buildRuleUserMessage,
} from "@/lib/llm/prompts/rule-to-playbook.v1";
import { exportAtomicYaml } from "@/lib/use-cases/exporters/atomic";
import { exportPurpleSharpJson } from "@/lib/use-cases/exporters/purplesharp";
import { logEvent } from "@/lib/event-log";
import type { StepDraft } from "@/lib/use-cases/types";

export interface RuleToPlaybookInput {
  actor: string;
  sourceTable: RuleSourceTable;
  ruleId: string;
  frameworks?: Array<"atomic" | "purplesharp">;
  model?: string;
}

export interface RuleToPlaybookOutput {
  useCaseId: string;
  atomicGenerationId?: string;
  purplesharpGenerationId?: string;
  totalCostUsd: number;
  totalTokens: { input: number; output: number };
}

interface AtomicToolResult {
  name: string;
  description?: string;
  tests: Array<{
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
  }>;
}

interface PurpleSharpToolResult {
  name: string;
  description?: string;
  type?: "local" | "remote";
  sleep?: number;
  task_sleep?: number;
  tasks: Array<{
    technique_id: string;
    technique_name: string;
    variation: number;
    rationale: string;
    url?: string;
    command?: string;
    expected_signal?: string;
  }>;
}

export async function generateFromRule(input: RuleToPlaybookInput): Promise<RuleToPlaybookOutput> {
  if (!isConfigured()) {
    const err = new Error("ANTHROPIC_API_KEY not configured. Add it to .env and restart.");
    (err as any).code = "missing_api_key"; throw err;
  }

  const t0 = Date.now();
  const frameworks = input.frameworks?.length ? input.frameworks : (["atomic", "purplesharp"] as const);
  const wantAtomic = frameworks.includes("atomic");
  const wantPS = frameworks.includes("purplesharp");

  // 1. Load + parse the rule
  const ctx = await loadRuleContext(input.sourceTable, input.ruleId);
  if (!ctx) {
    const err = new Error(`Rule not found: ${input.sourceTable}/${input.ruleId}`);
    (err as any).status = 404; throw err;
  }
  const userMsg = buildRuleUserMessage(ctx);

  // 2. Parallel sub-calls
  const atomicP = wantAtomic ? runTool<AtomicToolResult>({
    model: input.model || "claude-opus-4-7",
    system: RULE_TO_PLAYBOOK_V1.systemAtomic,
    user: userMsg,
    tool: RULE_TO_PLAYBOOK_V1.atomicTool,
    maxTokens: 4096,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const psP = wantPS ? runTool<PurpleSharpToolResult>({
    model: input.model || "claude-opus-4-7",
    system: RULE_TO_PLAYBOOK_V1.systemPurpleSharp,
    user: userMsg,
    tool: RULE_TO_PLAYBOOK_V1.purpleSharpTool,
    maxTokens: 3072,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const [atomicR, psR] = await Promise.all([atomicP, psP]);

  // 3. Build steps
  const steps: StepDraft[] = [];
  let order = 0;

  if (atomicR && !("__error" in atomicR)) {
    for (const t of atomicR.data.tests) {
      const match = await prisma.atomicTest.findFirst({
        where: { techniqueId: t.attack_technique },
        select: { id: true, testGuid: true, testName: true },
      }).catch(() => null);
      steps.push({
        orderIndex: order++,
        kind: "atomic",
        refId: match?.testGuid || "",
        techniqueId: t.attack_technique,
        displayName: t.name || t.display_name,
        parameters: {
          atomic: {
            yaml: {
              attack_technique: t.attack_technique,
              display_name: t.display_name,
              name: t.name,
              description: t.description,
              supported_platforms: t.supported_platforms,
              input_arguments: (t.input_arguments || []).map((a) => ({
                name: a.name, type: a.type, description: a.description || "", default: a.default || "",
              })),
              dependency_executor_name: "",
              dependencies: [],
              executor: {
                name: t.executor.name,
                command: t.executor.command ?? null,
                cleanup_command: t.executor.cleanup_command ?? null,
                elevation_required: !!t.executor.elevation_required,
                steps: t.executor.steps ?? null,
              },
              auto_generated_guid: null,
            },
            testGuid: match?.testGuid || undefined,
          },
        },
        expectedSignal: t.expected_signal || "",
        notes: "",
      });
    }
  }

  if (psR && !("__error" in psR)) {
    for (const t of psR.data.tasks) {
      const varRow = await prisma.purpleSharpVariation.findFirst({
        where: { techniqueId: t.technique_id, variation: t.variation },
        select: { variationLabel: true, techniqueName: true },
      }).catch(() => null);
      steps.push({
        orderIndex: order++,
        kind: varRow ? "purplesharp" : "manual",
        techniqueId: t.technique_id,
        displayName: t.technique_name,
        parameters: varRow
          ? {
              purplesharp: {
                variation: t.variation,
                ...(t.url ? { url: t.url } : {}),
                ...(t.command ? { command: t.command } : {}),
              },
            }
          : {},
        expectedSignal: t.expected_signal || "",
        notes: varRow ? t.rationale : `Not in PurpleSharp catalogue (${t.technique_id} v${t.variation}); kept as manual step. Rationale: ${t.rationale}`,
      });
    }
  }

  // 4. Persist UseCase
  const description =
    `Reverse-mapped use case for **${ctx.title}** (${ctx.ruleLanguage}).\n\n` +
    (ctx.description ? `${ctx.description}\n\n` : "") +
    `Source: \`${ctx.sourceTable}\` · ` + (ctx.upstreamUrl ? `[upstream](${ctx.upstreamUrl})` : ctx.upstreamRuleId) + `\n` +
    (ctx.logSources.length ? `Log sources: ${ctx.logSources.join(", ")}\n` : "") +
    (ctx.mitreTechniques.length ? `Rule techniques: ${ctx.mitreTechniques.join(", ")}\n` : "");

  const useCase = await prisma.useCase.create({
    data: {
      name: `${ctx.title} — triggering playbook`.slice(0, 240),
      description: description.slice(0, 8000),
      authorMode: "atomic",
      framework: steps.some((s) => s.kind === "purplesharp") && steps.some((s) => s.kind === "atomic")
        ? "mixed"
        : (wantAtomic ? "atomic" : "purplesharp"),
      source: "rule",
      sourceRefType: ctx.sourceTable,
      sourceRefId: ctx.ruleId,
      mitreTechniques: JSON.stringify([...new Set(steps.map((s) => s.techniqueId).filter(Boolean))]),
      mitreTactics: JSON.stringify(ctx.mitreTactics),
      platforms: JSON.stringify(ctx.platforms),
      tags: JSON.stringify(["ai-generated", "from-rule", ctx.sourceTable]),
      steps: {
        create: steps.map((s, i) => ({
          orderIndex: s.orderIndex ?? i,
          kind: s.kind,
          refId: s.refId || "",
          techniqueId: s.techniqueId,
          displayName: s.displayName,
          parameters: JSON.stringify(s.parameters ?? {}),
          expectedSignal: (s.expectedSignal || "").slice(0, 500),
          notes: (s.notes || "").slice(0, 2000),
        })),
      },
    },
    include: { steps: { orderBy: { orderIndex: "asc" } } },
  });

  // 5. AiGeneration rows + cost aggregation
  const sumTokens = { input: 0, output: 0 };
  let sumCost = 0;
  const out: RuleToPlaybookOutput = {
    useCaseId: useCase.id,
    totalCostUsd: 0,
    totalTokens: { input: 0, output: 0 },
  };

  const persistGen = async (kind: "atomic" | "purplesharp", r: any) => {
    if (!r) return undefined;
    if ("__error" in r) {
      const err = r.__error;
      const gen = await prisma.aiGeneration.create({
        data: {
          useCaseId: useCase.id,
          generator: `rule-to-playbook:${kind}`,
          model: input.model || "claude-opus-4-7",
          inputRefType: ctx.sourceTable,
          inputRefId: ctx.ruleId,
          promptVersion: RULE_TO_PLAYBOOK_V1.version,
          toolName: kind === "atomic" ? RULE_TO_PLAYBOOK_V1.atomicTool.name : RULE_TO_PLAYBOOK_V1.purpleSharpTool.name,
          status: "error",
          errorMessage: (err?.message || String(err)).slice(0, 1000),
        },
      });
      return gen.id;
    }
    sumTokens.input += r.inputTokens; sumTokens.output += r.outputTokens; sumCost += r.costUsd;
    const gen = await prisma.aiGeneration.create({
      data: {
        useCaseId: useCase.id,
        generator: `rule-to-playbook:${kind}`,
        model: r.model,
        inputRefType: ctx.sourceTable,
        inputRefId: ctx.ruleId,
        promptVersion: RULE_TO_PLAYBOOK_V1.version,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        toolName: kind === "atomic" ? RULE_TO_PLAYBOOK_V1.atomicTool.name : RULE_TO_PLAYBOOK_V1.purpleSharpTool.name,
        toolCalls: JSON.stringify([r.rawToolCall]),
        rawResponse: JSON.stringify(r.data),
        status: "ok",
      },
    });
    return gen.id;
  };

  out.atomicGenerationId      = await persistGen("atomic", atomicR);
  out.purplesharpGenerationId = await persistGen("purplesharp", psR);
  out.totalCostUsd = Math.round(sumCost * 10000) / 10000;
  out.totalTokens = sumTokens;

  // 6. Pre-render playbooks
  try {
    const stepsForExport = useCase.steps.map((s) => ({
      id: s.id, kind: s.kind, refId: s.refId, techniqueId: s.techniqueId,
      displayName: s.displayName, parameters: s.parameters,
      expectedSignal: s.expectedSignal, notes: s.notes,
    }));
    if (wantAtomic) {
      const atomicExp = exportAtomicYaml({
        useCase: { id: useCase.id, name: useCase.name, description: useCase.description },
        steps: stepsForExport,
      });
      await prisma.playbook.create({
        data: {
          useCaseId: useCase.id, format: "atomic-yaml", version: 1,
          body: atomicExp.body, checksum: atomicExp.checksum,
          generator: "anthropic", generatorModel: atomicR && !("__error" in atomicR) ? atomicR.model : "",
        },
      });
    }
    if (wantPS) {
      const psExp = exportPurpleSharpJson({
        useCase: { id: useCase.id, name: useCase.name, description: useCase.description },
        steps: stepsForExport.map((s) => ({
          id: s.id, kind: s.kind, techniqueId: s.techniqueId,
          displayName: s.displayName, parameters: s.parameters,
        })),
      });
      await prisma.playbook.create({
        data: {
          useCaseId: useCase.id, format: "purplesharp-json", version: 1,
          body: psExp.body, checksum: psExp.checksum,
          generator: "anthropic", generatorModel: psR && !("__error" in psR) ? psR.model : "",
        },
      });
    }
  } catch { /* pre-render is nice-to-have */ }

  void logEvent({
    category: "usecase", action: "usecase.ai.rule",
    actor: input.actor, status: "ok",
    durationMs: Date.now() - t0,
    targetType: "usecase", targetId: useCase.id,
    message: `${ctx.sourceTable}/${ctx.title.slice(0, 40)} → ${steps.length} step(s) · ${sumTokens.input}/${sumTokens.output} tok · $${out.totalCostUsd}`,
    details: {
      sourceTable: ctx.sourceTable,
      sourceRuleId: ctx.ruleId,
      ruleLanguage: ctx.ruleLanguage,
      ruleTechniques: ctx.mitreTechniques,
      stepCount: steps.length,
      atomicOk: atomicR && !("__error" in atomicR),
      purplesharpOk: psR && !("__error" in psR),
      inputTokens: sumTokens.input,
      outputTokens: sumTokens.output,
      costUsd: out.totalCostUsd,
    },
  });

  return out;
}
