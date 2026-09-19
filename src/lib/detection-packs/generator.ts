/**
 * Detection Pack generator — orchestrates the two-tool LLM flow + persistence.
 *
 *   1. Load source row (TI report OR community rule)
 *   2. Build a digest + extract techniques + heuristic platform classification
 *   3. runTool(emit_detection_pack)  ← primary pack call (Sonnet by default)
 *   4. runTool(emit_ir_playbook)     ← IRP follow-up (Opus by default for prose quality)
 *   5. inferSimulations(techniques)  ← non-LLM ART/PurpleSharp/Stratus mapping
 *   6. Transactional persist
 *   7. AiGeneration rows + event log per tool call
 */

import { prisma } from "@/lib/prisma";
import { runTool, PROVIDERS, defaultProviderId, LlmProviderError, type ProviderId } from "@/lib/llm";
import { smartDefaultProvider } from "@/lib/llm/providers/registry";
import { listConfiguredKinds } from "@/lib/llm/db-config";
import { DETECTION_PACK_V1, buildDetectionPackUserMessage } from "@/lib/llm/prompts/detection-pack.v1";
import { IR_PLAYBOOK_V1, buildIrPlaybookUserMessage } from "@/lib/llm/prompts/ir-playbook.v1";
import { classifyPlatform } from "./classify";
import { extractReferences } from "./references";
import { inferSimulations } from "./infer-sims";
import { persistPack } from "./persist";
import { logEvent } from "@/lib/event-log";
import { enrichContext } from "@/lib/llm/mcp/enrich";

export interface GenerateInput {
  sourceType: "ti" | "rule";
  sourceTable: string;                                       // ThreatIntelReport | CommunityRule | CommunitySigmaRule | CommunityElasticRule | SplunkDetection
  sourceRefId: string;
  /** Provider override; defaults to LLM_PROVIDER_DEFAULT (=anthropic). Applies to BOTH the pack pass and the IRP pass unless `irpProvider` is set. */
  provider?: ProviderId;
  /** Optional separate provider for the IRP pass — useful when the user wants Anthropic-Opus for IRP prose but OpenAI for the structured pack. */
  irpProvider?: ProviderId;
  packModel?: string;                                        // default: provider's defaultModel()
  irpModel?: string;                                         // default: provider's defaultModel() for IRP — Opus for Anthropic
  actor?: string;
}

export interface GenerateResult {
  packId: string;
  totalCostUsd: number;
  totalTokens: { input: number; output: number };
  costBreakdown: {
    pack: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
    irp:  { inputTokens: number; outputTokens: number; costUsd: number; model: string } | null;
  };
}

export class DetectionPackError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

interface LoadedSource {
  digest: string;
  techniques: string[];
  rawText: string;                                           // joined for reference extraction
  inputRefType: string;                                      // for AiGeneration.inputRefType
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

async function loadSource(sourceTable: string, sourceRefId: string): Promise<LoadedSource> {
  const m = sourceTable;
  // TI reports
  if (m === "ThreatIntelReport") {
    const r = await prisma.threatIntelReport.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "ThreatIntelReport not found");
    const techRaw = safeJson<unknown[]>(r.mitreTechniques, []);
    const techniques = techRaw
      .map((t) => typeof t === "string" ? t : (t as any)?.technique_id || (t as any)?.id || "")
      .filter((s: string) => /^T\d{4}(\.\d{3})?$/.test(s));
    const iocs = r.iocs || "{}";
    const digest = [
      `Title: ${r.title}`,
      `Vendor: ${r.sourceVendor || "(unknown)"} · Severity: ${r.severityLevel} · Category: ${r.category} · Threat actor: ${r.threatActor || "(unknown)"}`,
      r.summary ? `Summary: ${r.summary}` : "",
      r.description ? `Description (excerpt): ${r.description.slice(0, 2500)}` : "",
      `Techniques: ${techniques.join(", ") || "(none extracted)"}`,
      `IOCs blob (excerpt): ${iocs.slice(0, 1200)}`,
      `References: ${r.references || "[]"}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.title, r.summary, r.description, iocs, r.references].filter(Boolean).join(" "),
      inputRefType: "ThreatIntelReport",
    };
  }

  // Community rules
  if (m === "CommunitySigmaRule") {
    const r = await prisma.communitySigmaRule.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "CommunitySigmaRule not found");
    const techniques = safeJson<string[]>(r.mitreTechniques, []);
    const digest = [
      `Title: ${r.title}`,
      `Level: ${r.level} · Status: ${r.status} · Logsource: ${r.logsourceProduct || ""}/${r.logsourceCategory || ""}/${r.logsourceService || ""}`,
      r.description ? `Description: ${r.description.slice(0, 2000)}` : "",
      `Sigma YAML:\n${(r.detectionYaml || "").slice(0, 4000)}`,
      `Falsepositives: ${r.falsepositives || ""}`,
      `Techniques: ${techniques.join(", ") || "(none)"}`,
      `References: ${r.references || ""}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.title, r.description, r.detectionYaml, r.references].filter(Boolean).join(" "),
      inputRefType: "CommunitySigmaRule",
    };
  }

  if (m === "CommunityElasticRule") {
    const r = await prisma.communityElasticRule.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "CommunityElasticRule not found");
    const techniques = safeJson<string[]>(r.mitreTechniques, []);
    const digest = [
      `Title: ${r.name}`,
      `Severity: ${r.severity} · Risk: ${r.riskScore} · Type: ${r.type} · Language: ${r.language} · Platform: ${r.platform || "n/a"}`,
      r.description ? `Description: ${r.description.slice(0, 2000)}` : "",
      `Query:\n${(r.query || "").slice(0, 4000)}`,
      `Falsepositives: ${r.falsepositives || ""}`,
      `Techniques: ${techniques.join(", ") || "(none)"}`,
      `References: ${r.references || ""}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.name, r.description, r.query, r.references].filter(Boolean).join(" "),
      inputRefType: "CommunityElasticRule",
    };
  }

  if (m === "SplunkDetection") {
    const r = await prisma.splunkDetection.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "SplunkDetection not found");
    const techniques = safeJson<string[]>(r.mitreTechniques, []);
    const digest = [
      `Title: ${r.name}`,
      `Type: ${r.type} · Status: ${r.status} · Data source: ${r.dataSource || "(unknown)"}`,
      r.description ? `Description: ${r.description.slice(0, 2000)}` : "",
      `SPL:\n${(r.search || "").slice(0, 4000)}`,
      `How to implement: ${(r.howToImplement || "").slice(0, 800)}`,
      `Known FPs: ${r.knownFalsePositives || ""}`,
      `Techniques: ${techniques.join(", ") || "(none)"}`,
      `References: ${r.references || ""}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.name, r.description, r.search, r.references].filter(Boolean).join(" "),
      inputRefType: "SplunkDetection",
    };
  }

  // SigmaGen pipeline runs — the multi-agent front-end (intel-extract →
  // ATT&CK-map → use-case) writes a digest + mapped techniques + references
  // onto the SigmaGenRun row, then calls generateDetectionPack with this
  // sourceTable so the detection/sim/IRP/persist tail is shared verbatim.
  if (m === "SigmaGenRun") {
    const r = await prisma.sigmaGenRun.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "SigmaGenRun not found");
    const techniques = safeJson<string[]>(r.techniques, [])
      .filter((s) => /^T\d{4}(\.\d{3})?$/.test(s));
    const digest = [
      `Title: ${r.inputTitle || "SigmaGen session"}`,
      `Input kind: ${r.inputKind}`,
      r.normalizedText ? `Threat intelligence digest:\n${r.normalizedText.slice(0, 12_000)}` : "",
      `Techniques: ${techniques.join(", ") || "(none extracted)"}`,
      `References: ${r.references || "[]"}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.inputTitle, r.normalizedText, r.references].filter(Boolean).join(" "),
      inputRefType: "SigmaGenRun",
    };
  }

  if (m === "CommunityRule") {
    const r = await prisma.communityRule.findUnique({ where: { id: sourceRefId } });
    if (!r) throw new DetectionPackError("source-not-found", "CommunityRule not found");
    const techniques = safeJson<string[]>(r.mitreTechniques, []);
    const digest = [
      `Title: ${r.title}`,
      `Severity: ${r.severity} · Rule language: ${r.ruleLanguage} · Rule type: ${r.ruleType}`,
      r.description ? `Description: ${r.description.slice(0, 2000)}` : "",
      `Detection logic:\n${(r.detectionLogicRaw || "").slice(0, 4000)}`,
      `Falsepositives: ${r.falsePositives || ""}`,
      `Techniques: ${techniques.join(", ") || "(none)"}`,
      `References: ${r.references || ""}`,
    ].filter(Boolean).join("\n\n");
    return {
      digest,
      techniques,
      rawText: [r.title, r.description, r.detectionLogicRaw, r.references].filter(Boolean).join(" "),
      inputRefType: "CommunityRule",
    };
  }

  throw new DetectionPackError("unsupported-source", `Unsupported sourceTable: ${sourceTable}`);
}

export async function generateDetectionPack(input: GenerateInput): Promise<GenerateResult> {
  // Resolve provider intelligently: explicit caller choice wins; otherwise
  // smartDefaultProvider() picks the best-configured provider (env or DB).
  const provider = (input.provider || (await smartDefaultProvider())) as ProviderId;
  if (!PROVIDERS[provider]) {
    throw new DetectionPackError("unknown_provider", `Unknown provider: ${provider}`);
  }
  // Configured-ness check now considers DB-managed configs too — without
  // this, env-only checks (e.g. PROVIDERS.openai.isConfigured()) would
  // reject a provider whose key was saved through the LLM Providers UI.
  const dbKinds = await listConfiguredKinds().catch(() => new Set<string>());
  const isConfigured = (id: ProviderId): boolean => PROVIDERS[id].isConfigured() || dbKinds.has(id);

  if (!isConfigured(provider)) {
    throw new DetectionPackError("missing_api_key", `Provider "${provider}" has no API key (env or stored). Add one at /settings/llm-providers.`);
  }
  const irpProvider = (input.irpProvider || provider) as ProviderId;
  if (!isConfigured(irpProvider)) {
    throw new DetectionPackError("missing_api_key", `IRP provider "${irpProvider}" has no API key (env or stored). Add one at /settings/llm-providers.`);
  }

  const t0 = Date.now();
  const src = await loadSource(input.sourceTable, input.sourceRefId);

  // 1. Heuristic classification + MCP enrichment hint (Phase 2: registry-only)
  const platformHint = classifyPlatform({ text: src.rawText, techniques: src.techniques });
  const enrichment = await enrichContext({ techniques: src.techniques });

  // 2. Run emit_detection_pack
  const packModel = input.packModel || PROVIDERS[provider].defaultModel();
  const userMsg = buildDetectionPackUserMessage({
    kind: input.sourceType,
    digest: enrichment.enrichment ? `${src.digest}\n\n${enrichment.enrichment}` : src.digest,
    platformHint,
    techniques: src.techniques,
  });
  let packResult;
  try {
    packResult = await runTool({
      provider,
      model: packModel,
      system: DETECTION_PACK_V1.system,
      user: userMsg,
      tool: DETECTION_PACK_V1.tool,
      maxTokens: 6144,
    });
  } catch (err) {
    if (err instanceof LlmProviderError) {
      throw new DetectionPackError(err.code, `Pack generation failed (${provider}): ${err.message}`);
    }
    throw new DetectionPackError("pack-llm-failed", `Pack generation failed: ${(err as Error).message || err}`);
  }
  const packData = (packResult.data as any).pack;
  if (!packData || !packData.name || !Array.isArray(packData.rules)) {
    throw new DetectionPackError("pack-malformed", "Pack tool returned malformed structure");
  }

  // 3. Record the pack AiGeneration row
  const packGen = await prisma.aiGeneration.create({
    data: {
      generator: input.sourceType === "ti" ? "detection-pack:from-ti" : "detection-pack:from-rule",
      model: packResult.model,
      inputRefType: src.inputRefType,
      inputRefId: input.sourceRefId,
      promptVersion: DETECTION_PACK_V1.version,
      inputTokens: packResult.inputTokens,
      outputTokens: packResult.outputTokens,
      costUsd: packResult.costUsd,
      toolName: DETECTION_PACK_V1.tool.name,
      toolCalls: JSON.stringify([packResult.rawToolCall]),
      rawResponse: JSON.stringify(packResult.data).slice(0, 50_000),
      status: "ok",
    },
  });

  // 4. Merge extracted references with what the LLM returned
  const extractedRefs = extractReferences(src.rawText);
  const mergedRefs = mergeReferences(packData.references, extractedRefs);

  // 5. Run emit_ir_playbook (defaults to provider's default model unless overridden;
  //    Anthropic gets the prose-optimised Opus by default for IRP quality)
  const irpModel = input.irpModel
    ?? (irpProvider === "anthropic" ? "claude-opus-4-7" : PROVIDERS[irpProvider].defaultModel());
  const packSummary = [
    `Name: ${packData.name}`,
    `Category: ${packData.category} · Severity: ${packData.severity} · Risk: ${packData.riskScore}`,
    `Platforms: ${(packData.platforms || []).join(", ")}`,
    `Data sources: ${(packData.dataSources || []).join(", ")}`,
    `Techniques: ${(packData.mitreTechniques || []).join(", ")}`,
    `Detection rules (titles only): ${(packData.rules || []).map((r: any) => `[${r.format}] ${r.title}`).join("; ")}`,
  ].join("\n");

  let irpResult: any = null;
  let irpError: Error | null = null;
  try {
    irpResult = await runTool({
      provider: irpProvider,
      model: irpModel,
      system: IR_PLAYBOOK_V1.system,
      user: buildIrPlaybookUserMessage({ digest: src.digest, packSummary }),
      tool: IR_PLAYBOOK_V1.tool,
      maxTokens: 6144,
    });
  } catch (err: any) {
    irpError = err;
  }

  let irpGen: { id: string; inputTokens: number; outputTokens: number; costUsd: number; model: string } | null = null;
  if (irpResult) {
    const row = await prisma.aiGeneration.create({
      data: {
        generator: input.sourceType === "ti" ? "detection-pack:irp-from-ti" : "detection-pack:irp-from-rule",
        model: irpResult.model,
        inputRefType: src.inputRefType,
        inputRefId: input.sourceRefId,
        promptVersion: IR_PLAYBOOK_V1.version,
        inputTokens: irpResult.inputTokens,
        outputTokens: irpResult.outputTokens,
        costUsd: irpResult.costUsd,
        toolName: IR_PLAYBOOK_V1.tool.name,
        toolCalls: JSON.stringify([irpResult.rawToolCall]),
        rawResponse: JSON.stringify(irpResult.data).slice(0, 50_000),
        status: "ok",
      },
    });
    irpGen = { id: row.id, inputTokens: irpResult.inputTokens, outputTokens: irpResult.outputTokens, costUsd: irpResult.costUsd, model: irpResult.model };
  } else if (irpError) {
    await prisma.aiGeneration.create({
      data: {
        generator: input.sourceType === "ti" ? "detection-pack:irp-from-ti" : "detection-pack:irp-from-rule",
        model: irpModel,
        inputRefType: src.inputRefType,
        inputRefId: input.sourceRefId,
        promptVersion: IR_PLAYBOOK_V1.version,
        inputTokens: 0, outputTokens: 0, costUsd: 0,
        toolName: IR_PLAYBOOK_V1.tool.name,
        toolCalls: "[]",
        rawResponse: "",
        status: "error",
        errorMessage: String(irpError.message || irpError).slice(0, 1000),
      },
    });
  }

  // 6. Infer ART/PurpleSharp/Stratus simulations from the pack's techniques
  const sims = await inferSimulations({ techniques: packData.mitreTechniques || src.techniques });

  // 7. Transactional persist
  const pack = await persistPack({
    sourceType: input.sourceType,
    sourceTable: input.sourceTable,
    sourceRefId: input.sourceRefId,
    generatorRunId: packGen.id,
    packTool: { ...packData, references: mergedRefs },
    irpTool: irpResult ? (irpResult.data as any) : undefined,
    simulations: sims,
  });

  const totalIn  = packResult.inputTokens + (irpGen?.inputTokens || 0);
  const totalOut = packResult.outputTokens + (irpGen?.outputTokens || 0);
  const totalCost = packResult.costUsd + (irpGen?.costUsd || 0);

  void logEvent({
    category: "detection-pack",
    action: input.sourceType === "ti" ? "detection-pack.generate.from-ti" : "detection-pack.generate.from-rule",
    actor: input.actor || "anonymous",
    status: "ok",
    durationMs: Date.now() - t0,
    targetType: "DetectionPack",
    targetId: pack.id,
    message: `${packData.name} · ${packData.rules.length} rule(s) · ${sims.length} sim(s) · ${totalIn}/${totalOut} tok · $${totalCost.toFixed(4)}`,
    details: {
      packId: pack.id,
      sourceTable: input.sourceTable,
      sourceRefId: input.sourceRefId,
      provider,
      irpProvider,
      category: packData.category,
      severity: packData.severity,
      ruleFormats: packData.rules.map((r: any) => r.format),
      simulationCount: sims.length,
      irpStatus: irpResult ? "ok" : "error",
      mcpEnrichmentServers: enrichment.servers.map((s) => s.name),
      cost: { pack: packResult.costUsd, irp: irpGen?.costUsd || 0, total: totalCost },
    },
  });

  return {
    packId: pack.id,
    totalCostUsd: totalCost,
    totalTokens: { input: totalIn, output: totalOut },
    costBreakdown: {
      pack: { inputTokens: packResult.inputTokens, outputTokens: packResult.outputTokens, costUsd: packResult.costUsd, model: packResult.model },
      irp: irpGen,
    },
  };
}

function mergeReferences(
  llm: Array<{ title: string; url: string; type: string }> | undefined,
  extracted: Array<{ title: string; url: string; type: string }>,
): Array<{ title: string; url: string; type: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string; type: string }> = [];
  for (const r of [...(llm || []), ...extracted]) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ title: r.title || r.url, url: r.url, type: (r.type || "other") });
    if (out.length >= 30) break;
  }
  return out;
}
