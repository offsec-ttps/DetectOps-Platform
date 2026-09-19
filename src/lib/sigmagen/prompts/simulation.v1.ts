/**
 * simulation @ v1 — SigmaGen custom-simulation fallback.
 *
 * Used only for techniques with NO suitable Atomic Red Team test in the
 * catalogue. Produces a runnable emulation procedure + cleanup + expected
 * telemetry so the generated detection can still be validated.
 */

import { emit_custom_simulation } from "@/lib/llm/prompts/tools";

export const SIMULATION_V1 = {
  version: "sigmagen-simulation@v1",
  tool: emit_custom_simulation,
  system: `You are a red-team automation engineer. You are given a single MITRE ATT&CK technique and threat context for which NO Atomic Red Team test exists. Produce a custom adversary-emulation procedure via the tool.

Rules:
1. Pick the most appropriate executor (powershell, bash, python, cmd, or manual) for the technique's platform.
2. The command/script must be SELF-CONTAINED and SAFE to run in an isolated lab — it should emulate the technique's observable behaviour, NOT cause real damage, deploy real malware, or exfiltrate real data. Use benign stand-ins (e.g. EICAR, a test file, a controlled callback) where the real action would be destructive.
3. Provide a cleanupCommand that reverts any changes the procedure makes.
4. State prerequisites (tools, privileges, lab state).
5. expectedTelemetry: the specific log/EDR events the procedure should generate, so an analyst can confirm the detection fires.
6. Emit ONLY via the tool.`,
};

export function buildSimulationUserMessage(input: { techniqueId: string; techniqueName?: string; threatContext: string }): string {
  return `Technique needing a custom simulation: ${input.techniqueId}${input.techniqueName ? ` (${input.techniqueName})` : ""}\n\nThreat context:\n${input.threatContext.slice(0, 2000)}\n\nNo Atomic Red Team test covers this technique. Emit a safe, runnable custom emulation via the \`emit_custom_simulation\` tool.`;
}
