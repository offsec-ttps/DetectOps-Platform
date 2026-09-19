/**
 * ti-to-playbook @ v1
 *
 * Three sub-calls per generation:
 *   1. emit_atomic_playbook
 *   2. emit_purplesharp_playbook
 *   3. emit_detection_samples
 *
 * Each shares the same compact TI context as user message.
 */

import {
  emit_atomic_playbook,
  emit_purplesharp_playbook,
  emit_detection_samples,
} from "@/lib/llm/prompts/tools";

const COMMON_RULES = `Hard rules across all tools:
1. Cover every technique listed in mitreTechniques; only invent a dependency technique (e.g. T1059 to deliver T1003) when justified.
2. Prefer technique IDs with published Atomic Red Team coverage. The platform will discard atomic steps whose techniqueId has no upstream test.
3. For every emitted step include a one-sentence expected_signal naming the telemetry an analyst should see (Sysmon EID, Windows event ID, AWS CloudTrail event name, etc.).
4. Treat IOCs from the report as INPUT to commands (input_arguments / url / command). Never reproduce destructive operations against real identifiers — replace with example-{n} placeholders.
5. Emit ONLY via the supplied tool. No prose outside the tool call.`;

export const TI_TO_PLAYBOOK_V1 = {
  version: "ti-to-playbook@v1",
  atomicTool:       emit_atomic_playbook,
  purpleSharpTool:  emit_purplesharp_playbook,
  detectionTool:    emit_detection_samples,
  systemAtomic: `You are a purple-team playbook author. Given a structured Threat Intelligence report, emit an Atomic Red Team playbook that recreates the adversary's tradecraft in a lab.

${COMMON_RULES}

Output one ART test per technique (multiple tests are fine when variations matter). Group dependent steps in narrative order: initial access → execution → persistence → discovery → credential access → lateral movement → impact.`,
  systemPurpleSharp: `You are a purple-team playbook author. Given a structured Threat Intelligence report, emit a PurpleSharp playbook that simulates the adversary's Windows tradecraft.

${COMMON_RULES}

PurpleSharp supports a curated set of 50+ Windows ATT&CK techniques with numbered variations. Pick technique_id values that PurpleSharp implements (the platform's variation catalogue is the source of truth — if you guess wrong, the runner will reject the step). When unsure of variation, pick 1.`,
  systemDetectionSamples: `You are a detection engineer authoring sample SIEM rules that should fire when the input playbook executes. Given a Threat Intelligence report and its mapped MITRE techniques, emit between 3 and 8 detection samples covering the techniques.

${COMMON_RULES}

Each sample should be a complete, valid rule body. Prefer Sigma YAML for portability; emit SPL when the rule needs Splunk-specific functions (tstats, eval); emit KQL when it must reference Microsoft Defender tables.`,
};

export interface TiContext {
  title: string;
  description: string;
  category: string;
  severity: string;
  mitreTechniques: string[];
  actor?: string;
  targetSectors?: string[];
  iocs?: {
    network?: Array<{ type?: string; value: string }>;
    file?: Array<{ type?: string; value: string }>;
    behavioral?: string[];
  };
  references?: string[];
}

export function buildTiUserMessage(ctx: TiContext): string {
  const lines: string[] = [];
  lines.push(`# Threat report\n`);
  lines.push(`Title: ${ctx.title}`);
  if (ctx.category) lines.push(`Category: ${ctx.category}`);
  if (ctx.severity) lines.push(`Severity: ${ctx.severity}`);
  if (ctx.actor)    lines.push(`Threat actor: ${ctx.actor}`);
  if (ctx.targetSectors?.length) lines.push(`Target sectors: ${ctx.targetSectors.join(", ")}`);
  if (ctx.mitreTechniques?.length) lines.push(`MITRE techniques: ${ctx.mitreTechniques.join(", ")}`);

  if (ctx.description) {
    lines.push(`\nSummary:\n${ctx.description.slice(0, 2000)}`);
  }

  const iocSummary: string[] = [];
  const limit = 8;
  if (ctx.iocs?.network?.length) {
    iocSummary.push(`Network: ${ctx.iocs.network.slice(0, limit).map((x) => x.value).join(", ")}${ctx.iocs.network.length > limit ? " …" : ""}`);
  }
  if (ctx.iocs?.file?.length) {
    iocSummary.push(`File: ${ctx.iocs.file.slice(0, limit).map((x) => x.value).join(", ")}${ctx.iocs.file.length > limit ? " …" : ""}`);
  }
  if (ctx.iocs?.behavioral?.length) {
    iocSummary.push(`Behavioral: ${ctx.iocs.behavioral.slice(0, 10).join(", ")}`);
  }
  if (iocSummary.length) lines.push(`\nIOCs:\n  ${iocSummary.join("\n  ")}`);

  if (ctx.references?.length) {
    lines.push(`\nReferences:\n  ${ctx.references.slice(0, 5).join("\n  ")}`);
  }

  lines.push(`\nEmit the playbook now via the provided tool.`);
  return lines.join("\n");
}
