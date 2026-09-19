/**
 * Generator: ThreatIntelReport → full UseCase bundle.
 *
 * 1. Load the report; build a compact TiContext (techniques, IOCs, references).
 * 2. Call Anthropic three times in parallel (one per requested deliverable).
 * 3. Persist a UseCase with steps (atomic + purplesharp + manual fallbacks),
 *    plus a Playbook per format, plus the detection samples bundled into the
 *    description.
 *
 * Failures in one sub-call don't kill the others — partial bundles are
 * acceptable (the user can re-run for missing pieces).
 */

import { prisma } from "@/lib/prisma";
import { isConfigured, runTool } from "@/lib/llm/anthropic";
import {
  TI_TO_PLAYBOOK_V1, buildTiUserMessage, type TiContext,
} from "@/lib/llm/prompts/ti-to-playbook.v1";
import { exportAtomicYaml } from "@/lib/use-cases/exporters/atomic";
import { exportPurpleSharpJson } from "@/lib/use-cases/exporters/purplesharp";
import { logEvent } from "@/lib/event-log";
import type { StepDraft } from "@/lib/use-cases/types";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export interface TiToPlaybookInput {
  actor: string;
  threatIntelReportId: string;
  frameworks?: Array<"atomic" | "purplesharp">;
  withDetectionSamples?: boolean;
  model?: string;
}

export interface TiToPlaybookOutput {
  useCaseId: string;
  atomicGenerationId?: string;
  purplesharpGenerationId?: string;
  detectionsGenerationId?: string;
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

interface DetectionSamplesToolResult {
  samples: Array<{
    title: string;
    language: string;
    body: string;
    technique_id: string;
    description?: string;
    falsepositives?: string;
  }>;
}

export async function generateFromTi(input: TiToPlaybookInput): Promise<TiToPlaybookOutput> {
  if (!isConfigured()) {
    const err = new Error("ANTHROPIC_API_KEY not configured. Add it to .env and restart.");
    (err as any).code = "missing_api_key";
    throw err;
  }

  const t0 = Date.now();
  const frameworks = input.frameworks?.length ? input.frameworks : (["atomic", "purplesharp"] as const);
  const withDetections = input.withDetectionSamples !== false;

  // 1. Load TI report
  const report = await prisma.threatIntelReport.findUnique({ where: { id: input.threatIntelReportId } });
  if (!report) {
    const err = new Error("ThreatIntelReport not found"); (err as any).status = 404; throw err;
  }

  // mitreTechniques is stored as either an array of strings OR an array of
  // { technique_id, technique?, tactic? } objects depending on the sync path
  // — handle both shapes.
  const rawTechniques = safeJson<unknown[]>(report.mitreTechniques, []);
  const techniques = rawTechniques
    .map((t) => {
      if (typeof t === "string") return t;
      if (t && typeof t === "object") {
        const obj = t as { technique_id?: string; id?: string };
        return obj.technique_id || obj.id || "";
      }
      return "";
    })
    .filter((s) => /^T\d{4}(\.\d{3})?$/.test(s));

  const iocsRaw = safeJson<{ network?: any[]; file?: any[]; behavioral?: string[] }>(report.iocs, {});
  const refsRaw = safeJson<unknown[]>(report.references, []);
  const references = refsRaw
    .map((r) => typeof r === "string" ? r : (r as { url?: string; title?: string })?.url || (r as { title?: string })?.title || "")
    .filter(Boolean) as string[];

  const ctx: TiContext = {
    title: report.title,
    description: report.description || report.summary || "",
    category: report.category || "",
    severity: report.severityLevel || "",
    mitreTechniques: techniques,
    actor: report.threatActor || undefined,
    targetSectors: safeJson<string[]>(report.targetSectors, []),
    iocs: iocsRaw,
    references,
  };
  const userMsg = buildTiUserMessage(ctx);

  // 2. Parallel sub-calls
  const wantAtomic = frameworks.includes("atomic");
  const wantPS = frameworks.includes("purplesharp");

  const atomicP = wantAtomic ? runTool<AtomicToolResult>({
    model: input.model || "claude-opus-4-7",
    system: TI_TO_PLAYBOOK_V1.systemAtomic,
    user: userMsg,
    tool: TI_TO_PLAYBOOK_V1.atomicTool,
    maxTokens: 4096,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const psP = wantPS ? runTool<PurpleSharpToolResult>({
    model: input.model || "claude-opus-4-7",
    system: TI_TO_PLAYBOOK_V1.systemPurpleSharp,
    user: userMsg,
    tool: TI_TO_PLAYBOOK_V1.purpleSharpTool,
    maxTokens: 3072,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const detP = withDetections ? runTool<DetectionSamplesToolResult>({
    model: "claude-sonnet-4-6",
    system: TI_TO_PLAYBOOK_V1.systemDetectionSamples,
    user: userMsg,
    tool: TI_TO_PLAYBOOK_V1.detectionTool,
    maxTokens: 3072,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const [atomicR, psR, detR] = await Promise.all([atomicP, psP, detP]);

  // 3. Build steps
  const steps: StepDraft[] = [];
  let order = 0;

  if (atomicR && !("__error" in atomicR)) {
    for (const t of atomicR.data.tests) {
      // Try to find a matching AtomicTest in our catalogue
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
      // Validate against our PurpleSharpVariation catalogue
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

  // 4. Compose detection samples into the description (Markdown)
  let bundledDescription = report.summary || report.description || "";
  if (detR && !("__error" in detR)) {
    bundledDescription += `\n\n## Detection samples\n\n`;
    for (const s of detR.data.samples) {
      bundledDescription += `### ${s.title} (${s.language})\n\n`;
      bundledDescription += `Technique: \`${s.technique_id}\`\n\n`;
      if (s.description) bundledDescription += `${s.description}\n\n`;
      bundledDescription += "```" + s.language + "\n" + s.body.trim() + "\n```\n\n";
      if (s.falsepositives) bundledDescription += `_False positives:_ ${s.falsepositives}\n\n`;
    }
  }

  // 5. Persist UseCase + steps
  const useCase = await prisma.useCase.create({
    data: {
      name: `${report.title} — generated playbook`.slice(0, 240),
      description: bundledDescription.slice(0, 8000),
      authorMode: "atomic",                                       // most-typical mode for AI-generated TI bundles
      framework: steps.some((s) => s.kind === "purplesharp") && steps.some((s) => s.kind === "atomic")
        ? "mixed"
        : (wantAtomic ? "atomic" : "purplesharp"),
      source: "ti",
      sourceRefType: "ThreatIntelReport",
      sourceRefId: report.id,
      mitreTechniques: JSON.stringify([...new Set(steps.map((s) => s.techniqueId).filter(Boolean))]),
      platforms: JSON.stringify(["windows"]),                     // refine in later phases
      tags: JSON.stringify(["ai-generated", "ti"]),
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

  // 6. AiGeneration rows per sub-call
  const sumTokens = { input: 0, output: 0 };
  let sumCost = 0;
  const out: TiToPlaybookOutput = {
    useCaseId: useCase.id,
    totalCostUsd: 0,
    totalTokens: { input: 0, output: 0 },
  };

  const persistGen = async (kind: "atomic" | "purplesharp" | "detections", r: any) => {
    if (!r) return undefined;
    if ("__error" in r) {
      const err = r.__error;
      const gen = await prisma.aiGeneration.create({
        data: {
          useCaseId: useCase.id,
          generator: kind === "detections" ? "detection-samples" : `ti-to-playbook:${kind}`,
          model: input.model || "claude-opus-4-7",
          inputRefType: "ThreatIntelReport",
          inputRefId: report.id,
          promptVersion: TI_TO_PLAYBOOK_V1.version,
          toolName: kind === "atomic" ? TI_TO_PLAYBOOK_V1.atomicTool.name
                  : kind === "purplesharp" ? TI_TO_PLAYBOOK_V1.purpleSharpTool.name
                  : TI_TO_PLAYBOOK_V1.detectionTool.name,
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
        generator: kind === "detections" ? "detection-samples" : `ti-to-playbook:${kind}`,
        model: r.model,
        inputRefType: "ThreatIntelReport",
        inputRefId: report.id,
        promptVersion: TI_TO_PLAYBOOK_V1.version,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        toolName: kind === "atomic" ? TI_TO_PLAYBOOK_V1.atomicTool.name
                : kind === "purplesharp" ? TI_TO_PLAYBOOK_V1.purpleSharpTool.name
                : TI_TO_PLAYBOOK_V1.detectionTool.name,
        toolCalls: JSON.stringify([r.rawToolCall]),
        rawResponse: JSON.stringify(r.data),
        status: "ok",
      },
    });
    return gen.id;
  };

  out.atomicGenerationId      = await persistGen("atomic", atomicR);
  out.purplesharpGenerationId = await persistGen("purplesharp", psR);
  out.detectionsGenerationId  = await persistGen("detections", detR);
  out.totalCostUsd = Math.round(sumCost * 10000) / 10000;
  out.totalTokens = sumTokens;

  // 7. Pre-render playbooks (best-effort; users can re-export anytime)
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
  } catch { /* exports are nice-to-have at this stage */ }

  void logEvent({
    category: "usecase", action: "usecase.ai.ti",
    actor: input.actor, status: "ok",
    durationMs: Date.now() - t0,
    targetType: "usecase", targetId: useCase.id,
    message: `${steps.length} step(s) · ${sumTokens.input}/${sumTokens.output} tok · $${out.totalCostUsd}`,
    details: {
      threatIntelReportId: report.id,
      frameworks: frameworks as unknown as string[],
      stepCount: steps.length,
      atomicOk: atomicR && !("__error" in atomicR),
      purplesharpOk: psR && !("__error" in psR),
      detectionsOk: detR && !("__error" in detR),
      inputTokens: sumTokens.input,
      outputTokens: sumTokens.output,
      costUsd: out.totalCostUsd,
    },
  });

  return out;
}
