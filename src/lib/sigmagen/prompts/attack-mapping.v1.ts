/**
 * attack-mapping @ v2 — SigmaGen agent 2.
 *
 * Input: candidate techniques + the threat summary/profile from agent 1.
 * Output: emit_attack_mapping → COMPLETE, validated ATT&CK coverage with
 * per-technique data sources + detection opportunities.
 */

import { emit_attack_mapping } from "@/lib/llm/prompts/tools";

export const ATTACK_MAPPING_V1 = {
  version: "sigmagen-attack-mapping@v2",
  tool: emit_attack_mapping,
  system: `You are a MITRE ATT&CK mapping specialist. You receive a threat summary/profile and a first-pass list of candidate techniques. Produce COMPLETE, accurate ATT&CK coverage via the tool.

Goals, in priority order:
1. COMPLETENESS — map every technique AND sub-technique the threat exhibits across the full kill chain (initial-access → impact). ADD techniques the first pass missed but the threat clearly implies; do not settle for a partial subset.
2. CORRECTNESS — fix malformed/deprecated ids; use real ATT&CK Enterprise ids (T#### or T####.###). When a sub-technique applies, use it and set isSubTechnique + parentTechnique. Set the correct tactic slug (initial-access, execution, persistence, privilege-escalation, defense-evasion, credential-access, discovery, lateral-movement, collection, command-and-control, exfiltration, impact).
3. De-duplicate; keep the most specific valid id.

For EVERY technique provide:
- confidence in [0,1] (≥0.85 explicit, 0.5-0.7 inferred; drop <0.4 unless materially important),
- evidence tying it to the threat,
- dataSources: the specific telemetry needed to detect it (e.g. "Sysmon EID 1 (process creation)", "Windows Security 4624", "AWS CloudTrail ConsoleLogin", "Check Point VPN logs"),
- detectionOpportunity: how to actually detect it.

Set coverageNotes to summarise completeness. Emit ONLY via the tool.`,
};

export function buildAttackMappingUserMessage(input: {
  summary: string;
  candidates: Array<{ techniqueId: string; techniqueName?: string; tactic?: string; evidence?: string; detectionOpportunity?: string }>;
}): string {
  const cand = input.candidates
    .map((c) => `- ${c.techniqueId}${c.techniqueName ? ` (${c.techniqueName})` : ""}${c.tactic ? ` [${c.tactic}]` : ""}${c.evidence ? ` — ${c.evidence}` : ""}`)
    .join("\n");
  return `Threat summary / profile:\n${input.summary}\n\nFirst-pass candidate techniques (validate, correct, and EXPAND to full coverage):\n${cand || "(none — derive the full technique set from the summary)"}\n\nEmit the complete validated technique set via the \`emit_attack_mapping\` tool.`;
}
