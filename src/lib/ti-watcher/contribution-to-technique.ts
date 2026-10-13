/**
 * Map an approved SimLibraryContribution (DB row) into a TechniqueDef so the
 * existing AttackSimLibraryView and /api/attack-sim/atomics resolver can render
 * and run it with no view changes.
 *
 * Accuracy note: when the contribution has a linked AtomicTest we emit a
 * CuratedAtomic with `nameIncludes:[atomicTestName]` so the resolver returns
 * EXACTLY that one vetted test — never every test for the ATT&CK id (the blind-
 * mapping bug the curated-atomic model was built to avoid).
 */

import type { TechniqueDef, CuratedAtomic } from "@/lib/attack-sim/types";

export interface ContributionRow {
  id: string;
  libraryKey: string | null;
  category: string | null;
  techniqueKey: string;
  name: string;
  description: string;
  summary: string;
  abuse: string;
  attackTechniques: string;   // JSON string[]
  tactic: string | null;
  platforms: string;          // JSON string[]
  severity: string;
  sourceUrl: string | null;
  sourceVendor: string | null;
  sourceRefId: string;
  atomicTestId: string | null;
  atomicTestName: string | null;
  atomicTestNumber: number | null;
  needsAtomic: boolean;
}

function parseArr(s: string): string[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function clampSeverity(s: string): TechniqueDef["severity"] {
  return (["low", "medium", "high", "critical"].includes(s) ? s : "medium") as TechniqueDef["severity"];
}

/** The CuratedAtomic(s) backing a contribution, for the atomics resolver. */
export function contributionAtomics(row: ContributionRow): CuratedAtomic[] {
  const primary = parseArr(row.attackTechniques)[0];
  if (!primary || !row.atomicTestId || !row.atomicTestName) return [];
  return [{ techniqueId: primary, nameIncludes: [row.atomicTestName], why: "Vetted Atomic Red Team test linked by the Threat-Intelligence watcher for this technique." }];
}

export function contributionToTechnique(row: ContributionRow): TechniqueDef {
  const attackTechniques = parseArr(row.attackTechniques);
  const platforms = parseArr(row.platforms);
  const runnable = !!row.atomicTestId && platforms.map((p) => p.toLowerCase()).includes("windows");
  const sourceLabel = row.sourceVendor ? `${row.sourceVendor} threat intel` : "Threat Intelligence";

  return {
    key: row.techniqueKey,
    name: row.name,
    category: row.category || "From Threat Intelligence",
    description: row.description || row.summary || `Observed in ${sourceLabel}.`,
    attackTechniques,
    tactic: row.tactic || "execution",
    platforms: platforms.length ? platforms : ["windows"],
    severity: clampSeverity(row.severity),
    summary: row.summary || row.name,
    abuse: row.abuse || "Extracted from a Threat-Intelligence report; enrich with the real-world abuse scenario before using in awareness material.",
    labSetup: [
      "Windows endpoint (the SAR domain controller) as the 'victim'",
      "Sysmon + PowerShell Script Block logging forwarded to Splunk",
      "Lure/payload hosting is operator-driven and not provisioned by the platform",
    ],
    chainNarrative: [
      `Auto-imported from Threat Intelligence${row.sourceVendor ? ` (${row.sourceVendor})` : ""}.`,
      "Review the source report and enrich this kill-chain before relying on it operationally.",
    ],
    atomics: contributionAtomics(row),
    simulateNote: runnable
      ? "Simulate leg uses the single vetted Atomic Red Team test linked by the watcher."
      : "No directly-relevant atomic is linked yet — reference-only until an analyst links/authors a test.",
    runnableOnSar: runnable,
    detection: {
      summary: "Detection guidance not yet authored for this auto-imported technique. Start from the ATT&CK data sources below and the source report.",
      dataSources: ["Sysmon EventCode 1 (process create)", "PowerShell Script Block (4104)", "Windows Security 4688"],
      queries: [],
    },
    mitigations: [],
    references: row.sourceUrl ? [{ title: `Source report — ${sourceLabel}`, url: row.sourceUrl }] : [],
    origin: "ti-watcher",
    sourceRef: { url: row.sourceUrl || undefined, vendor: row.sourceVendor || undefined, reportId: row.sourceRefId },
    contributionId: row.id,
  };
}
