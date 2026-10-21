import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { classifyExclusion } from "@/lib/coverage-assessment/exclusions";

/**
 * Ransomware emulation plans — curated, source-cited attack chains per gang
 * (config/ransomware-emulation/plans/*.json, format in SCHEMA.md). Each chain
 * step maps to EXISTING local Atomic Red Team tests; resolvePlan() checks every
 * mapped test against the catalogue and classifies it as runnable, excluded
 * (destructive / credential-dump / session-hijack — never auto-detonated) or
 * missing. No commands are invented here: unmapped steps are reported as gaps.
 */

export interface PlanAtomic { testGuid: string; testNumber?: number; testName?: string; fidelity?: string; note?: string }
export interface PlanStep {
  order: number; tactic: string; techniqueId: string; techniqueName: string; procedure: string;
  tools?: string[]; signature?: boolean; observed?: string; sourceRefs?: string[];
  atomics?: PlanAtomic[]; noAtomicReason?: string;
}
export interface EmulationPlan {
  gang: string; displayName?: string; aliases?: string[]; status?: string; activeSince?: string; lineage?: string;
  summary?: string; uniqueTraits?: string[]; insufficientReporting?: boolean;
  sources?: Array<{ id: string; title: string; publisher?: string; date?: string; url?: string }>;
  chain: PlanStep[];
}

export type AtomicState = "runnable" | "excluded" | "missing" | "not-windows";
export interface ResolvedAtomic extends PlanAtomic {
  state: AtomicState; reason?: string;
  techniqueId?: string; elevationRequired?: boolean; executor?: string;
}
export interface ResolvedStep extends PlanStep { resolved: ResolvedAtomic[]; status: "runnable" | "mapped-excluded" | "gap" }
export interface PlanSummary {
  gang: string; displayName: string; status: string; insufficientReporting: boolean;
  steps: number; signatureSteps: number; runnableSteps: number; excludedSteps: number; gapSteps: number;
  runnableAtomics: number; tactics: string[];
}

const PLAN_DIR = join(process.cwd(), "config", "ransomware-emulation", "plans");
let cache: { key: string; plans: Map<string, EmulationPlan> } | null = null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Load every plan, keyed by normalised gang name (reloads when files change). */
export function loadPlans(): Map<string, EmulationPlan> {
  let files: string[] = [];
  try { files = readdirSync(PLAN_DIR).filter((f) => f.endsWith(".json")).sort(); } catch { return new Map(); }
  const key = files.map((f) => { try { return `${f}:${statSync(join(PLAN_DIR, f)).mtimeMs}`; } catch { return f; } }).join("|");
  if (cache && cache.key === key) return cache.plans;
  const plans = new Map<string, EmulationPlan>();
  for (const f of files) {
    try {
      const p = JSON.parse(readFileSync(join(PLAN_DIR, f), "utf8")) as EmulationPlan;
      if (!p?.gang || !Array.isArray(p.chain)) continue;
      p.chain.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      plans.set(norm(p.gang), p);
    } catch { /* malformed plan — surfaced by scripts/validate-ransomware-plans.py */ }
  }
  cache = { key, plans };
  return plans;
}

export function getPlan(gang: string): EmulationPlan | undefined {
  return loadPlans().get(norm(gang));
}

/** Resolve every mapped atomic of a plan against the local catalogue. */
export async function resolvePlan(plan: EmulationPlan): Promise<ResolvedStep[]> {
  const guids = [...new Set(plan.chain.flatMap((s) => (s.atomics || []).map((a) => a.testGuid)).filter(Boolean))];
  const rows = guids.length
    ? await prisma.atomicTest.findMany({
        where: { testGuid: { in: guids } },
        select: { testGuid: true, techniqueId: true, testNumber: true, testName: true, platforms: true, tactic: true, command: true, elevationRequired: true, executorName: true },
      })
    : [];
  const byGuid = new Map(rows.map((r) => [r.testGuid, r]));
  return plan.chain.map((s) => {
    const resolved: ResolvedAtomic[] = (s.atomics || []).map((a) => {
      const r = byGuid.get(a.testGuid);
      if (!r) return { ...a, state: "missing", reason: "test GUID not in the local Atomic Red Team catalogue" };
      const base = { ...a, testNumber: r.testNumber, testName: r.testName || a.testName, techniqueId: r.techniqueId, elevationRequired: !!r.elevationRequired, executor: r.executorName || "" };
      if (!(r.platforms || "").includes("windows")) return { ...base, state: "not-windows", reason: "not a Windows test" };
      const ex = classifyExclusion(r.techniqueId, r.tactic || s.tactic, r.command || "");
      if (ex.excluded) return { ...base, state: "excluded", reason: ex.reason };
      return { ...base, state: "runnable" };
    });
    const status = resolved.some((a) => a.state === "runnable") ? "runnable" : resolved.some((a) => a.state === "excluded") ? "mapped-excluded" : "gap";
    return { ...s, resolved, status };
  });
}

export async function summarizePlan(plan: EmulationPlan): Promise<PlanSummary> {
  const steps = await resolvePlan(plan);
  return {
    gang: plan.gang, displayName: plan.displayName || plan.gang, status: plan.status || "",
    insufficientReporting: !!plan.insufficientReporting,
    steps: steps.length,
    signatureSteps: steps.filter((s) => s.signature).length,
    runnableSteps: steps.filter((s) => s.status === "runnable").length,
    excludedSteps: steps.filter((s) => s.status === "mapped-excluded").length,
    gapSteps: steps.filter((s) => s.status === "gap").length,
    runnableAtomics: steps.reduce((n, s) => n + s.resolved.filter((a) => a.state === "runnable").length, 0),
    tactics: [...new Set(steps.map((s) => s.tactic))],
  };
}

/**
 * The runnable atomics of a plan in kill-chain order (first runnable test per
 * step by default; `allTests` includes every runnable mapped test). Used by the
 * gang simulate bridge and the coverage-assessment "ransomware" scope.
 */
export async function runnableChain(plan: EmulationPlan, allTests = false): Promise<Array<{ step: ResolvedStep; atomic: ResolvedAtomic }>> {
  const out: Array<{ step: ResolvedStep; atomic: ResolvedAtomic }> = [];
  const seen = new Set<string>();
  for (const step of await resolvePlan(plan)) {
    const ok = step.resolved.filter((a) => a.state === "runnable" && !seen.has(a.testGuid));
    for (const a of allTests ? ok : ok.slice(0, 1)) { seen.add(a.testGuid); out.push({ step, atomic: a }); }
  }
  return out;
}

let syncedKey = "";
/**
 * Backfill empty gang profile fields (knownTTPs, references, description) from
 * the curated plans so the TTPs tab is populated for every planned gang. Only
 * empty fields are filled — curated/enriched data is never overwritten. Runs
 * once per plan-set change.
 */
export async function syncPlanTTPs(): Promise<number> {
  const plans = loadPlans();
  if (!cache || cache.key === syncedKey) return 0;
  syncedKey = cache.key;
  let filled = 0;
  for (const p of plans.values()) {
    const row = await prisma.ransomwareGang.findUnique({ where: { name: p.gang }, select: { knownTTPs: true, references: true, description: true } });
    if (!row) continue;
    const patch: Record<string, string> = {};
    if (!row.knownTTPs || row.knownTTPs === "[]") {
      const seen = new Set<string>();
      const ttps = p.chain.filter((s) => s.techniqueId && !seen.has(s.techniqueId) && seen.add(s.techniqueId))
        .map((s) => ({ id: s.techniqueId, name: s.techniqueName, tactic: s.tactic }));
      patch.knownTTPs = JSON.stringify(ttps);
    }
    if ((!row.references || row.references === "[]") && p.sources?.length) {
      patch.references = JSON.stringify(p.sources.filter((s) => s.url).map((s) => ({ title: `${s.publisher ? s.publisher + ": " : ""}${s.title}`, url: s.url })));
    }
    if (!row.description && p.summary) patch.description = p.summary;
    if (Object.keys(patch).length) { await prisma.ransomwareGang.update({ where: { name: p.gang }, data: patch }); filled++; }
  }
  return filled;
}
