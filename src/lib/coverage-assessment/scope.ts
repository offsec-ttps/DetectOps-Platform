import { prisma } from "@/lib/prisma";
import { classifyExclusion } from "./exclusions";

// A simulation library = a marketplace module that contributes a technique
// catalog (contributes.catalog[].techniques[].id). The coverage sweep can be
// scoped to the full installed library, to one or more of these libraries, or
// to an explicit technique list.

export interface LibraryInfo { moduleId: string; label: string; techniqueCount: number }
export interface ResolvedAtomic { tech: string; num: number; name: string; tactic: string; library: string; command: string }
export interface ScopeSpec { mode: "full" | "libraries" | "techniques"; libraries?: string[]; techniques?: string[] }

interface CatalogModule { moduleId: string; label: string; techniques: Set<string> }

/** Load every module that contributes a technique catalog. */
async function catalogModules(): Promise<CatalogModule[]> {
  const rows = await prisma.simulationModule.findMany({ select: { moduleId: true, manifest: true } });
  const out: CatalogModule[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.manifest || "{}");
      const cat = m?.contributes?.catalog;
      if (!Array.isArray(cat) || cat.length === 0) continue;
      const techs = new Set<string>();
      for (const g of cat) for (const t of (g.techniques || [])) if (t?.id) techs.add(String(t.id).toUpperCase());
      if (techs.size) out.push({ moduleId: r.moduleId, label: m.name || r.moduleId, techniques: techs });
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
  if (scope.mode === "libraries") {
    const want = new Set((scope.libraries || []).map((s) => s));
    techFilter = new Set<string>();
    for (const mod of mods) if (want.has(mod.moduleId) || want.has(mod.label)) for (const t of mod.techniques) techFilter.add(t);
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
    if (installed && installed.size > 0 && !installed.has(tu)) continue;
    if (classifyExclusion(tid, r.tactic || "", r.command || "").excluded) continue;
    out.push({
      tech: tid,
      num: r.testNumber,
      name: r.testName || "",
      tactic: r.tactic || "",
      library: libOf.get(tu) || (r.tactic ? r.tactic.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "General"),
      command: r.command || "",
    });
  }
  return out;
}
