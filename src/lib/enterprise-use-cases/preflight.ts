/**
 * Pre-flight readiness checks for an Enterprise Use Case run.
 *
 * Given a (use case, scenario, environment, mode) tuple, run a deterministic
 * checklist BEFORE the runner fires steps. The user sees the result in the
 * RunDialog; we also persist the checklist into EnterpriseUseCaseRun.preflight
 * so historical runs carry the readiness snapshot they were dispatched with.
 *
 * Each check returns:
 *   { id, label, status: "ok"|"warn"|"fail"|"skip", message, fixHint? }
 *
 * Aggregate verdict:
 *   green   — all ok / skip                  → safe to run
 *   yellow  — at least one warn (recoverable)→ user can proceed with caution
 *   red     — at least one fail              → block destructive-mode runs
 */

import { prisma } from "@/lib/prisma";
import { probeEnvironment } from "./runner";
import { payloadMeta } from "./payload-store";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type AggregateVerdict = "green" | "yellow" | "red" | "pending";

export interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fixHint?: string;
}

export interface PreflightResult {
  verdict: AggregateVerdict;
  checks: PreflightCheck[];
  runnable: boolean;          // false when verdict=red (block) or scenario has no steps
  destructive: boolean;       // true when env is user-cloud or shell AND mode is validate
  generatedAt: string;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function aggregate(checks: PreflightCheck[]): AggregateVerdict {
  if (checks.some((c) => c.status === "fail")) return "red";
  if (checks.some((c) => c.status === "warn")) return "yellow";
  return "green";
}

export interface PreflightInput {
  useCaseId: string;
  scenarioId: string;
  environmentId: string;
  mode: "simulate-only" | "simulate-and-validate";
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  const [uc, scenario, env] = await Promise.all([
    prisma.enterpriseUseCase.findUnique({ where: { id: input.useCaseId } }),
    prisma.enterpriseUseCaseScenario.findUnique({ where: { id: input.scenarioId } }),
    prisma.environmentTarget.findUnique({ where: { id: input.environmentId } }),
  ]);

  // 1 — Use case exists + has a body
  if (!uc) {
    checks.push({ id: "use-case", label: "Use case", status: "fail", message: "use case not found" });
    return { verdict: "red", checks, runnable: false, destructive: false, generatedAt: new Date().toISOString() };
  }
  const techniques = safeJson<string[]>(uc.mitreTechniques, []);

  // 2 — Scenario exists + has steps + belongs to use case
  if (!scenario || scenario.useCaseId !== input.useCaseId) {
    checks.push({ id: "scenario", label: "Scenario", status: "fail", message: "scenario not found or mismatched use case", fixHint: "Pick a scenario from this use case's Scenarios tab" });
  } else {
    const steps = safeJson<unknown[]>(scenario.steps, []);
    if (steps.length === 0) {
      checks.push({ id: "scenario.steps", label: "Scenario steps", status: "fail", message: "scenario has no steps", fixHint: "Edit the scenario and add at least one step" });
    } else {
      checks.push({ id: "scenario.steps", label: "Scenario steps", status: "ok", message: `${steps.length} step(s) ready` });
    }
  }

  // 3 — Environment exists + enabled
  if (!env) {
    checks.push({ id: "env", label: "Environment", status: "fail", message: "environment not found" });
    return { verdict: "red", checks, runnable: false, destructive: false, generatedAt: new Date().toISOString() };
  }
  if (!env.enabled) {
    checks.push({ id: "env.enabled", label: "Environment enabled", status: "fail", message: `environment "${env.name}" is disabled`, fixHint: "Enable the environment in Environments page" });
  } else {
    checks.push({ id: "env.enabled", label: "Environment enabled", status: "ok", message: `${env.name} enabled` });
  }

  // 4 — Environment reachable / configured
  const probe = await probeEnvironment(env);
  checks.push({
    id: "env.reachable",
    label: "Environment reachable",
    status: probe.ok ? "ok" : "warn",
    message: probe.message + (probe.latencyMs ? ` (${probe.latencyMs}ms)` : ""),
    fixHint: probe.ok ? undefined : "Click Test in Environments to debug; verify credentials / SSH key / listener",
  });

  // 5 — Per-kind specifics
  if (env.kind === "shell") {
    const payloadOk = !!env.payloadRef && (await payloadMeta(env.payloadRef).then((m) => !!m).catch(() => false));
    checks.push({
      id: "shell.payload",
      label: "Shell payload uploaded",
      status: payloadOk ? "ok" : "warn",
      message: payloadOk ? `payload present (${env.payloadRef.slice(0, 24)}…)` : "no payload stored",
      fixHint: payloadOk ? undefined : "Upload a payload from the Environment edit page",
    });
  }
  if (env.kind === "user-cloud") {
    if (!env.credentialId) {
      checks.push({ id: "cloud.cred", label: "Cloud credential", status: "fail", message: "credentialId is empty", fixHint: "Edit the environment and pick a cloud credential" });
    } else {
      const cred = await prisma.cloudCredential.findUnique({ where: { id: env.credentialId } });
      checks.push({
        id: "cloud.cred",
        label: "Cloud credential",
        status: cred ? "ok" : "fail",
        message: cred ? `credential "${cred.label}" (${cred.provider})` : "referenced credential is missing",
      });
    }
  }
  if (env.kind === "agent") {
    checks.push({
      id: "agent.contract",
      label: "Agent runner",
      status: "warn",
      message: "[STUB] agent runner not yet implemented; steps will be recorded as stubbed",
      fixHint: "Wait for the real agent runner or run against a non-stub environment kind",
    });
  }

  // 6 — Detection logic body present (for simulate-and-validate mode only)
  if (input.mode === "simulate-and-validate") {
    const hasAnyBody = !!(uc.originalDetectionLogic || uc.recommendedDetectionLogic || uc.editedDetectionLogic);
    checks.push({
      id: "logic.body",
      label: "Detection logic body",
      status: hasAnyBody ? "ok" : "fail",
      message: hasAnyBody ? `selected: ${uc.selectedLogic}` : "no detection logic to test against",
      fixHint: hasAnyBody ? undefined : "Upload a rule or Generate Recommended in the Detection Logic tab",
    });

    // 7 — SIEM integration available for coverage check
    const siem = await prisma.integration.findFirst({ where: { type: "siem", enabled: true } });
    checks.push({
      id: "siem.integration",
      label: "SIEM integration",
      status: siem ? "ok" : "warn",
      message: siem ? `${siem.name} enabled` : "no enabled SIEM integration — coverage outcome will be 'n/a'",
      fixHint: siem ? undefined : "Configure a SIEM integration at /integrations",
    });
  } else {
    checks.push({
      id: "logic.body",
      label: "Detection logic body",
      status: "skip",
      message: "simulate-only mode — no coverage query will run",
    });
  }

  // 8 — MITRE techniques mapped (warn — affects ART precision)
  checks.push({
    id: "mitre.techniques",
    label: "MITRE techniques mapped",
    status: techniques.length > 0 ? "ok" : "warn",
    message: techniques.length > 0 ? `${techniques.length} technique(s): ${techniques.slice(0, 3).join(", ")}${techniques.length > 3 ? "…" : ""}` : "no techniques mapped — auto-suggestion + coverage scoring degrade",
    fixHint: techniques.length > 0 ? undefined : "Add techniques in the Mapping tab or edit metadata",
  });

  const destructive = (env.kind === "user-cloud" || env.kind === "shell") && input.mode === "simulate-and-validate";

  return {
    verdict: aggregate(checks),
    checks,
    runnable: !checks.some((c) => c.status === "fail"),
    destructive,
    generatedAt: new Date().toISOString(),
  };
}
