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
  framework: "atomic" | "purplesharp" | "stratus" | "manual" | "reverse-shell" | "bind-shell" | "agent" | "lotl";
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

// ─── WinRM transport (SAR Windows endpoints speak WinRM, not SSH) ────────────
// Credentials come from a gitignored, operator-managed config file keyed by host
// (shape: { "10.0.1.14": { user, password, transport?, scheme?, port? } }) so no
// secret is written to the DB/schema or to git. This is the lab-grade source;
// for a multi-tenant/production deployment, source WinRM credentials from the
// encrypted credential vault (see src/lib/crypto/credential-vault.ts, as
// SiemConnection/CloudCredential do) and reference them via the environment.
// The default scheme is http+basic (WinRM 5985), which SAR provisions and which
// is only safe on an isolated lab network — it transmits the password in
// cleartext. Set scheme:"https" (port 5986) for any routed network.
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface WinrmCred { user: string; password: string; transport: string; scheme: string; port: number }
function winrmCreds(host: string): WinrmCred | null {
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), "labs", "winrm.config.json"), "utf8"));
    const c = cfg[host];
    if (c && c.user) {
      const scheme = c.scheme === "https" ? "https" : "http";
      return { user: c.user, password: c.password || "", transport: c.transport || "basic", scheme, port: Number(c.port) || (scheme === "https" ? 5986 : 5985) };
    }
  } catch { /* no config for this host */ }
  return null;
}

async function winrmExec(env: EnvironmentTarget, command: string, timeoutMs: number): Promise<{
  exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean;
}> {
  const t0 = Date.now();
  if (!env.hostname) return { exitCode: -1, stdout: "", stderr: "env missing hostname", durationMs: 0, timedOut: false };
  // Authorization boundary (anti confused-deputy): the runner only ever uses WinRM
  // credentials for a host an operator has explicitly allowlisted in the config.
  // An environment pointing at any other host yields no credentials and cannot be
  // executed against, so a caller cannot steer the privileged WinRM session at an
  // arbitrary target. Run invocation itself is gated upstream (authenticated API +
  // environment ownership); per-tenant RBAC on environments is a recommended
  // follow-on for shared deployments.
  const creds = winrmCreds(env.hostname);
  if (!creds) return { exitCode: -1, stdout: "", stderr: `no WinRM credentials configured for host ${env.hostname} — add it to the operator allowlist (labs/winrm.config.json)`, durationMs: Date.now() - t0, timedOut: false };
  const payload = JSON.stringify({
    host: env.hostname, user: creds.user, password: creds.password, transport: creds.transport,
    scheme: creds.scheme, port: creds.port,
    shell: "powershell", command, timeout: Math.round(timeoutMs / 1000),
  });
  return new Promise((resolve) => {
    const py = process.env.WINRM_PYTHON || "python3";
    const child = spawn(py, [join(process.cwd(), "scripts", "winrm_exec.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    const killer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch {} }, timeoutMs + 20_000);
    child.on("close", () => {
      clearTimeout(killer);
      try {
        const r = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "{}");
        resolve({ exitCode: r.exitCode ?? -1, stdout: String(r.stdout || "").slice(-16_000), stderr: String(r.stderr || err).slice(-8_000), durationMs: Date.now() - t0, timedOut });
      } catch {
        resolve({ exitCode: -1, stdout: out.slice(-16_000), stderr: (err || "winrm helper: unparseable output").slice(-8_000), durationMs: Date.now() - t0, timedOut });
      }
    });
    child.on("error", (e) => { clearTimeout(killer); resolve({ exitCode: -1, stdout: "", stderr: `winrm helper spawn error: ${e.message}`, durationMs: Date.now() - t0, timedOut }); });
    child.stdin.write(payload); child.stdin.end();
  });
}

// Build the PowerShell that runs ONE atomic on a SAR Windows endpoint via
// Invoke-AtomicTest (GetPrereqs → run → cleanup), resolving (technique, test#)
// from the step's testGuid. Mirrors the fleet bundle wrapper.
async function buildWinrmAtomicPs(step: ScenarioStep, budgetSec: number): Promise<string | null> {
  if (!step.refId) return null;
  const test = await prisma.atomicTest.findFirst({ where: { testGuid: step.refId }, select: { techniqueId: true, testNumber: true } });
  if (!test) return null;
  const t = test.techniqueId, n = test.testNumber;
  // Harden against command injection / confused-deputy: these values are
  // interpolated into the PowerShell that the privileged WinRM session runs, so
  // only accept a canonical ATT&CK id and a non-negative integer test number.
  // A tampered or malformed AtomicTest row can therefore never inject commands;
  // Invoke-AtomicTest also runs only the test matching this (technique, number).
  if (!/^T\d{4}(\.\d{3})?$/.test(t) || !Number.isInteger(n) || n < 0 || n > 999) return null;
  // SAR installs ART under C:\AtomicRedTeam; fall back to the ProgramData base.
  return [
    `$base = @('C:\\AtomicRedTeam','C:\\ProgramData\\AtomicRedTeam') | Where-Object { Test-Path "$_\\atomics" } | Select-Object -First 1;`,
    `if (-not $base) { Write-Output 'ART-NOT-INSTALLED'; exit 1 };`,
    `Import-Module "$base\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force -ErrorAction SilentlyContinue;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -GetPrereqs -Confirm:$false -ErrorAction SilentlyContinue | Out-Null;`,
    `$o = Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -TimeoutSeconds ${Math.max(30, Math.min(300, budgetSec))} -Confirm:$false -ErrorAction Continue 2>&1 | Out-String;`,
    `Write-Output $o;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -Cleanup -Confirm:$false -ErrorAction SilentlyContinue | Out-Null;`,
  ].join("");
}

// ─── Single-atomic detonation seam (coverage-assessment sweep) ──────────────
// Detonate one ART (techniqueId, testNumber) on an environment and report
// whether it executed — without constructing a scenario/use-case per atomic.
// Used by the coverage-assessment worker to sweep the whole library. WinRM
// endpoints (shellMode="winrm") run Invoke-AtomicTest over WinRM; other
// transports are out of scope for the bulk sweep (SAR Windows DC is WinRM).
export interface DetonateResult {
  status: "executed" | "failed" | "n/a";
  executed: boolean;
  exitCode: number;
  stdout: string;
  tail: string;
  durationMs: number;
}
export async function detonateAtomicTest(
  env: EnvironmentTarget, techniqueId: string, testNumber: number, budgetSec = 60,
): Promise<DetonateResult> {
  const t = techniqueId, n = testNumber;
  // Same hardening as buildWinrmAtomicPs: only a canonical ATT&CK id + a bounded
  // integer test number are interpolated into the privileged WinRM PowerShell.
  if (!/^T\d{4}(\.\d{3})?$/.test(t) || !Number.isInteger(n) || n < 0 || n > 999) {
    return { status: "failed", executed: false, exitCode: -1, stdout: "", tail: "invalid technique id / test number", durationMs: 0 };
  }
  if (env.kind !== "our-template-deployed" || env.shellMode !== "winrm") {
    return { status: "failed", executed: false, exitCode: -1, stdout: "", tail: "coverage sweep supports WinRM our-template-deployed environments only", durationMs: 0 };
  }
  const ps = [
    `$base = @('C:\\AtomicRedTeam','C:\\ProgramData\\AtomicRedTeam') | Where-Object { Test-Path "$_\\atomics" } | Select-Object -First 1;`,
    `if (-not $base) { Write-Output 'ART-NOT-INSTALLED'; exit 1 };`,
    `Import-Module "$base\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force -ErrorAction SilentlyContinue;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -GetPrereqs -Confirm:$false -ErrorAction SilentlyContinue | Out-Null;`,
    `$o = Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -TimeoutSeconds ${Math.max(30, Math.min(300, budgetSec))} -Confirm:$false -ErrorAction Continue 2>&1 | Out-String;`,
    `Write-Output $o;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -Cleanup -Confirm:$false -ErrorAction SilentlyContinue | Out-Null;`,
  ].join("");
  const r = await winrmExec(env, ps, budgetSec * 1000 + 20_000);
  const out = r.stdout || "";
  const tail = out.slice(-220).replace(/\s+/g, " ").trim();
  if (/Done executing test/i.test(out)) {
    return { status: "executed", executed: true, exitCode: r.exitCode, stdout: out, tail, durationMs: r.durationMs };
  }
  if (/ART-NOT-INSTALLED/.test(out)) {
    return { status: "n/a", executed: false, exitCode: r.exitCode, stdout: out, tail: "ART not installed on target", durationMs: r.durationMs };
  }
  if (/applicable to|does not exist|could not find|no atomic tests/i.test(out)) {
    return { status: "n/a", executed: false, exitCode: r.exitCode, stdout: out, tail: tail || "not applicable / missing on host", durationMs: r.durationMs };
  }
  return { status: "failed", executed: false, exitCode: r.exitCode, stdout: out, tail: tail || (r.stderr || "").slice(-150) || "no output", durationMs: r.durationMs };
}

// Result of staging one atomic's prerequisites on a WinRM host.
export interface PrereqResult {
  status: "satisfied" | "missing" | "n/a" | "failed";
  stdout: string;
  tail: string;
  durationMs: number;
}

// Stage (download) an atomic's external prerequisites on the endpoint WHILE IT
// HAS internet, so later runs work offline. Runs Invoke-AtomicTest -GetPrereqs
// (which executes the test's get_prereq_command — e.g. downloading ProcDump),
// then -CheckPrereqs to verify. It never executes the test itself and never
// cleans up, so nothing adversarial runs: this only fetches the payloads the
// atomic declares. Same input hardening + WinRM-only restriction as
// detonateAtomicTest. budgetSec is generous because prereqs download files.
export async function stagePrereqs(
  env: EnvironmentTarget, techniqueId: string, testNumber: number, budgetSec = 120,
): Promise<PrereqResult> {
  const t = techniqueId, n = testNumber;
  if (!/^T\d{4}(\.\d{3})?$/.test(t) || !Number.isInteger(n) || n < 0 || n > 999) {
    return { status: "failed", stdout: "", tail: "invalid technique id / test number", durationMs: 0 };
  }
  if (env.kind !== "our-template-deployed" || env.shellMode !== "winrm") {
    return { status: "failed", stdout: "", tail: "prereq staging supports WinRM our-template-deployed environments only", durationMs: 0 };
  }
  const budget = Math.max(30, Math.min(900, budgetSec));
  const ps = [
    `$base = @('C:\\AtomicRedTeam','C:\\ProgramData\\AtomicRedTeam') | Where-Object { Test-Path "$_\\atomics" } | Select-Object -First 1;`,
    `if (-not $base) { Write-Output 'ART-NOT-INSTALLED'; exit 1 };`,
    `Import-Module "$base\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force -ErrorAction SilentlyContinue;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -GetPrereqs -Confirm:$false -ErrorAction Continue 2>&1 | Out-String | Write-Output;`,
    `Write-Output '---CHECK---';`,
    `Invoke-AtomicTest ${t} -TestNumbers ${n} -PathToAtomicsFolder "$base\\atomics" -CheckPrereqs -Confirm:$false -ErrorAction Continue 2>&1 | Out-String | Write-Output;`,
  ].join("");
  const r = await winrmExec(env, ps, budget * 1000 + 20_000);
  const out = r.stdout || "";
  const tail = out.slice(-240).replace(/\s+/g, " ").trim();
  if (/ART-NOT-INSTALLED/.test(out)) return { status: "n/a", stdout: out, tail: "ART not installed on target", durationMs: r.durationMs };
  const check = out.split("---CHECK---").pop() || out;
  // Invoke-AtomicTest -CheckPrereqs prints "Prerequisites met" per satisfied test.
  if (/Prerequisites met/i.test(check) && !/Prerequisites not met/i.test(check)) {
    return { status: "satisfied", stdout: out, tail, durationMs: r.durationMs };
  }
  if (/Prerequisites not met/i.test(check)) {
    return { status: "missing", stdout: out, tail, durationMs: r.durationMs };
  }
  if (/applicable to|does not exist|could not find|no atomic tests/i.test(out)) {
    return { status: "n/a", stdout: out, tail: tail || "not applicable / missing on host", durationMs: r.durationMs };
  }
  return { status: "failed", stdout: out, tail: tail || (r.stderr || "").slice(-150) || "no output", durationMs: r.durationMs };
}

// List the ATT&CK technique folders actually installed under the ART atomics
// path on a WinRM host, so a "full" sweep can skip atomics the host does not
// have (they would otherwise each cost a round-trip only to report n/a).
// Returns an uppercased set of technique ids (e.g. "T1059.001"); empty set on
// any failure (caller then falls back to not intersecting).
export async function listInstalledAtomicTechniques(env: EnvironmentTarget): Promise<Set<string>> {
  const out = new Set<string>();
  if (env.kind !== "our-template-deployed" || env.shellMode !== "winrm") return out;
  const ps = [
    `$base = @('C:\\AtomicRedTeam','C:\\ProgramData\\AtomicRedTeam') | Where-Object { Test-Path "$_\\atomics" } | Select-Object -First 1;`,
    `if (-not $base) { Write-Output 'ART-NOT-INSTALLED'; exit 1 };`,
    `Get-ChildItem "$base\\atomics" -Directory | ForEach-Object { $_.Name };`,
  ].join("");
  const r = await winrmExec(env, ps, 60_000);
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    const m = line.trim().match(/^T\d{4}(\.\d{3})?$/);
    if (m) out.add(line.trim().toUpperCase());
  }
  return out;
}

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
  return wrapByExecutor(cmd, test.executorName);
}

/**
 * Wrap a command for the executor that must run it on the remote host. The
 * single place the pwsh/cmd quoting lives — atomic and LOTL steps both route
 * through here, so a quoting fix applies to both. Normalises the two spellings
 * of the Windows shell ("command_prompt" from ART YAML, "cmd" from LOTL rows);
 * bash/sh/manual commands run as-is.
 */
export function wrapByExecutor(cmd: string, executor: string | null | undefined): string {
  const ex = String(executor || "").toLowerCase().trim();
  if (ex === "powershell" || ex === "pwsh") return `pwsh -NoProfile -Command ${JSON.stringify(cmd)}`;
  if (ex === "command_prompt" || ex === "cmd") return `cmd /c ${JSON.stringify(cmd)}`;
  return cmd;
}

function buildManualCommand(step: ScenarioStep): string | null {
  const p = (step.parameters as any) || {};
  if (typeof p.command === "string" && p.command.trim()) return p.command;
  return null;
}

// Living-off-the-Land step: the entry's own command IS the test (a safe,
// self-contained probe generated by the LOTL ingestors), carried inline on the
// step rather than resolved from the AtomicTest catalogue. Wrap by declared
// executor; bash/manual commands run as-is (they contain shell constructs by
// design, so no input-arg injection filtering applies to the base command).
function buildLotlCommand(step: ScenarioStep): string | null {
  const p = (step.parameters as any) || {};
  const cmd = typeof p.command === "string" ? p.command : "";
  if (!cmd.trim()) return null;
  return wrapByExecutor(cmd, String(p.executor || "bash"));
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
    // WinRM transport for Windows SAR endpoints (shellMode="winrm"): detonate the
    // atomic via Invoke-AtomicTest over WinRM instead of SSH.
    const useWinrm = env.shellMode === "winrm";
    if (fw === "atomic") {
      if (useWinrm) {
        const ps = await buildWinrmAtomicPs(step, Math.round(perStepBudget / 1000));
        if (!ps) return runUnsupportedStep(env, step, `ART test guid ${step.refId} not in the AtomicTest catalogue`);
        const r = await winrmExec(env, ps, perStepBudget);
        const ran = /Done executing test/i.test(r.stdout) || (r.exitCode === 0 && !/ART-NOT-INSTALLED/.test(r.stdout));
        return {
          status: r.timedOut ? "failure" : ran ? "ok" : "failure",
          exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs,
          notes: r.timedOut ? "step timed out" : /ART-NOT-INSTALLED/.test(r.stdout) ? "Atomic Red Team not installed on target" : "",
        };
      }
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
    if (fw === "lotl") {
      const cmd = buildLotlCommand(step);
      if (!cmd) return runUnsupportedStep(env, step, "lotl step has no parameters.command");
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

