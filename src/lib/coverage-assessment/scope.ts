import { prisma } from "@/lib/prisma";
import { publishedTechniqueEntries, mergeEntriesIntoManifest } from "@/lib/library-entries/store";
import { classifyExclusion } from "./exclusions";
import { getPlan, resolvePlan } from "@/lib/ransomware-intel/emulation";

// A simulation library = a marketplace module that contributes a technique
// catalog (contributes.catalog[].techniques[].id). The coverage sweep can be
// scoped to the full installed library, to one or more of these libraries, or
// to an explicit technique list.

export interface LibraryInfo { moduleId: string; label: string; techniqueCount: number }
// `excluded` carries the reason an atomic is normally skipped (impact /
// destructive / credential-dump / session-hijack). It is only populated when a
// scope opts into `includeDestructive`; `riskTier` orders those last — tier 2
// (credential-dump / execution-hijack) poisons the WinRM session, so it runs
// after tier 1 (impact / destructive), which runs after tier 0 (everything else).
export interface ResolvedAtomic { tech: string; num: number; name: string; tactic: string; library: string; command: string; excluded?: string; riskTier?: number }
// mode "ransomware": the runnable atomics of the named gangs' curated emulation
// plans (config/ransomware-emulation/plans), in kill-chain order.
// includeDestructive: opt-in to ALSO resolve the normally-excluded atomics
// (impact / destructive / credential-dump / session-hijack) so a sweep can reach
// full coverage. They are tagged (`excluded`) and ordered last (`riskTier`). The
// API only honours this for a snapshot-protected local lab, and the worker
// reverts + deletes that snapshot once the sweep finishes.
export interface ScopeSpec { mode: "full" | "libraries" | "techniques" | "ransomware"; libraries?: string[]; techniques?: string[]; gangs?: string[]; includeDestructive?: boolean }

/** Risk tier for an excluded atomic: 2 = session-poisoning (cred-dump / hijack),
 * runs absolute-last; 1 = impact / destructive; 0 = not excluded. */
export function riskTierFor(reason: string): number {
  if (/credential dumping|global process-execution hijack/i.test(reason)) return 2;
  return reason ? 1 : 0;
}

// Per technique id: null = every local test for that id; string[] = only tests whose
// name contains one of the terms (catalog `match` narrowing — several named entries can
// share one ATT&CK id); [] = coverage-only (catalogued, no runnable test).
type Narrow = string[] | null;
interface CatalogModule { moduleId: string; label: string; techniques: Set<string>; narrow: Map<string, Narrow> }

function mergeNarrow(a: Narrow | undefined, b: Narrow): Narrow {
  if (a === undefined) return b;
  if (a === null || b === null) return null;
  return [...new Set([...a, ...b])];
}

/** Load every module that contributes a technique catalog. */
async function catalogModules(): Promise<CatalogModule[]> {
  const rows = await prisma.simulationModule.findMany({ select: { moduleId: true, manifest: true } });
  const entryDocs = await publishedTechniqueEntries().catch(() => []);
  const out: CatalogModule[] = [];
  for (const r of rows) {
    try {
      const m = mergeEntriesIntoManifest(JSON.parse(r.manifest || "{}"), entryDocs.filter((e) => e.row.moduleId === r.moduleId).map((e) => e.doc));
      const cat = m?.contributes?.catalog;
      if (!Array.isArray(cat) || cat.length === 0) continue;
      const techs = new Set<string>();
      const narrow = new Map<string, Narrow>();
      for (const g of cat) for (const t of (g.techniques || [])) {
        if (!t?.id) continue;
        const id = String(t.id).toUpperCase();
        techs.add(id);
        const rule: Narrow = Array.isArray(t.match) ? t.match.map((x: unknown) => String(x).toLowerCase()) : null;
        narrow.set(id, mergeNarrow(narrow.get(id), rule));
      }
      if (techs.size) out.push({ moduleId: r.moduleId, label: m.name || r.moduleId, techniques: techs, narrow });
    } catch { /* skip malformed manifest */ }
  }
  return out;
}

/** Libraries the analyst can scope a sweep to. */
export async function listLibraries(): Promise<LibraryInfo[]> {
  const mods = await catalogModules();
  return mods
    .map((m) => ({ moduleId: m.moduleId, label: m.label, techniqueCount: m.techniques.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** technique-id (upper) -> first library label that claims it. */
function reverseLibMap(mods: CatalogModule[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const mod of mods) for (const t of mod.techniques) if (!m.has(t)) m.set(t, mod.label);
  return m;
}

const VALID_TID = /^T\d{4}(\.\d{3})?$/;

/**
 * Resolve the atomic universe for a scope. Applies destructive/credential-dump
 * exclusions and, when `installed` is non-empty, keeps only atomics whose
 * technique folder is present on the host. Each atomic is labelled with its
 * originating library (or the ATT&CK tactic when no library claims it).
 */
export async function resolveScope(scope: ScopeSpec, installed?: Set<string>): Promise<ResolvedAtomic[]> {
  const mods = await catalogModules();
  const libOf = reverseLibMap(mods);

  // Which technique ids are in scope (upper-cased), or null = all windows.
  let techFilter: Set<string> | null = null;
  let narrowFor: Map<string, Narrow> | null = null;
  if (scope.mode === "libraries") {
    const want = new Set((scope.libraries || []).map((s) => s));
    techFilter = new Set<string>();
    narrowFor = new Map();
    for (const mod of mods) if (want.has(mod.moduleId) || want.has(mod.label)) {
      for (const t of mod.techniques) {
        techFilter.add(t);
        narrowFor.set(t, mergeNarrow(narrowFor.get(t), mod.narrow.get(t) ?? null));
      }
    }
  } else if (scope.mode === "ransomware") {
    return resolveRansomwareScope(scope.gangs || [], installed, scope.includeDestructive === true);
  } else if (scope.mode === "techniques") {
    techFilter = new Set((scope.techniques || []).map((t) => t.toUpperCase()).filter((t) => VALID_TID.test(t)));
  }

  const rows = await prisma.atomicTest.findMany({
    where: { platforms: { contains: "windows" } },
    select: { techniqueId: true, testNumber: true, testName: true, command: true, tactic: true },
    orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }],
  });

  const out: ResolvedAtomic[] = [];
  for (const r of rows) {
    const tid = r.techniqueId;
    if (!VALID_TID.test(tid)) continue;
    const tu = tid.toUpperCase();
    if (techFilter && !techFilter.has(tu)) continue;
    const rule = narrowFor?.get(tu);
    if (rule && !rule.some((term) => (r.testName || "").toLowerCase().includes(term))) continue;
    if (installed && installed.size > 0 && !installed.has(tu)) continue;
    const ex = classifyExclusion(tid, r.tactic || "", r.command || "");
    // Normally excluded atomics are skipped; with includeDestructive they are
    // kept but tagged and ordered last (see riskTierFor).
    if (ex.excluded && !scope.includeDestructive) continue;
    out.push({
      tech: tid,
      num: r.testNumber,
      name: r.testName || "",
      tactic: r.tactic || "",
      library: libOf.get(tu) || (r.tactic ? r.tactic.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "General"),
      command: r.command || "",
      excluded: ex.excluded ? ex.reason : undefined,
      riskTier: ex.excluded ? riskTierFor(ex.reason) : 0,
    });
  }
  return stableByTier(out);
}

/** Atomics for a ransomware-plan scope, chain-ordered and labelled per gang.
 * With includeDestructive, the plans' impact/credential-dump/destructive steps
 * are included too (tagged + ordered last via riskTier). */
async function resolveRansomwareScope(gangs: string[], installed?: Set<string>, includeDestructive = false): Promise<ResolvedAtomic[]> {
  const out: ResolvedAtomic[] = [];
  const seen = new Set<string>();
  // One gang → per-gang label; several → one shared label (atomics are deduped
  // across chains, so a per-gang label would misattribute shared tests; the
  // per-gang breakdown is rebuilt from the plans at report time).
  const multi = gangs.filter((g) => getPlan(g)).length > 1;
  for (const g of gangs) {
    const plan = getPlan(g);
    if (!plan) continue;
    const label = multi ? "Ransomware emulation" : `Ransomware · ${plan.displayName || plan.gang}`;
    const steps = await resolvePlan(plan);
    const guids = steps.flatMap((s) => s.resolved.map((a) => a.testGuid));
    const rows = await prisma.atomicTest.findMany({
      where: { testGuid: { in: guids } },
      select: { testGuid: true, techniqueId: true, testNumber: true, testName: true, command: true, tactic: true },
    });
    const byGuid = new Map(rows.map((r) => [r.testGuid, r]));
    for (const step of steps) for (const a of step.resolved) {
      // runnable → always; excluded (impact/cred-dump/destructive) → only with
      // includeDestructive, tagged + tiered so it runs last; others skipped.
      const keep = a.state === "runnable" || (a.state === "excluded" && includeDestructive);
      if (!keep) continue;
      const r = byGuid.get(a.testGuid);
      if (!r || !VALID_TID.test(r.techniqueId)) continue;
      const key = `${r.techniqueId}#${r.testNumber}`;
      if (seen.has(key)) continue;
      if (installed && installed.size > 0 && !installed.has(r.techniqueId.toUpperCase())) continue;
      seen.add(key);
      const reason = a.state === "excluded" ? (a.reason || "excluded") : "";
      out.push({ tech: r.techniqueId, num: r.testNumber, name: r.testName || "", tactic: r.tactic || step.tactic, library: label, command: r.command || "", excluded: reason || undefined, riskTier: riskTierFor(reason) });
    }
  }
  // Stable sort so excluded atomics (tier 1, then session-poisoning tier 2) run
  // last; the detonation order is the item `order` the POST route assigns next.
  return stableByTier(out);
}

/** Stable sort by riskTier ascending (0 → 1 → 2), preserving input order within
 * a tier, so normally-runnable atomics detonate before destructive ones and
 * session-poisoning (cred-dump / hijack) atomics run absolute-last. */
function stableByTier(rows: ResolvedAtomic[]): ResolvedAtomic[] {
  return rows.map((r, i) => [r, i] as const)
    .sort((a, b) => ((a[0].riskTier || 0) - (b[0].riskTier || 0)) || (a[1] - b[1]))
    .map(([r]) => r);
}
