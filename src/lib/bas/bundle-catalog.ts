/**
 * ART bundle catalog for the native BAS fleet.
 *
 * Security property (plan §Risks): the agent runs ONLY curated, version-pinned
 * bundles addressed by sha256 — never raw commands from a job message. A
 * FleetOperation carries `{technique, testIndex, bundleHash}`; the agent fetches
 * the matching bundle, re-hashes the served bytes, and refuses to run on a
 * mismatch. This keeps the agent from being a generic remote-exec backdoor.
 *
 * A "bundle" is the executable surface of one Atomic Red Team test: technique,
 * test index, executor, the (input-arg-interpolated) command, and its cleanup.
 * The canonical JSON string is what gets hashed and served verbatim, so the
 * agent's hash of the received bytes matches the control plane's hash exactly.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { AtomicTest, LotlTechnique } from "@/generated/prisma/client";

export interface BundleContent {
  technique: string;
  testIndex: number;
  testName: string;
  executor: string;                 // command_prompt | powershell | bash | sh
  command: string;                  // input-args already interpolated
  cleanup: string;
  platforms: string[];
  elevationRequired: boolean;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

/**
 * Deterministic canonical serialization — fixed key order so the same bundle
 * always produces the same bytes (and therefore the same hash). The agent
 * hashes the literal bytes it receives, so this must be byte-stable.
 */
export function canonicalBundle(b: BundleContent): string {
  // Construct with an explicit, fixed key order. JSON.stringify preserves
  // insertion order; arrays are emitted in their given order.
  return JSON.stringify({
    technique: b.technique,
    testIndex: b.testIndex,
    testName: b.testName,
    executor: b.executor,
    command: b.command,
    cleanup: b.cleanup,
    platforms: b.platforms,
    elevationRequired: b.elevationRequired,
  });
}

export function bundleHash(b: BundleContent): string {
  return createHash("sha256").update(canonicalBundle(b), "utf8").digest("hex");
}

/** Interpolate `#{arg}` placeholders with the AtomicTest's declared defaults. */
function interpolate(command: string, inputArguments: Record<string, any>): string {
  let out = command || "";
  for (const [k, v] of Object.entries(inputArguments || {})) {
    const def = (v && typeof v === "object") ? (v.default ?? "") : String(v ?? "");
    out = out.replace(new RegExp(`#\\{${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g"), String(def));
  }
  return out;
}

// The atomics install base on Windows endpoints. Under ProgramData so a
// service-account (LocalSystem) agent can always write it.
const WIN_ART_BASE = "C:\\ProgramData\\AtomicRedTeam";

/**
 * Build a PowerShell command that runs a single atomic through the official
 * Invoke-AtomicRedTeam harness. Running the raw ART `command` string directly
 * fails for most tests because they reference `PathToAtomicsFolder` /
 * `ExternalPayloads` — only Invoke-AtomicTest resolves those.
 *
 * The harness is expected to be PRE-INSTALLED on the fleet endpoint (via the
 * one-time host-prep script — see GET /api/v1/agent/prepare). We deliberately do
 * NOT install it at run time: downloading the atomics repo takes minutes and
 * blows past the job timeout. If it's missing we fail fast with a clear message.
 */
function invokeAtomicWrapper(tid: string, testNumber: number, phase: "run" | "cleanup"): string {
  const psd1 = `${WIN_ART_BASE}\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1`;
  const atomics = `${WIN_ART_BASE}\\atomics`;
  const t = `"${tid}"`;
  if (phase === "cleanup") {
    return [
      `$ErrorActionPreference='Continue';`,
      `$psd1='${psd1}';`,
      `if(Test-Path $psd1){ Import-Module $psd1 -Force;`,
      `Invoke-AtomicTest ${t} -TestNumbers ${testNumber} -PathToAtomicsFolder '${atomics}' -Cleanup -Confirm:$false -ErrorAction Continue }`,
    ].join(" ");
  }
  return [
    `$ErrorActionPreference='Continue';`,
    `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;`,
    `$psd1='${psd1}';`,
    // ART must be pre-installed on the endpoint (fast path — no runtime install).
    `if(-not (Test-Path $psd1)){ Write-Output 'ERROR: Atomic Red Team is not installed on this endpoint. Run the fleet host-prep script once (Deploy -> Remote Fleet -> Prepare host), then retry.'; exit 3 };`,
    `Import-Module $psd1 -Force;`,
    // Resolve per-test prerequisites (already-cached tools are reused) then run.
    `Invoke-AtomicTest ${t} -TestNumbers ${testNumber} -PathToAtomicsFolder '${atomics}' -GetPrereqs -Confirm:$false -ErrorAction Continue;`,
    `Invoke-AtomicTest ${t} -TestNumbers ${testNumber} -PathToAtomicsFolder '${atomics}' -TimeoutSeconds 120 -Confirm:$false -ErrorAction Continue;`,
    `Write-Output 'ART_EXECUTION_DONE'`,
  ].join(" ");
}

export function bundleFromAtomic(at: AtomicTest): BundleContent {
  const args = safeJson<Record<string, any>>(at.inputArguments, {});
  const exec = (at.executorName || "sh").toLowerCase();
  const platforms = safeJson<string[]>(at.platforms, []);
  const isWindowsExec = exec === "powershell" || exec === "command_prompt";

  // Windows atomics run through Invoke-AtomicTest (resolves PathToAtomicsFolder +
  // downloads prereqs); Linux/macOS (bash/sh) keep the interpolated raw command.
  if (isWindowsExec) {
    return {
      technique: at.techniqueId,
      testIndex: at.testNumber,
      testName: at.testName,
      executor: "powershell",
      command: invokeAtomicWrapper(at.techniqueId, at.testNumber, "run"),
      cleanup: invokeAtomicWrapper(at.techniqueId, at.testNumber, "cleanup"),
      platforms,
      elevationRequired: at.elevationRequired,
    };
  }

  return {
    technique: at.techniqueId,
    testIndex: at.testNumber,
    testName: at.testName,
    executor: at.executorName || "sh",
    command: interpolate(at.command, args),
    cleanup: interpolate(at.cleanupCommand, args),
    platforms,
    elevationRequired: at.elevationRequired,
  };
}

/** Normalize an ATT&CK tactic into a scope token (same rule as buildDispatch). */
function normTactic(tactic: string): string {
  return (tactic || "").toLowerCase().trim().replace(/\s+/g, "-");
}

/**
 * LOTL addressing: a LotlTechnique has no (techniqueId, testNumber) natural key
 * that maps cleanly onto the atomic addressing, so we synthesize a STABLE one
 * from the row id. `technique` = the row's MITRE id (or "LOTL" when unmapped)
 * and `testIndex` = a deterministic 31-bit ordinal derived from the uuid. Both
 * are byte-stable for a given row, so canonicalBundle/bundleHash reproduce the
 * same hash on the control plane and on the agent's re-hash. The real lookup
 * key (`lotlId`) travels alongside in the dispatch/addressing — never inside the
 * hashed BundleContent — so resolveBundle can fetch the exact source row.
 */
export function lotlOrdinal(id: string): number {
  const h = createHash("sha256").update(id || "", "utf8").digest();
  // 31-bit non-negative ordinal; deterministic for a given row id.
  return h.readUInt32BE(0) % 1_000_000_000;
}

/**
 * Build the executable bundle for a LOTL technique — mirrors bundleFromAtomic's
 * BundleContent shape. LOTL rows are curated commands (LOLBAS/GTFOBins/…) stored
 * in the DB, so (unlike atomics) they do NOT go through the Invoke-AtomicTest
 * harness: the row's own `command`/`cleanupCommand` are the executable surface.
 * They are still rebuilt server-side from the DB row and hash-verified exactly
 * like atomics, so no raw-command-from-message path is introduced.
 */
export function bundleFromLotl(l: LotlTechnique): BundleContent {
  const platforms = safeJson<string[]>(l.platforms, []);
  const execRaw = (l.executor || "manual").toLowerCase().trim();
  // cmd → command_prompt; powershell/bash/manual pass through unchanged.
  const executor = execRaw === "cmd" ? "command_prompt" : execRaw || "manual";
  return {
    technique: l.techniqueId || "LOTL",
    testIndex: lotlOrdinal(l.id),
    testName: l.name,
    executor,
    command: l.command || "",
    cleanup: l.cleanupCommand || "",
    platforms,
    elevationRequired: l.elevationRequired,
  };
}

/**
 * A built-in benign bundle for dev / smoke / connectivity proof. Runs a
 * harmless echo and a harmless cleanup — proves the execute→cleanup→report
 * loop without performing any real adversary technique on the host.
 */
export function safeSmokeBundle(): BundleContent {
  return {
    technique: "T0000",
    testIndex: 1,
    testName: "DetectOps BAS connectivity check (benign)",
    executor: "sh",
    command: "echo detectops-bas-smoke-marker && whoami",
    cleanup: "echo detectops-bas-cleanup-done",
    platforms: ["linux", "macos"],
    elevationRequired: false,
  };
}

/**
 * Resolve a bundle by its hash. The caller usually also passes the
 * (technique, testIndex) hint so we can locate the source row directly instead
 * of scanning the whole catalogue, then we verify the recomputed hash matches.
 */
export async function resolveBundle(opts: { hash: string; technique?: string; testIndex?: number; lotlId?: string }): Promise<BundleContent | null> {
  // Built-in safe bundle.
  const safe = safeSmokeBundle();
  if (bundleHash(safe) === opts.hash) return safe;

  // LOTL selection: fetch the exact source row by id, rebuild, verify hash.
  // The synthetic (technique, testIndex) addressing can collide with a real
  // atomic, so when a lotlId is supplied we resolve ONLY via that row.
  if (opts.lotlId) {
    const l = await prisma.lotlTechnique.findUnique({ where: { id: opts.lotlId } });
    if (l) {
      const b = bundleFromLotl(l);
      if (bundleHash(b) === opts.hash) return b;
    }
    return null;
  }

  // Locate the AtomicTest by (technique, testIndex) when supplied.
  if (opts.technique && opts.testIndex != null) {
    const at = await prisma.atomicTest.findFirst({
      where: { techniqueId: opts.technique, testNumber: opts.testIndex },
    });
    if (at) {
      const b = bundleFromAtomic(at);
      if (bundleHash(b) === opts.hash) return b;
    }

    // LOTL fallback for agents that don't echo `lotl_id` (the Rust agent only
    // forwards hash/technique/testIndex). The synthetic LOTL addressing is
    // technique = row.techniqueId || "LOTL" and testIndex = lotlOrdinal(row.id),
    // so narrow to rows with that techniqueId, match the ordinal, then verify
    // the recomputed hash — integrity is still enforced by the hash re-check.
    const unmapped = opts.technique === "LOTL";
    const candidates = await prisma.lotlTechnique.findMany({
      where: unmapped ? { OR: [{ techniqueId: "" }, { techniqueId: null as any }] } : { techniqueId: opts.technique },
      take: 2000,
    }).catch(() => [] as LotlTechnique[]);
    for (const l of candidates) {
      if (lotlOrdinal(l.id) !== opts.testIndex) continue;
      const b = bundleFromLotl(l);
      if (bundleHash(b) === opts.hash) return b;
    }
  }
  return null;
}

/**
 * Build a dispatchable bundle reference for an atomic (or the safe smoke test).
 * Returns the operation `data` payload — note it carries NO command/cleanup,
 * only the addressing + hash, so the job message itself is not executable.
 */
export async function buildDispatch(opts: { useSmoke?: boolean; technique?: string; testIndex?: number; lotlId?: string; maxRuntimeMs?: number }): Promise<
  | { ok: true; data: { technique: string; testIndex: number; bundleHash: string; maxRuntimeMs: number; scope: string; lotlId?: string }; bundle: BundleContent }
  | { ok: false; error: string }
> {
  let bundle: BundleContent | null = null;
  let scope = "diagnostic";                       // safe smoke test → benign scope
  let lotlId: string | undefined;                 // addressing key for LOTL rows
  if (opts.useSmoke) {
    bundle = safeSmokeBundle();
  } else if (opts.lotlId) {
    const l = await prisma.lotlTechnique.findUnique({ where: { id: opts.lotlId } });
    if (!l) return { ok: false, error: `LotlTechnique ${opts.lotlId} not found` };
    bundle = bundleFromLotl(l);
    lotlId = l.id;
    // Scope = the ATT&CK tactic when the row is mapped; otherwise fall back to a
    // risk-level token so unmapped LOTL rows still carry a meaningful scope.
    scope = normTactic(l.tactic) || `lotl-${(l.riskLevel || "medium").toLowerCase().trim() || "medium"}`;
  } else if (opts.technique && opts.testIndex != null) {
    const at = await prisma.atomicTest.findFirst({ where: { techniqueId: opts.technique, testNumber: opts.testIndex } });
    if (!at) return { ok: false, error: `AtomicTest ${opts.technique} #${opts.testIndex} not found` };
    bundle = bundleFromAtomic(at);
    // Scope = the ATT&CK tactic (normalized), used for allowed-scope enforcement.
    scope = normTactic(at.tactic) || "unspecified";
  } else {
    return { ok: false, error: "specify useSmoke:true, {lotlId}, or {technique,testIndex}" };
  }
  if (!bundle.command) return { ok: false, error: "bundle has no command" };
  return {
    ok: true,
    data: {
      technique: bundle.technique,
      testIndex: bundle.testIndex,
      bundleHash: bundleHash(bundle),
      maxRuntimeMs: Math.min(600_000, Math.max(5_000, opts.maxRuntimeMs || 120_000)),
      scope,
      ...(lotlId ? { lotlId } : {}),
    },
    bundle,
  };
}
