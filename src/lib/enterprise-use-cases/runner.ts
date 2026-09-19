/**
 * Enterprise Use Case scenario runner.
 *
 * Lifecycle of a single `runScenario` call:
 *
 *   1. Validate (scenario, environment, mode, selected logic body)
 *   2. Insert an EnterpriseUseCaseRun row (status="running")
 *   3. For each step:
 *        - Dispatch (env.kind × step.framework) → executor
 *        - Append a row to stepResults
 *   4. If mode === "simulate-and-validate":
 *        - Call validate-coverage against the user's SIEM
 *        - Record detectionResults + validationOutcome
 *   5. Update the run row (status=success|failure|timeout)
 *
 * Dispatch matrix (Phase 3 ship):
 *
 *   our-template-deployed    × atomic        → SSH-execute the ART command (real)
 *   our-template-deployed    × manual        → SSH-execute the parameters.command (real)
 *   our-template-deployed    × stratus       → unsupported stub (stratus belongs on user-cloud)
 *   our-template-deployed    × purplesharp   → unsupported stub (needs Windows binary deployment)
 *   our-template-deployed    × agent/shell   → unsupported stub
 *
 *   user-cloud               × stratus       → call existing src/lib/stratus/runner (real)
 *   user-cloud               × *             → unsupported stub
 *
 *   agent                    × *             → runAgentStep (stub)
 *   shell                    × *             → runShellStep (stub)
 *
 * Wall-clock cap: ENTERPRISE_UC_RUN_TIMEOUT_MS (default 300_000) per run.
 */

import { spawn } from "node:child_process";
import { prisma } from "@/lib/prisma";
import type { EnvironmentTarget, EnterpriseUseCase } from "@/generated/prisma/client";
import { runStratus } from "@/lib/stratus/runner";
import { logEvent } from "@/lib/event-log";
import { validateCoverage, type CoverageOutcome } from "./validate-coverage";
import { runAgentStep, runShellStep, runUnsupportedStep } from "./stub-runners";
import { runCaldera } from "./caldera-runner";

export type StepStatus = "ok" | "failure" | "stubbed" | "skipped";

export interface ScenarioStep {
  framework: "atomic" | "purplesharp" | "stratus" | "manual" | "reverse-shell" | "bind-shell" | "agent";
  refId?: string;
  techniqueId?: string;
  displayName: string;
  parameters?: Record<string, unknown>;
  expectedSignal?: string;
  notes?: string;
}

export interface StepRunResult {
  status: StepStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  notes: string;
}

export interface RunInput {
  useCaseId: string;
  scenarioId: string;
  environmentId: string;
  mode: "simulate-only" | "simulate-and-validate";
  testedLogicChoice?: "original" | "recommended" | "edited";
  actor?: string;
  confirmDestructive?: boolean;        // required for user-cloud / shell in validate mode
}

export interface RunOutput {
  runId: string;
  status: "success" | "failure" | "timeout";
  validationOutcome: CoverageOutcome;
  stepResults: Array<{
    stepIndex: number;
    framework: string;
    displayName: string;
    status: StepStatus;
    exitCode: number;
    durationMs: number;
    stdoutPreview: string;
    notes: string;
  }>;
  detectionResults: unknown[];
  durationMs: number;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function pickLogicBody(uc: EnterpriseUseCase, choice: string | undefined): { body: string; chosen: string } {
  const c = choice || uc.selectedLogic;
  if (c === "edited" && uc.editedDetectionLogic) return { body: uc.editedDetectionLogic, chosen: "edited" };
  if (c === "recommended" && uc.recommendedDetectionLogic) return { body: uc.recommendedDetectionLogic, chosen: "recommended" };
  return { body: uc.originalDetectionLogic, chosen: "original" };
}

function getRunTimeoutMs(): number {
  const raw = parseInt(process.env.ENTERPRISE_UC_RUN_TIMEOUT_MS || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60_000;
}

// ─── SSH helper ─────────────────────────────────────────────────────────────
async function sshExec(env: EnvironmentTarget, command: string, timeoutMs: number): Promise<{
  exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean;
}> {
  if (!env.hostname || !env.sshUser) {
    return {
      exitCode: -1, stdout: "", stderr: "env missing hostname or sshUser",
      durationMs: 0, timedOut: false,
    };
  }
  const args: string[] = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=10",
    "-o", "BatchMode=yes",
  ];
  if (env.sshKeyRef) args.push("-i", env.sshKeyRef);
  if (env.port && env.port > 0) args.push("-p", String(env.port));
  args.push(`${env.sshUser}@${env.hostname}`, command);

  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const killer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ exitCode: code ?? -1, stdout: stdout.slice(-16_000), stderr: stderr.slice(-8_000), durationMs: Date.now() - t0, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(killer);
      resolve({ exitCode: -1, stdout: "", stderr: `ssh spawn error: ${err.message}`, durationMs: Date.now() - t0, timedOut });
    });
  });
}

// Per-step input-argument values are substituted into a command string that
// the remote login shell re-parses, so a value containing shell control
// characters (`; | & $() \` newlines …) would break out of the intended
// command and execute arbitrary code on the target. ART input arguments are
// simple tokens (paths, names, flags); reject anything carrying injection
// metacharacters rather than try to quote-escape an arbitrary template.
const SHELL_INJECTION = /[;&|`$(){}<>\n\r\\"']/;

// ─── Step builders ──────────────────────────────────────────────────────────
async function buildAtomicCommand(step: ScenarioStep): Promise<string | null> {
  // Resolve the AtomicTest by refId (testGuid)
  if (!step.refId) return null;
  const test = await prisma.atomicTest.findFirst({
    where: { testGuid: step.refId },
    select: { command: true, executorName: true },
  });
  if (!test || !test.command) return null;
  let cmd = test.command;
  const ia = (step.parameters as any)?.inputArguments as Record<string, string> | undefined;
  if (ia) {
    for (const [k, v] of Object.entries(ia)) {
      const value = String(v);
      // Refuse to build a command when an override value could inject shell
      // commands — fail safe (the step is reported as unsupported upstream).
      if (SHELL_INJECTION.test(value)) return null;
      cmd = cmd.replace(new RegExp(`#{${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}}`, "g"), value);
    }
  }
  if (test.executorName === "powershell") {
    return `pwsh -NoProfile -Command ${JSON.stringify(cmd)}`;
  }
  if (test.executorName === "command_prompt") {
    return `cmd /c ${JSON.stringify(cmd)}`;
  }
  return cmd;
}

function buildManualCommand(step: ScenarioStep): string | null {
  const p = (step.parameters as any) || {};
  if (typeof p.command === "string" && p.command.trim()) return p.command;
  return null;
}

// ─── Per-(env-kind, framework) dispatch ────────────────────────────────────
async function dispatchStep(env: EnvironmentTarget, step: ScenarioStep, perStepBudget: number): Promise<StepRunResult> {
  const fw = step.framework;

  // agent envs → Caldera (bring-your-own-C2) executes real ATT&CK abilities;
  // native-fleet agents run via their own signed job-poll pipeline → stub here.
  if (env.kind === "agent") {
    if (env.agentBackend === "caldera" && (fw === "atomic" || fw === "manual" || fw === "agent")) {
      return runCaldera(env, step, perStepBudget);
    }
    return runAgentStep(env, step);
  }
  if (env.kind === "shell") return runShellStep(env, step);

  // user-cloud
  if (env.kind === "user-cloud") {
    if (fw === "stratus") {
      const t0 = Date.now();
      // Create a StratusExecution row + run
      const sx = await prisma.stratusExecution.create({
        data: {
          useCaseId: null,
          stepId: null,
          attackId: step.refId || step.techniqueId || "",
          credentialId: env.credentialId || null,
          phase: "dry-run",     // safe default in Phase 3; future runs can pass detonate when confirmed
          actor: "enterprise-uc-runner",
        },
      });
      try {
        const r = await runStratus({
          executionId: sx.id,
          attackId: step.refId || step.techniqueId || "",
          phase: ((step.parameters as any)?.phase === "detonate" ? "detonate"
                : (step.parameters as any)?.phase === "warmup" ? "warmup"
                : (step.parameters as any)?.phase === "cleanup" ? "cleanup"
                : "dry-run") as any,
          credentialId: env.credentialId || undefined,
          timeoutMs: perStepBudget,
        });
        return {
          status: r.status === "success" ? "ok" : r.status === "failure" ? "failure" : "stubbed",
          exitCode: r.exitCode,
          stdout: (r.logs || "").slice(-16_000),
          stderr: "",
          durationMs: r.durationMs,
          notes: `stratus phase=${r.status}`,
        };
      } catch (err: any) {
        return {
          status: "failure", exitCode: -1, stdout: "", stderr: err?.message || String(err),
          durationMs: Date.now() - t0, notes: "stratus runner threw",
        };
      }
    }
    // Other frameworks on user-cloud → stub
    return runUnsupportedStep(env, step, "user-cloud envs only execute stratus steps in Phase 3");
  }

  // our-template-deployed
  if (env.kind === "our-template-deployed") {
    if (fw === "atomic") {
      const cmd = await buildAtomicCommand(step);
      if (!cmd) return runUnsupportedStep(env, step, `ART test guid ${step.refId} not in the AtomicTest catalogue, or an input-argument value contained disallowed shell characters`);
      const r = await sshExec(env, cmd, perStepBudget);
      return {
        status: r.timedOut ? "failure" : r.exitCode === 0 ? "ok" : "failure",
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        durationMs: r.durationMs,
        notes: r.timedOut ? "step timed out" : "",
      };
    }
    if (fw === "manual") {
      const cmd = buildManualCommand(step);
      if (!cmd) return runUnsupportedStep(env, step, "manual step has no parameters.command");
      const r = await sshExec(env, cmd, perStepBudget);
      return {
        status: r.timedOut ? "failure" : r.exitCode === 0 ? "ok" : "failure",
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr: r.stderr,
        durationMs: r.durationMs,
        notes: r.timedOut ? "step timed out" : "",
      };
    }
    if (fw === "purplesharp") {
      return runUnsupportedStep(env, step, "PurpleSharp execution needs a Windows target with the binary deployed; track via Integration → PurpleSharp Run");
    }
    if (fw === "stratus") {
      return runUnsupportedStep(env, step, "stratus steps belong on a user-cloud env; create one and rerun");
    }
    if (fw === "reverse-shell" || fw === "bind-shell") {
      return runShellStep(env, step);   // intentional — same contract regardless of env wrapper
    }
    if (fw === "agent") {
      return runAgentStep(env, step);
    }
  }

  return runUnsupportedStep(env, step, `unhandled (env.kind=${env.kind}, framework=${fw})`);
}

// ─── Orchestrator ──────────────────────────────────────────────────────────
export async function runScenario(input: RunInput): Promise<RunOutput> {
  const t0 = Date.now();
  const TIMEOUT = getRunTimeoutMs();

  const [uc, sc, env] = await Promise.all([
    prisma.enterpriseUseCase.findUnique({ where: { id: input.useCaseId } }),
    prisma.enterpriseUseCaseScenario.findUnique({ where: { id: input.scenarioId } }),
    prisma.environmentTarget.findUnique({ where: { id: input.environmentId } }),
  ]);
  if (!uc) throw Object.assign(new Error("use case not found"), { code: "not_found" });
  if (!sc || sc.useCaseId !== uc.id) throw Object.assign(new Error("scenario not found / mismatched use case"), { code: "not_found" });
  if (!env) throw Object.assign(new Error("environment not found"), { code: "not_found" });
  if (!env.enabled) throw Object.assign(new Error("environment is disabled"), { code: "bad_state" });

  // Safety gate: destructive validation modes need explicit confirm
  const destructiveKind = env.kind === "user-cloud" || env.kind === "shell";
  if (destructiveKind && input.mode === "simulate-and-validate" && !input.confirmDestructive) {
    throw Object.assign(new Error(
      `Running '${env.kind}' env in simulate-and-validate mode is destructive. ` +
      `Pass confirmDestructive=true to acknowledge.`,
    ), { code: "needs_confirm" });
  }

  const steps = safeJson<ScenarioStep[]>(sc.steps, []);
  const logicChoice = pickLogicBody(uc, input.testedLogicChoice);

  const startedAt = new Date();
  const run = await prisma.enterpriseUseCaseRun.create({
    data: {
      useCaseId: uc.id,
      scenarioId: sc.id,
      environmentId: env.id,
      testedLogicChoice: logicChoice.chosen,
      mode: input.mode,
      status: "running",
      startedAt,
      actor: input.actor || "anonymous",
    },
  });

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.run.start",
    actor: input.actor || "anonymous",
    status: "info",
    targetType: "EnterpriseUseCaseRun",
    targetId: run.id,
    message: `${steps.length} step(s) · env=${env.name} (${env.kind}) · mode=${input.mode}`,
    details: { useCaseId: uc.id, scenarioId: sc.id, environmentId: env.id, mode: input.mode, stepCount: steps.length },
  });

  // Run steps sequentially. Each step's wall-clock budget is the run's remaining budget,
  // capped at 60s by default for safety (steps that need more should run individually).
  const stepResults: Array<{
    stepIndex: number;
    framework: string;
    displayName: string;
    status: StepStatus;
    exitCode: number;
    durationMs: number;
    stdoutPreview: string;
    notes: string;
  }> = [];
  let aborted = false;
  let mergedLogs = "";
  for (let i = 0; i < steps.length; i++) {
    const elapsed = Date.now() - t0;
    if (elapsed > TIMEOUT) { aborted = true; break; }
    const step = steps[i];
    const perStepBudget = Math.min(60_000, Math.max(5_000, TIMEOUT - elapsed));
    const r = await dispatchStep(env, step, perStepBudget);
    stepResults.push({
      stepIndex: i,
      framework: step.framework,
      displayName: step.displayName,
      status: r.status,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      stdoutPreview: r.stdout.slice(0, 500),
      notes: r.notes,
    });
    mergedLogs += `\n── step ${i + 1} [${step.framework}] ${step.displayName} ──\n`;
    mergedLogs += `exit=${r.exitCode}  status=${r.status}  ${r.durationMs}ms\n`;
    if (r.stdout) mergedLogs += `STDOUT:\n${r.stdout}\n`;
    if (r.stderr) mergedLogs += `STDERR:\n${r.stderr}\n`;
    if (r.notes) mergedLogs += `NOTE: ${r.notes}\n`;
  }

  // Coverage check
  let detectionResults: unknown[] = [];
  let validationOutcome: CoverageOutcome = "n/a";
  if (input.mode === "simulate-and-validate" && !aborted) {
    const endNow = new Date();
    try {
      const cov = await validateCoverage({
        detectionLogic: logicChoice.body,
        format: uc.format,
        ruleTitle: uc.name,
        windowStart: startedAt,
        windowEnd: endNow,
      });
      detectionResults = cov.results;
      validationOutcome = cov.outcome;
    } catch (err: any) {
      detectionResults = [{
        ruleTitle: uc.name,
        siemBackend: "?",
        integrationName: "?",
        query: "",
        fired: false,
        evidence: "",
        queriedAt: new Date().toISOString(),
        error: err?.message || String(err),
      }];
      validationOutcome = "error";
    }
  }
  // Stub runs never count toward "matched"
  const hasOnlyStubbedSteps = stepResults.length > 0 && stepResults.every((s) => s.status === "stubbed");
  if (hasOnlyStubbedSteps) validationOutcome = "n/a";

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - t0;
  const finalStatus: "success" | "failure" | "timeout" = aborted
    ? "timeout"
    : stepResults.some((s) => s.status === "failure") ? "failure" : "success";

  await prisma.enterpriseUseCaseRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      completedAt,
      durationMs,
      exitCode: finalStatus === "success" ? 0 : finalStatus === "timeout" ? 124 : 1,
      stepResults: JSON.stringify(stepResults),
      logs: mergedLogs.slice(-32_000),
      detectionResults: JSON.stringify(detectionResults),
      validationOutcome,
    },
  });

  // Lifecycle bump: matched simulate-and-validate run with non-stub steps
  // walks the use case to "validated" (sticky going forward).
  if (
    validationOutcome === "matched" &&
    input.mode === "simulate-and-validate" &&
    !hasOnlyStubbedSteps &&
    ["imported", "mapped", "scenarios-defined"].includes(uc.status)
  ) {
    await prisma.enterpriseUseCase.update({
      where: { id: uc.id },
      data: { status: "validated" },
    });
  }

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.run.complete",
    actor: input.actor || "anonymous",
    status: finalStatus === "success" ? "ok" : "error",
    targetType: "EnterpriseUseCaseRun",
    targetId: run.id,
    durationMs,
    message: `status=${finalStatus} · coverage=${validationOutcome} · steps=${stepResults.length}`,
    details: { runId: run.id, status: finalStatus, validationOutcome, stepCount: stepResults.length, durationMs },
  });

  return {
    runId: run.id,
    status: finalStatus,
    validationOutcome,
    stepResults,
    detectionResults,
    durationMs,
  };
}

// Used by the env-test endpoint and runner internally
export async function probeEnvironment(env: EnvironmentTarget): Promise<{
  ok: boolean; latencyMs: number; message: string;
}> {
  const t0 = Date.now();
  if (env.kind === "our-template-deployed") {
    if (!env.hostname) return { ok: false, latencyMs: 0, message: "hostname required for our-template-deployed env" };
    const r = await sshExec(env, "echo detectops-reachability-probe", 8000);
    return {
      ok: r.exitCode === 0 && r.stdout.includes("detectops-reachability-probe"),
      latencyMs: r.durationMs,
      message: r.exitCode === 0 ? "ssh probe ok" : `ssh exit=${r.exitCode}: ${r.stderr.slice(0, 200)}`,
    };
  }
  if (env.kind === "user-cloud") {
    if (!env.credentialId) return { ok: false, latencyMs: 0, message: "credentialId required for user-cloud env" };
    const cred = await prisma.cloudCredential.findUnique({ where: { id: env.credentialId } });
    if (!cred) return { ok: false, latencyMs: Date.now() - t0, message: "credentialId points at a missing CloudCredential" };
    // We don't ping the cloud API here — the Stratus runner does that at run-time.
    return { ok: true, latencyMs: Date.now() - t0, message: `credential "${cred.label}" (${cred.provider}) found` };
  }
  if (env.kind === "agent") {
    return { ok: !!env.agentEnrollmentToken, latencyMs: Date.now() - t0, message: env.agentEnrollmentToken ? "[STUB] enrollment token present; agent runner not implemented" : "agent enrollment token missing" };
  }
  if (env.kind === "shell") {
    const hasListener = !!(env.listenerHost && env.listenerPort);
    return { ok: hasListener, latencyMs: Date.now() - t0, message: hasListener ? "[STUB] listener configured; shell runner not implemented" : "listener host/port missing" };
  }
  return { ok: false, latencyMs: Date.now() - t0, message: `unknown env kind: ${env.kind}` };
}

