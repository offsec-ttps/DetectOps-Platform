/**
 * rule-to-playbook @ v1
 *
 * Reverse-mapping prompts: given a detection rule, propose the **minimum**
 * sequence of adversary actions that would cause its detection logic to
 * fire. Two parallel sub-calls:
 *   - emit_atomic_playbook       — ART tests to trigger the rule
 *   - emit_purplesharp_playbook  — PurpleSharp tasks to trigger the rule
 *
 * The user message is a structured rule context (title, language, logsource,
 * mitre tags, raw body). The model is instructed to **prefer** the rule's
 * own MITRE techniques and only add steps necessary for the rule to fire
 * (e.g. process creation as a prerequisite for a registry write).
 */

import {
  emit_atomic_playbook,
  emit_purplesharp_playbook,
} from "@/lib/llm/prompts/tools";
import type { RuleContext } from "@/lib/use-cases/parsers/shared";

const SHARED_RULES = `Hard rules:
1. The output playbook MUST trigger the input detection. Prefer techniques the rule's mitreTechniques tag set already names; only add dependency steps when the rule cannot fire without them.
2. Ground every step in real adversary tradecraft — no placeholder noise like "do something".
3. For every step include a one-sentence expected_signal that names the telemetry the rule logic looks for (Sysmon EID, Windows event ID, AWS CloudTrail event name, etc.).
4. Treat any sample IOCs in the rule as test inputs (input_arguments / url / command), not as detection logic.
5. Never emit destructive operations against real identifiers — use example-{n} placeholders.
6. Keep playbooks minimal — typically 1-5 steps. Don't bloat to cover every theoretical variation.
7. Emit ONLY via the supplied tool. No prose outside the tool call.`;

export const RULE_TO_PLAYBOOK_V1 = {
  version: "rule-to-playbook@v1",
  atomicTool: emit_atomic_playbook,
  purpleSharpTool: emit_purplesharp_playbook,
  systemAtomic: `You are an Atomic Red Team author. Given a SIEM/EDR detection rule, emit an ART playbook whose tests would trigger that rule when executed in a target environment.

${SHARED_RULES}

If the rule looks for specific Sysmon EIDs / command lines / registry paths, choose executors and commands that produce exactly those signals.`,
  systemPurpleSharp: `You are a PurpleSharp playbook author. Given a SIEM/EDR detection rule (typically Windows-focused), emit a PurpleSharp playbook whose tasks would trigger that rule when executed.

${SHARED_RULES}

PurpleSharp implements a curated 50-technique catalogue. Pick (technique_id, variation) values from your training knowledge of PurpleSharp — the platform will validate against its catalogue and downgrade any unknown picks to manual steps with your rationale preserved.`,
};

/** Compact rule context the LLM sees as user message. */
export function buildRuleUserMessage(ctx: RuleContext): string {
  const lines: string[] = [];
  lines.push(`# Detection rule (reverse-engineer a triggering playbook)`);
  lines.push(`Source: ${ctx.sourceTable}`);
  lines.push(`Title: ${ctx.title}`);
  if (ctx.severity)        lines.push(`Severity: ${ctx.severity}`);
  lines.push(`Language: ${ctx.ruleLanguage}`);
  if (ctx.mitreTechniques.length) lines.push(`MITRE techniques (rule tags): ${ctx.mitreTechniques.join(", ")}`);
  if (ctx.mitreTactics.length)    lines.push(`MITRE tactics: ${ctx.mitreTactics.join(", ")}`);
  if (ctx.logSources.length)      lines.push(`Log sources: ${ctx.logSources.join(", ")}`);
  if (ctx.platforms.length)       lines.push(`Platforms: ${ctx.platforms.join(", ")}`);
  if (ctx.products.length)        lines.push(`Products: ${ctx.products.join(", ")}`);

  if (ctx.description) {
    lines.push(`\nDescription:\n${ctx.description.slice(0, 1500)}`);
  }

  lines.push(`\nDetection logic (${ctx.ruleLanguage}):\n\`\`\`${ctx.ruleLanguage}\n${ctx.detectionLogic}\n\`\`\``);

  if (ctx.falsePositives.length) {
    lines.push(`\nKnown false positives:\n${ctx.falsePositives.slice(0, 3).map((f) => `  - ${f}`).join("\n")}`);
  }

  lines.push(`\nEmit the playbook now via the provided tool.`);
  return lines.join("\n");
}
