/**
 * Attack-Technique-Library framework — shared types (defensive).
 *
 * A "library" (e.g. ClickFix / Deceptive Delivery & Execution) is a declarative
 * `LibraryDef` of `TechniqueDef`s. Each technique is a KNOWLEDGE + SIMULATION
 * entry: a plain-language kill-chain narrative, the ATT&CK techniques it maps to
 * (which resolve to the platform's existing, vetted Atomic Red Team tests for the
 * Simulate leg — we do not ship bespoke payloads/lures), plus curated DETECTION
 * and MITIGATION / attack-surface-reduction guidance.
 *
 * Client-safe: NO runtime imports (the view imports this).
 */

export interface DetectionQuery { format: "sigma" | "spl"; title: string; query: string }
export interface Detection {
  summary: string;
  dataSources: string[];          // e.g. "Sysmon EventCode 1", "RunMRU registry"
  queries: DetectionQuery[];      // copyable Sigma / Splunk SPL
}

export type MitigationKind = "gpo" | "asr" | "config" | "network" | "awareness" | "edr" | "allowlist";
export interface Mitigation { title: string; detail: string; kind: MitigationKind; mitreId?: string }
export interface Reference { title: string; url: string }

/**
 * A CURATED, directly-relevant Atomic Red Team mapping — NOT a blind ATT&CK-id
 * resolve. The Simulate leg runs only these. `nameIncludes` narrows to the
 * specific tests that reproduce THIS technique (omit = the technique has a single
 * on-point test); `why` explains the relevance shown to the analyst.
 */
export interface CuratedAtomic { techniqueId: string; nameIncludes?: string[]; why: string }

export interface TechniqueDef {
  key: string;                    // unique slug within the library
  name: string;
  category: string;               // facet rail (e.g. "ClickFix", "Delivery & Obfuscation")
  variant?: string;
  description: string;            // what it is + the real campaign/tool it mirrors
  attackTechniques: string[];     // ATT&CK ids (for display/tagging)
  tactic: string;
  platforms: string[];            // platforms this technique can be simulated on (windows|linux|macos|aws|…)
  severity: "low" | "medium" | "high" | "critical";

  /** One-line "what it is" for the grid card. */
  summary: string;
  /** How bad actors misuse it — the real-world abuse scenario. */
  abuse: string;
  /** Resources needed to stand up a lab to replicate/simulate this behaviour. */
  labSetup: string[];
  /** Plain-language kill-chain steps, for understanding what a real attack does. */
  chainNarrative: string[];
  /** CURATED, directly-relevant Atomic Red Team tests for the Simulate leg. */
  atomics: CuratedAtomic[];
  /** Optional note shown on the Simulate tab. */
  simulateNote?: string;
  /** false = reference/catalog only (no directly-relevant local atomic). */
  runnableOnSar: boolean;

  // ── knowledge ──
  detection: Detection;
  mitigations: Mitigation[];
  references: Reference[];

  // ── provenance (set for entries contributed by the TI watcher; omitted for hand-curated ones) ──
  /** "curated" (default, hand-authored), "ti-watcher" (auto-contributed from Threat Intelligence) or "analyst" (added via the Module Builder library-entry flow). */
  origin?: "curated" | "ti-watcher" | "analyst";
  /** Source Threat-Intel report this entry was derived from. */
  sourceRef?: { url?: string; vendor?: string; reportId: string };
  /** SimLibraryContribution id backing this entry (for the atomics resolver + review trail). */
  contributionId?: string;
}

export interface LibraryDef {
  key: string;                    // "clickfix"
  moduleId: string;               // "detectops.clickfix-sim"
  name: string;                   // "Deceptive Delivery & Execution"
  shortName: string;              // "ClickFix"
  category: string;               // ModuleCategory slug, e.g. "deceptive-delivery"
  icon: string;                   // lucide icon name
  description: string;
  techniques: TechniqueDef[];
}
