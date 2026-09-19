/**
 * Documented contracts for agent + reverse-shell + bind-shell step runners.
 *
 * Phase 3 ships these as STUBS — the dispatcher records a step result with a
 * "[STUB] …" notes string and returns success without actually executing
 * anything. Each function here documents the contract a real runner must
 * honour when it ships.
 *
 * Every stub returns:
 *   {
 *     status: "stubbed",
 *     stdout: "[STUB] <note>",
 *     stderr: "",
 *     exitCode: 0,
 *     durationMs: number,
 *     notes: string,
 *   }
 */

import type { EnvironmentTarget } from "@/generated/prisma/client";
import type { ScenarioStep, StepRunResult } from "./runner";

function nowDelta(t0: number) { return Date.now() - t0; }

/**
 * AGENT contract.
 *
 *   When the platform has a running agent enrolled (HTTP-poll model):
 *     1. Look up the agent session by env.agentEnrollmentToken (decrypt first).
 *     2. Enqueue the step in the agent's command queue:
 *        POST /api/agent/{enrollmentToken}/command
 *        body: { stepId, command, executor, timeoutMs }
 *     3. Wait (with timeout) for the agent to PUT the result:
 *        PUT /api/agent/{enrollmentToken}/command/{stepId}/result
 *        body: { exitCode, stdout, stderr, durationMs }
 *     4. Persist result back into stepResults.
 *
 *   Phase 3 SHIP: agent endpoints don't exist yet. Stub returns success.
 */
export async function runAgentStep(env: EnvironmentTarget, step: ScenarioStep): Promise<StepRunResult> {
  const t0 = Date.now();
  const note = `agent runner not yet implemented — would have dispatched "${step.displayName}" (framework=${step.framework}) to agent enrolment ${env.hostname || "<no-hostname>"}.`;
  return {
    status: "stubbed",
    exitCode: 0,
    stdout: `[STUB] ${note}`,
    stderr: "",
    durationMs: nowDelta(t0),
    notes: `[STUB] agent kind: ${note}`,
  };
}

/**
 * REVERSE-SHELL / BIND-SHELL contract.
 *
 *   Once implemented:
 *     reverse-shell:
 *       1. Start listener on env.listenerHost:env.listenerPort
 *       2. Deliver env.payloadRef to the target (out-of-band; how is per-env)
 *       3. Wait for the call-back; once connected, send the step command
 *       4. Capture stdout/stderr until prompt returns
 *
 *     bind-shell:
 *       1. Connect to env.hostname:env.port (the bind listener)
 *       2. Send the step command
 *       3. Capture output
 *
 *   Phase 3 SHIP: returns success without acting.
 */
export async function runShellStep(env: EnvironmentTarget, step: ScenarioStep): Promise<StepRunResult> {
  const t0 = Date.now();
  const mode = env.shellMode || "(unset)";
  const listener = mode === "reverse" ? `${env.listenerHost}:${env.listenerPort}` : `${env.hostname}:${env.port}`;
  const note = `${mode}-shell runner not yet implemented — would have delivered payload ${env.payloadRef || "<none>"} via ${listener} and executed "${step.displayName}".`;
  return {
    status: "stubbed",
    exitCode: 0,
    stdout: `[STUB] ${note}`,
    stderr: "",
    durationMs: nowDelta(t0),
    notes: `[STUB] shell kind: ${note}`,
  };
}

/**
 * Generic "framework × env unsupported here" stub.
 *
 *   E.g. atomic step on a user-cloud env (where SSH credentials aren't set).
 *   Same shape as the others so the dispatcher can treat them uniformly.
 */
export async function runUnsupportedStep(env: EnvironmentTarget, step: ScenarioStep, reason: string): Promise<StepRunResult> {
  const t0 = Date.now();
  const note = `${step.framework} step "${step.displayName}" is not supported on env kind "${env.kind}": ${reason}`;
  return {
    status: "stubbed",
    exitCode: 0,
    stdout: `[STUB] ${note}`,
    stderr: "",
    durationMs: nowDelta(t0),
    notes: `[STUB] ${note}`,
  };
}
