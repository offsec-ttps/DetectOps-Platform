/**
 * POST /api/uploaded-detections/[id]/to-use-case
 *
 * Body: { mode: "ai" | "direct", frameworks?: ["atomic","purplesharp"], model?: string }
 *
 *   "ai"     — invoke the LLM rule-to-playbook generator with the upload
 *              treated as a synthetic rule context (no DB row needed).
 *   "direct" — skip the LLM: materialise a UseCase whose steps come straight
 *              from the inferred mappings (a stub per matching AtomicTest /
 *              PurpleSharpVariation / StratusAttack).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { generateFromRule } from "@/lib/llm/generators/rule-to-playbook";
import { isConfigured } from "@/lib/llm/anthropic";
import { buildRuleContextFromUpload } from "@/lib/use-cases/upload/infer-mapping";
import { RULE_TO_PLAYBOOK_V1, buildRuleUserMessage } from "@/lib/llm/prompts/rule-to-playbook.v1";
import { runTool } from "@/lib/llm/anthropic";
import { exportAtomicYaml } from "@/lib/use-cases/exporters/atomic";
import { exportPurpleSharpJson } from "@/lib/use-cases/exporters/purplesharp";
import type { StepDraft } from "@/lib/use-cases/types";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

interface InferredMappings {
  atomic: Array<{ techniqueId: string; testGuid: string; testName: string }>;
  purplesharp: Array<{ techniqueId: string; variation: number; variationLabel: string }>;
  stratus: Array<{ attackId: string; name: string; platform: string }>;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const upload = await prisma.uploadedDetection.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "upload not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, upload.uploadedBy);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const mode = (body.mode === "direct" ? "direct" : "ai") as "ai" | "direct";
  const frameworks = Array.isArray(body.frameworks)
    ? body.frameworks.filter((f: unknown): f is "atomic" | "purplesharp" => f === "atomic" || f === "purplesharp")
    : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;
  const sessionUser = await getSessionUser().catch(() => null);

  // ─── Direct mode: stub steps from inferred mappings ─────────────────────────
  if (mode === "direct") {
    const mappings = safeJson<InferredMappings>(upload.inferredMappings, { atomic: [], purplesharp: [], stratus: [] });

    const steps: StepDraft[] = [];
    let i = 0;
    for (const a of mappings.atomic.slice(0, 5)) {
      steps.push({
        orderIndex: i++,
        kind: "atomic",
        refId: a.testGuid,
        techniqueId: a.techniqueId,
        displayName: a.testName,
        parameters: { atomic: { testGuid: a.testGuid } },
        expectedSignal: "",
        notes: "Suggested by upload inference",
      });
    }
    for (const p of mappings.purplesharp.slice(0, 5)) {
      steps.push({
        orderIndex: i++,
        kind: "purplesharp",
        techniqueId: p.techniqueId,
        displayName: `${p.techniqueId} v${p.variation}${p.variationLabel ? ` · ${p.variationLabel}` : ""}`,
        parameters: { purplesharp: { variation: p.variation } },
        expectedSignal: "",
        notes: "Suggested by upload inference",
      });
    }
    for (const s of mappings.stratus.slice(0, 5)) {
      steps.push({
        orderIndex: i++,
        kind: "stratus",
        refId: s.attackId,
        techniqueId: s.attackId,
        displayName: s.name,
        parameters: { stratus: { phases: ["warmup", "detonate"] } },
        expectedSignal: "",
        notes: `${s.platform} · suggested by upload inference`,
      });
    }

    if (steps.length === 0) {
      return NextResponse.json({
        error: "No matching ART / PurpleSharp / Stratus rows for the inferred techniques. Try AI mode instead.",
      }, { status: 400 });
    }

    const useCase = await prisma.useCase.create({
      data: {
        name: `${upload.filename} — uploaded`.slice(0, 240),
        description: `Materialised from uploaded ${upload.format} rule.\n\nTechniques: ${safeJson<string[]>(upload.parsedTechniques, []).join(", ") || "none"}`,
        authorMode: "atomic",
        framework: "mixed",
        source: "upload",
        sourceRefType: "UploadedDetection",
        sourceRefId: upload.id,
        mitreTechniques: upload.parsedTechniques,
        mitreTactics: upload.parsedTactics,
        platforms: "[]",
        tags: JSON.stringify(["uploaded", "direct-mapping", upload.format]),
        steps: {
          create: steps.map((s, i) => ({
            orderIndex: s.orderIndex ?? i,
            kind: s.kind,
            refId: s.refId || "",
            techniqueId: s.techniqueId,
            displayName: s.displayName,
            parameters: JSON.stringify(s.parameters ?? {}),
            expectedSignal: "",
            notes: s.notes || "",
          })),
        },
      },
    });

    await prisma.uploadedDetection.update({
      where: { id: upload.id },
      data: { useCaseId: useCase.id },
    });

    void logEvent({
      category: "usecase", action: "usecase.upload.materialise",
      actor: sessionUser?.email || "anonymous", status: "ok",
      targetType: "usecase", targetId: useCase.id,
      message: `direct · ${steps.length} step(s) from ${upload.format} upload`,
      details: { mode: "direct", uploadId: upload.id, stepCount: steps.length },
    });

    return NextResponse.json({ useCaseId: useCase.id, stepCount: steps.length, mode: "direct" });
  }

  // ─── AI mode: synthesise a RuleContext from the upload, run the LLM ─────────
  if (!isConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  // Reuse the rule-to-playbook prompt machinery with a synthetic context.
  const techniques = safeJson<string[]>(upload.parsedTechniques, []);
  const tactics = safeJson<string[]>(upload.parsedTactics, []);
  const synth = buildRuleContextFromUpload({
    filename: upload.filename, body: upload.rawContent, format: upload.format as any,
    techniques, tactics, logsource: upload.parsedLogsource,
  });

  const userMsg = buildRuleUserMessage(synth);
  const wantAtomic = !frameworks || frameworks.includes("atomic");
  const wantPS = !frameworks || frameworks.includes("purplesharp");

  const atomicP = wantAtomic ? runTool({
    model: model || "claude-opus-4-7",
    system: RULE_TO_PLAYBOOK_V1.systemAtomic,
    user: userMsg,
    tool: RULE_TO_PLAYBOOK_V1.atomicTool,
    maxTokens: 4096,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const psP = wantPS ? runTool({
    model: model || "claude-opus-4-7",
    system: RULE_TO_PLAYBOOK_V1.systemPurpleSharp,
    user: userMsg,
    tool: RULE_TO_PLAYBOOK_V1.purpleSharpTool,
    maxTokens: 3072,
  }).catch((e) => ({ __error: e })) : Promise.resolve(null);

  const [aRes, pRes] = await Promise.all([atomicP, psP]);

  const steps: StepDraft[] = [];
  let i = 0;
  let inputTokens = 0, outputTokens = 0, costUsd = 0;

  if (aRes && !("__error" in aRes)) {
    inputTokens += aRes.inputTokens; outputTokens += aRes.outputTokens; costUsd += aRes.costUsd;
    for (const t of (aRes.data as any).tests || []) {
      const match = await prisma.atomicTest.findFirst({
        where: { techniqueId: t.attack_technique },
        select: { testGuid: true },
      }).catch(() => null);
      steps.push({
        orderIndex: i++, kind: "atomic", refId: match?.testGuid || "",
        techniqueId: t.attack_technique, displayName: t.name || t.display_name,
        parameters: {
          atomic: {
            yaml: {
              attack_technique: t.attack_technique,
              display_name: t.display_name, name: t.name, description: t.description,
              supported_platforms: t.supported_platforms,
              input_arguments: (t.input_arguments || []).map((a: any) => ({
                name: a.name, type: a.type, description: a.description || "", default: a.default || "",
              })),
              dependency_executor_name: "", dependencies: [],
              executor: {
                name: t.executor.name, command: t.executor.command ?? null,
                cleanup_command: t.executor.cleanup_command ?? null,
                elevation_required: !!t.executor.elevation_required,
                steps: t.executor.steps ?? null,
              },
              auto_generated_guid: null,
            },
            testGuid: match?.testGuid,
          },
        },
        expectedSignal: t.expected_signal || "", notes: "",
      });
    }
  }
  if (pRes && !("__error" in pRes)) {
    inputTokens += pRes.inputTokens; outputTokens += pRes.outputTokens; costUsd += pRes.costUsd;
    for (const t of (pRes.data as any).tasks || []) {
      const varRow = await prisma.purpleSharpVariation.findFirst({
        where: { techniqueId: t.technique_id, variation: t.variation },
      }).catch(() => null);
      steps.push({
        orderIndex: i++, kind: varRow ? "purplesharp" : "manual",
        techniqueId: t.technique_id, displayName: t.technique_name,
        parameters: varRow ? { purplesharp: { variation: t.variation, ...(t.url ? { url: t.url } : {}), ...(t.command ? { command: t.command } : {}) } } : {},
        expectedSignal: t.expected_signal || "",
        notes: varRow ? t.rationale : `Not in PurpleSharp catalogue. Rationale: ${t.rationale}`,
      });
    }
  }

  const useCase = await prisma.useCase.create({
    data: {
      name: `${upload.filename} — triggering playbook`.slice(0, 240),
      description: `AI-generated from uploaded ${upload.format} rule.\n\n${synth.summary || ""}`,
      authorMode: "atomic",
      framework: wantAtomic && wantPS ? "mixed" : (wantAtomic ? "atomic" : "purplesharp"),
      source: "upload",
      sourceRefType: "UploadedDetection",
      sourceRefId: upload.id,
      mitreTechniques: JSON.stringify([...new Set(steps.map((s) => s.techniqueId).filter(Boolean))]),
      mitreTactics: JSON.stringify(tactics),
      platforms: "[]",
      tags: JSON.stringify(["uploaded", "ai-generated", upload.format]),
      steps: {
        create: steps.map((s, j) => ({
          orderIndex: s.orderIndex ?? j,
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

  // AiGeneration rows
  if (aRes) {
    await prisma.aiGeneration.create({
      data: {
        useCaseId: useCase.id,
        generator: "upload-to-playbook:atomic",
        model: "__error" in aRes ? (model || "claude-opus-4-7") : (aRes as any).model,
        inputRefType: "UploadedDetection",
        inputRefId: upload.id,
        promptVersion: RULE_TO_PLAYBOOK_V1.version,
        inputTokens: "__error" in aRes ? 0 : (aRes as any).inputTokens,
        outputTokens: "__error" in aRes ? 0 : (aRes as any).outputTokens,
        costUsd: "__error" in aRes ? 0 : (aRes as any).costUsd,
        toolName: RULE_TO_PLAYBOOK_V1.atomicTool.name,
        status: "__error" in aRes ? "error" : "ok",
        errorMessage: "__error" in aRes ? String((aRes as any).__error?.message || (aRes as any).__error).slice(0, 1000) : null,
      },
    });
  }
  if (pRes) {
    await prisma.aiGeneration.create({
      data: {
        useCaseId: useCase.id,
        generator: "upload-to-playbook:purplesharp",
        model: "__error" in pRes ? (model || "claude-opus-4-7") : (pRes as any).model,
        inputRefType: "UploadedDetection",
        inputRefId: upload.id,
        promptVersion: RULE_TO_PLAYBOOK_V1.version,
        inputTokens: "__error" in pRes ? 0 : (pRes as any).inputTokens,
        outputTokens: "__error" in pRes ? 0 : (pRes as any).outputTokens,
        costUsd: "__error" in pRes ? 0 : (pRes as any).costUsd,
        toolName: RULE_TO_PLAYBOOK_V1.purpleSharpTool.name,
        status: "__error" in pRes ? "error" : "ok",
        errorMessage: "__error" in pRes ? String((pRes as any).__error?.message || (pRes as any).__error).slice(0, 1000) : null,
      },
    });
  }

  // Pre-render playbooks (best-effort)
  try {
    const stepsForExport = useCase.steps.map((s) => ({
      id: s.id, kind: s.kind, refId: s.refId, techniqueId: s.techniqueId,
      displayName: s.displayName, parameters: s.parameters,
      expectedSignal: s.expectedSignal, notes: s.notes,
    }));
    if (wantAtomic) {
      const r = exportAtomicYaml({ useCase: { id: useCase.id, name: useCase.name, description: useCase.description }, steps: stepsForExport });
      await prisma.playbook.create({ data: { useCaseId: useCase.id, format: "atomic-yaml", version: 1, body: r.body, checksum: r.checksum, generator: "anthropic" } });
    }
    if (wantPS) {
      const r = exportPurpleSharpJson({ useCase: { id: useCase.id, name: useCase.name, description: useCase.description }, steps: stepsForExport.map((s) => ({ id: s.id, kind: s.kind, techniqueId: s.techniqueId, displayName: s.displayName, parameters: s.parameters })) });
      await prisma.playbook.create({ data: { useCaseId: useCase.id, format: "purplesharp-json", version: 1, body: r.body, checksum: r.checksum, generator: "anthropic" } });
    }
  } catch { /* pre-render is nice-to-have */ }

  await prisma.uploadedDetection.update({ where: { id: upload.id }, data: { useCaseId: useCase.id } });

  void logEvent({
    category: "usecase", action: "usecase.upload.materialise",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "usecase", targetId: useCase.id,
    message: `ai · ${steps.length} step(s) from ${upload.format} upload · ${inputTokens}/${outputTokens} tok · $${Math.round(costUsd * 10000) / 10000}`,
    details: { mode: "ai", uploadId: upload.id, stepCount: steps.length, inputTokens, outputTokens, costUsd },
  });

  return NextResponse.json({
    useCaseId: useCase.id,
    stepCount: steps.length,
    mode: "ai",
    totalCostUsd: Math.round(costUsd * 10000) / 10000,
    totalTokens: { input: inputTokens, output: outputTokens },
  });
}
