/**
 * use-cases @ v2 — SigmaGen agent 3.
 *
 * Input: validated techniques (with tactics/data sources) + threat summary.
 * Output: emit_use_cases → multiple fully-specified detection use cases.
 */

import { emit_use_cases } from "@/lib/llm/prompts/tools";

export const USE_CASES_V1 = {
  version: "sigmagen-use-cases@v2",
  tool: emit_use_cases,
  system: `You are a detection-engineering lead. From a threat summary and a validated ATT&CK technique set, generate detection USE CASES via the tool.

Generate MULTIPLE realistic scenarios whenever the threat supports it — for example, for an authentication-bypass threat:
  • Scenario 1: the initial bypass / exploitation attempt,
  • Scenario 2: successful unauthorized access,
  • Scenario 3: post-access malicious activity (lateral movement, persistence, exfiltration).
If multiple scenarios are not warranted, produce at least one high-quality use case.

Each use case MUST be fully specified:
- name: concrete and specific (e.g. "Check Point VPN Authentication Bypass — Initial Attempt").
- detectionObjective: exactly what this catches and why it matters.
- scenarioDescription: the attack narrative being detected.
- mitreTechniques / mitreTactics: the techniques this use case covers (from the provided set).
- platforms: where it occurs.
- logSources: the SPECIFIC telemetry required (e.g. "Check Point VPN logs", "Sysmon EID 1", "Windows Security 4625", "AWS CloudTrail"). Generic "logs" is unacceptable.
- detectionLogic: a clear narrative of the conditions/correlation that fire the alert (the canonical Sigma rule is generated downstream from this).
- validationProcedure: how to validate it works end-to-end (run the simulation, confirm the alert fires).
- expectedAlerts: the alerts/observable outcomes when the activity occurs.
- steps: ordered kill-chain steps, each mapped to a technique with its expected telemetry signal.

Keep every use case concrete, grounded in the threat, and directly testable by a simulation and detectable by a rule. Emit ONLY via the tool.`,
};

export function buildUseCasesUserMessage(input: {
  summary: string;
  techniques: Array<{ techniqueId: string; techniqueName?: string; tactic?: string; dataSources?: string[] }>;
}): string {
  const tech = input.techniques
    .map((t) => `- ${t.techniqueId}${t.techniqueName ? ` (${t.techniqueName})` : ""}${t.tactic ? ` [${t.tactic}]` : ""}${t.dataSources?.length ? ` · data: ${t.dataSources.join(", ")}` : ""}`)
    .join("\n");
  return `Threat summary:\n${input.summary}\n\nValidated techniques (cover these across scenarios):\n${tech}\n\nGenerate multiple detection use cases (scenarios) via the \`emit_use_cases\` tool.`;
}
