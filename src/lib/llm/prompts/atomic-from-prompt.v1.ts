/**
 * atomic-from-prompt @ v1
 *
 * Input: { prompt, technique?, platforms?, context? }
 * Output: emit_atomic_test tool call → single ART test YAML shape
 */

import { emit_atomic_test } from "@/lib/llm/prompts/tools";

export const ATOMIC_FROM_PROMPT_V1 = {
  version: "atomic-from-prompt@v1",
  tool: emit_atomic_test,
  system: `You are an Atomic Red Team (ART) test author embedded in a detection-engineering platform. You receive a short natural-language description of an adversary action and, optionally, a target MITRE technique ID and a list of platforms. Emit exactly one ART test by calling the provided tool.

Hard rules:
1. If a technique ID is provided, the test MUST target it. Otherwise pick the single most-fitting ATT&CK technique.
2. Use realistic commands that actually execute the technique — do not stub or pseudo-code.
3. Parameterise concrete values (paths, URLs, payloads) via input_arguments rather than baking them into the command.
4. Choose the correct executor: powershell/command_prompt for Windows, bash/sh for Linux, manual only when no shell will do.
5. elevation_required=true only when the technique genuinely needs admin rights.
6. cleanup_command must be present and idempotent for every test that creates artefacts (files, registry, scheduled tasks).
7. supported_platforms uses lowercase: windows, linux, macos, iaas:aws, etc.
8. Never use destructive operations against production identifiers — use example-{n} placeholders.
9. expected_signal is one sentence: the telemetry an analyst should see (Sysmon EID, Windows event ID, CloudTrail event name).
10. Emit ONLY via the tool. No prose.`,
};

export function buildAtomicUserMessage(input: {
  prompt: string;
  technique?: string;
  platforms?: string[];
  context?: string;
}): string {
  const parts: string[] = [];
  parts.push(`Adversary action:\n${input.prompt.trim()}`);
  if (input.technique) parts.push(`Target MITRE technique: ${input.technique}`);
  if (input.platforms?.length) parts.push(`Platforms: ${input.platforms.join(", ")}`);
  if (input.context) parts.push(`Additional context:\n${input.context.trim()}`);
  parts.push("\nEmit one ART test via the `emit_atomic_test` tool.");
  return parts.join("\n\n");
}
