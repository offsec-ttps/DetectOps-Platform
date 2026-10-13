/**
 * The APT Simulation runner: execute a group's Atomic Red Team tests on the live
 * SAR lab and score each with a PREVENTION verdict and (in simulate-and-validate)
 * a DETECTION verdict from Splunk — the faithful per-atomic parallel to the LOTL
 * runner (lib/lotl/run.runLotlOnLab). Each test is a real ART test resolved from
 * the local atomic_tests library; we substitute its #{input} defaults and run the
 * command over the SAME transports (Windows→WinRM, Linux→SSH) via the shared
 * runCommandOnLab, so prevention/detection are derived identically to LOTL.
 *
 * ART tests that require the Invoke-AtomicRedTeam framework or staged payloads on
 * the endpoint (e.g. $PathToAtomicsFolder\...) are not special-cased: they run as
 * given and fail benignly, reported faithfully rather than skipped-and-hidden.
 */

import { runCommandOnLab } from "@/lib/lotl/execute";
import type { ResolvedLab } from "@/lib/lotl/targets";
import { runSplunkDetection } from "@/lib/siem/providers/splunk";

export type Prevention = "allowed" | "blocked" | "failed" | "skipped" | "error";
export type Detection = "detected" | "not-detected" | "n/a";
export type AptMode = "simulate-only" | "simulate-and-validate";

export interface AptRunTest {
  id: string;                 // atomic_tests.id
  techniqueId: string;
  techniqueName: string;
  testName: string;
  testGuid: string;
  platforms: string[];        // ["windows"], ["linux"], ...
  executor: string;           // command_prompt | powershell | sh | bash | manual
  command: string;
  cleanupCommand: string;
  inputArguments: Record<string, { default?: unknown }>;
  elevationRequired: boolean;
  tactic: string;
}

// Only these count as a security CONTROL blocking the technique (mirrors the LOTL
// runner), so a benign non-zero exit is not mislabelled "blocked".
const BLOCK_SIGNATURES = [
  /access is denied/i, /is blocked/i, /blocked by/i, /contains a virus/i,
  /blocked by group policy/i, /\bnot allowed\b/i, /denied by/i, /quarantin/i,
  /\bDefender\b.*\b(block|prevent)/i, /execution of scripts is disabled/i,
];

function derivePrevention(status: string, stdout: string, stderr: string): Prevention {
  if (status === "skipped") return "skipped";
  if (status === "error") return "error";
  if (status === "ok") return "allowed";
  return BLOCK_SIGNATURES.some((re) => re.test(`${stdout}\n${stderr}`)) ? "blocked" : "failed";
}

/** Normalise an ART executor to what runCommandOnLab's transport expects. */
function normExecutor(e: string): "cmd" | "powershell" | "bash" | "manual" {
  const x = (e || "").toLowerCase();
  if (x === "command_prompt" || x === "cmd") return "cmd";
  if (x === "powershell" || x === "pwsh") return "powershell";
  if (x === "sh" || x === "bash") return "bash";
  return "manual";
}

/** Substitute Atomic Red Team #{arg} tokens with their declared defaults. */
function substituteArgs(command: string, inputArguments: Record<string, { default?: unknown }>): string {
  let out = command;
  for (const [name, spec] of Object.entries(inputArguments || {})) {
    const def = spec && spec.default != null ? String(spec.default) : "";
    out = out.split(`#{${name}}`).join(def);
  }
  return out;
}

/** Pick the platform to run on, given what the lab actually has. */
function pickPlatform(platforms: string[], lab: ResolvedLab): "windows" | "linux" | null {
  const p = platforms.map((x) => x.toLowerCase());
  if (p.includes("windows") && lab.targets.windows) return "windows";
  if ((p.includes("linux") || p.includes("")) && lab.targets.linux) return "linux";
  // ART "office-365"/"azure-ad"/"iaas" etc. have no SAR endpoint.
  return null;
}

/** Detection search term: first binary-ish token of the command (echo-excluded
 *  Splunk query is applied by the caller). Mirrors the LOTL approach. */
function searchTermFor(test: AptRunTest, command: string): string {
  // strip a leading shell wrapper so we get at the real binary
  let c = command.replace(/^\s*(cmd(\.exe)?\s+\/c\s+|powershell(\.exe)?(\s+-\w+\s+\S+)*\s+)/i, "").trim();
  const tok = (c.split(/\s+/)[0] || "").replace(/^["']|["']$/g, "");
  const base = (tok.split(/[\\/]/).pop() || tok).replace(/\.exe$/i, "").replace(/[^A-Za-z0-9_.-]/g, "");
  return base.slice(0, 40) || (test.techniqueName.split(" ")[0] || "");
}

export interface AptStepResult {
  id: string; techniqueId: string; techniqueName: string; testName: string;
  prevention: Prevention; detection: Detection; detectionDetail: string;
  transport: string; platform: string; exitCode: number | null; durationMs: number;
  stdout: string; stderr: string; notes: string;
}
export interface AptRunOutput {
  results: AptStepResult[];
  summary: {
    total: number; ran: number;
    prevention: { allowed: number; blocked: number; failed: number; skipped: number; error: number };
    detection: { detected: number; gaps: number } | null;
  };
  overall: "success" | "error";
}

export async function runAptOnLab(tests: AptRunTest[], lab: ResolvedLab, mode: AptMode, opts: { stepTimeoutMs?: number } = {}): Promise<AptRunOutput> {
  const stepTimeoutMs = Math.max(5_000, Math.min(opts.stepTimeoutMs ?? 60_000, 300_000));
  const results: AptStepResult[] = [];
  let allowed = 0, blocked = 0, failed = 0, skipped = 0, errored = 0, detected = 0, gaps = 0;
  const startedAt = Date.now();

  for (const t of tests) {
    const executor = normExecutor(t.executor);
    const platform = pickPlatform(t.platforms, lab);
    let prevention: Prevention;
    let transport = "none", platformStr = platform || (t.platforms[0] || "unknown");
    let exitCode: number | null = null, durationMs = 0, stdout = "", stderr = "", notes = "";

    if (executor === "manual") {
      prevention = "skipped"; notes = "manual test — no automated execution";
    } else if (!platform) {
      prevention = "skipped"; notes = `no SAR endpoint for platform(s): ${t.platforms.join(", ") || "unknown"}`;
    } else {
      const command = substituteArgs(t.command, t.inputArguments);
      const outcome = await runCommandOnLab(lab.targets, { command, executor, platform }, stepTimeoutMs);
      prevention = derivePrevention(outcome.status, outcome.stdout, outcome.stderr);
      transport = outcome.transport; exitCode = outcome.exitCode; durationMs = outcome.durationMs;
      stdout = (outcome.stdout || "").slice(-2000); stderr = (outcome.stderr || "").slice(-1000); notes = outcome.notes;
    }

    if (prevention === "allowed") allowed++;
    else if (prevention === "blocked") blocked++;
    else if (prevention === "failed") failed++;
    else if (prevention === "skipped") skipped++;
    else errored++;

    let detection: Detection = "n/a"; let detectionDetail = "";
    const term = searchTermFor(t, substituteArgs(t.command, t.inputArguments));
    if (mode === "simulate-and-validate" && lab.splunk && prevention === "allowed" && term.length < 3) {
      detection = "n/a"; detectionDetail = `search term "${term}" too generic to score reliably`;
    } else if (mode === "simulate-and-validate" && lab.splunk && prevention === "allowed") {
      const windowMinutes = Math.max(2, Math.ceil((Date.now() - startedAt) / 60000) + 2);
      // Exclude PowerShell script-block/engine echo (we run over PS-remoting) so we
      // score INDEPENDENT host telemetry, not our own command text (see LOTL run.ts).
      const excludeEcho = `NOT (EventCode IN (4103,4104,4105,4106,4100,400,403) OR source="*PowerShell*Operational*" OR sourcetype IN ("*WinRM*","*powershell*"))`;
      try {
        const det = await runSplunkDetection(lab.splunk, {
          query: `(index=win OR index=sysmon OR index=wineventlog OR index=main OR index=os OR index=attack) ${term} ${excludeEcho}`,
          detectionName: t.testName.slice(0, 60), techniqueId: t.techniqueId || undefined, windowMinutes,
        });
        detection = det.detected ? "detected" : "not-detected";
        detectionDetail = (det.strategies || []).map((s) => s.details).filter(Boolean).slice(0, 2).join(" · ");
        if (detection === "detected") detected++; else gaps++;
      } catch (e) {
        detection = "n/a"; detectionDetail = `detection query failed: ${String((e as Error)?.message || e).slice(0, 120)}`;
      }
    }

    results.push({
      id: t.id, techniqueId: t.techniqueId, techniqueName: t.techniqueName, testName: t.testName,
      prevention, detection, detectionDetail, transport, platform: platformStr,
      exitCode, durationMs, stdout, stderr, notes,
    });
  }

  const ran = allowed + blocked + failed;
  return {
    results,
    summary: {
      total: tests.length, ran,
      prevention: { allowed, blocked, failed, skipped, error: errored },
      detection: mode === "simulate-and-validate" ? { detected, gaps } : null,
    },
    overall: errored > tests.length / 2 ? "error" : "success",
  };
}
