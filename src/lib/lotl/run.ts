/**
 * The ONE LOTL execution path (SSH labs): compile each technique, run it on the
 * matching host, derive a PREVENTION verdict, and — in simulate-and-validate —
 * a DETECTION verdict from Splunk. Shared by the Campaign Designer entry point
 * (/api/lotl/campaign-simulate) and the standalone /api/lotl/simulate so there is
 * a single source of truth for how a LOTL selection runs and is scored.
 *
 * Fleet targets do NOT come here — they use the hash-pinned agent bundle path
 * (lib/bas/lotl-dispatch). This module is the SSH/WinRM lab path only.
 */

import type { LotlTechnique } from "@/generated/prisma/client";
import { executeLotl, type LotlExecResult } from "./execute";
import type { ResolvedLab } from "./targets";
import { runSplunkDetection } from "@/lib/siem/providers/splunk";

export type Prevention = "allowed" | "blocked" | "failed" | "skipped" | "error";
export type Detection = "detected" | "not-detected" | "n/a";
export type LotlMode = "simulate-only" | "simulate-and-validate";

// Only these signatures count as a security CONTROL blocking the technique, so a
// benign non-zero exit is not mislabelled "blocked".
const BLOCK_SIGNATURES = [
  /access is denied/i, /is blocked/i, /blocked by/i, /contains a virus/i,
  /blocked by group policy/i, /\bnot allowed\b/i, /denied by/i, /quarantin/i,
  /\bDefender\b.*\b(block|prevent)/i, /execution of scripts is disabled/i,
];

function derivePrevention(r: LotlExecResult): Prevention {
  if (r.status === "skipped") return "skipped";
  if (r.status === "error") return "error";
  if (r.status === "ok") return "allowed";
  const hay = `${r.stdout}\n${r.stderr}`;
  return BLOCK_SIGNATURES.some((re) => re.test(hay)) ? "blocked" : "failed";
}

/**
 * Leading binary/tool name → Splunk search term for the detection pass.
 *
 * Library entries are named "<binary> - <desc>" (LOLBAS) or "<LIB>: <tool> -
 * <desc>" (GTFOBins, LOLRMM, Persistence-Info, LOLDrivers, …). We MUST strip the
 * library tag first: otherwise names like "LOLRMM: Action1 - …" collapse to the
 * constant token "LOLRMM", which then matches our own run's logged command text
 * on every technique and reports a 100% false-positive "detected". Stripping any
 * leading "WORD:" prefix yields the real per-technique token (the binary for
 * LOLBAS, the tool/technique name for the tagged libraries).
 */
function searchTermFor(name: string, command: string): string {
  const fromName = (name.split(" - ")[0] || "").replace(/^[A-Za-z][A-Za-z0-9_-]*:\s*/, "").trim();
  const tok = (fromName || command).trim().split(/\s+/)[0] || "";
  return tok.replace(/\.exe$/i, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
}

export interface LotlStepResult {
  id: string; library: string; name: string; techniqueId: string | null;
  transport: string; platform: string;
  prevention: Prevention; detection: Detection; detectionDetail: string;
  exitCode: number | null; durationMs: number;
  resolved: string[]; warnings: string[]; unresolved: string[];
  stdout: string; stderr: string; notes: string;
}

export interface LotlRunSummary {
  total: number; ran: number;
  prevention: { allowed: number; blocked: number; failed: number; skipped: number; error: number };
  detection: { detected: number; gaps: number } | null;
  gaps: number | null;
}

export interface LotlRunOutput {
  results: LotlStepResult[];
  summary: LotlRunSummary;
  overall: "success" | "error";
}

/**
 * Execute a set of LotlTechnique rows against a resolved lab. Pure w.r.t. inputs
 * except the remote side effects; callers persist + log the returned results.
 */
export async function runLotlOnLab(rows: LotlTechnique[], lab: ResolvedLab, mode: LotlMode, opts: { stepTimeoutMs?: number } = {}): Promise<LotlRunOutput> {
  // Per-step cap. 60s is right for a deliberate single run; a bulk sweep passes a
  // tighter value (a LOTL command still running after ~15s is almost always an
  // interactive shell waiting on stdin, which we want to kill, not wait out).
  const stepTimeoutMs = Math.max(5_000, Math.min(opts.stepTimeoutMs ?? 60_000, 300_000));
  const results: LotlStepResult[] = [];
  let allowed = 0, blocked = 0, failed = 0, skipped = 0, errored = 0, detected = 0, gaps = 0;
  const startedAt = Date.now();

  for (const r of rows) {
    const exec = await executeLotl(
      {
        command: r.command, executor: r.executor, cleanupCommand: r.cleanupCommand,
        platforms: JSON.parse(r.platforms || "[]"), name: r.name,
        techniqueId: r.techniqueId, library: r.library, sourceRef: r.sourceRef,
      },
      lab.targets,
      { timeoutMs: stepTimeoutMs },
    );
    const prevention = derivePrevention(exec);
    if (prevention === "allowed") allowed++;
    else if (prevention === "blocked") blocked++;
    else if (prevention === "failed") failed++;
    else if (prevention === "skipped") skipped++;
    else errored++;

    let detection: Detection = "n/a";
    let detectionDetail = "";
    const term = searchTermFor(r.name, r.command);
    if (mode === "simulate-and-validate" && lab.splunk && prevention === "allowed" && term.length < 3) {
      // A 1–2 char term (GTFOBins "R", "ab") matches unrelated events and would
      // produce false "detected" — report n/a rather than guess.
      detection = "n/a"; detectionDetail = `search term "${term}" too generic to score reliably`;
    } else if (mode === "simulate-and-validate" && lab.splunk && prevention === "allowed") {
      const windowMinutes = Math.max(2, Math.ceil((Date.now() - startedAt) / 60000) + 2);
      try {
        // We run the technique over PowerShell-remoting (WinRM) / SSH, so PowerShell
        // Script Block + engine logging (EventCode 4103/4104/4105/4106/4100/400/403)
        // records our command VERBATIM — a free-text term then matches our own
        // runner and reports a false "detected". Exclude those channels so we score
        // the technique's INDEPENDENT host footprint (Sysmon process creation EC1,
        // DNS EC22, file/registry, Security 4688), not an echo of what we typed.
        const excludeEcho = `NOT (EventCode IN (4103,4104,4105,4106,4100,400,403) OR source="*PowerShell*Operational*" OR sourcetype IN ("*WinRM*","*powershell*"))`;
        const det = await runSplunkDetection(lab.splunk, {
          query: `(index=win OR index=sysmon OR index=wineventlog OR index=main OR index=os OR index=attack) ${term} ${excludeEcho}`,
          detectionName: r.name.slice(0, 60),
          techniqueId: r.techniqueId || undefined,
          windowMinutes,
        });
        detection = det.detected ? "detected" : "not-detected";
        detectionDetail = (det.strategies || []).map((s) => s.details).filter(Boolean).slice(0, 2).join(" · ");
        if (detection === "detected") detected++; else gaps++;
      } catch (e) {
        detection = "n/a"; detectionDetail = `detection query failed: ${String((e as Error)?.message || e).slice(0, 120)}`;
      }
    }

    results.push({
      id: r.id, library: r.library, name: r.name, techniqueId: r.techniqueId,
      transport: exec.transport, platform: exec.platform,
      prevention, detection, detectionDetail,
      exitCode: exec.exitCode, durationMs: exec.durationMs,
      resolved: exec.resolved, warnings: exec.warnings, unresolved: exec.unresolved,
      stdout: (exec.stdout || "").slice(-2000), stderr: (exec.stderr || "").slice(-1000),
      notes: exec.notes,
    });
  }

  const ran = allowed + blocked + failed;
  return {
    results,
    summary: {
      total: rows.length, ran,
      prevention: { allowed, blocked, failed, skipped, error: errored },
      detection: mode === "simulate-and-validate" ? { detected, gaps } : null,
      gaps: mode === "simulate-and-validate" ? gaps : null,
    },
    overall: errored > rows.length / 2 ? "error" : "success",
  };
}
