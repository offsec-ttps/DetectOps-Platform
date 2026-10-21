/**
 * Simulation Module manifest types (the module.json contract).
 *
 * Client-safe: NO runtime imports (the builder UI imports this). The compiler
 * (server-only) maps these to the runner's ScenarioStep — kept structurally
 * identical to `ScenarioStep` in src/lib/enterprise-use-cases/runner.ts.
 */

// MUST stay in sync with ScenarioStep["framework"] in runner.ts.
export const MODULE_FRAMEWORKS = [
  "atomic", "purplesharp", "stratus", "manual", "reverse-shell", "bind-shell", "agent",
] as const;
export type ModuleFramework = (typeof MODULE_FRAMEWORKS)[number];

export const MODULE_CATEGORIES = [
  "ransomware", "phishing", "lateral-movement", "exfiltration", "persistence",
  "credential-access", "c2", "discovery", "impact", "apt",
  "container", "cloud", "active-directory", "hacktools", "deceptive-delivery",
  "privilege-escalation", "uac-bypass", "user-to-admin", "user-to-system", "other",
] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

export interface ModuleStepDef {
  framework: ModuleFramework;
  refId?: string;            // for framework=atomic, MUST be an existing AtomicTest.testGuid
  techniqueId?: string;      // ATT&CK id (e.g. T1486)
  displayName: string;
  parameters?: Record<string, unknown>;
  expectedSignal?: string;
  notes?: string;
}

export interface ModuleScenarioDef {
  name: string;
  description?: string;
  steps: ModuleStepDef[];
}

export interface ModuleNavContribution {
  label: string;
  sub?: string;              // sub-path under /modules/<id>/
  icon?: string;             // lucide-react icon name
  badge?: string;
}

export interface ModulePermissions {
  frameworks: ModuleFramework[];   // dispatchers the module may emit
  integrations: string[];          // Integration.type values it needs (siem, edr, ...)
  dataScopes: string[];            // e.g. "atomic-catalogue:read"
}

export interface ModuleDependency {
  name: string;                    // another module's moduleId
  version: string;                 // semver range (^1.2.0, ~1.2, >=1.0.0, 1.2.3)
}

export interface ModuleManifest {
  id: string;                      // publisher.name  (^[a-z0-9-]+\.[a-z0-9-]+$)
  name: string;
  version: string;                 // semver MAJOR.MINOR.PATCH[-pre]
  category: ModuleCategory;
  description: string;
  author: string;
  icon?: string;
  compatibleCoreVersion: string;   // semver range checked against CORE_VERSION
  permissions: ModulePermissions;
  dependencies: ModuleDependency[];
  contributes: {
    nav?: ModuleNavContribution[];
    scenarios: ModuleScenarioDef[];
    widgets?: Array<{ id: string; title: string; kind: string }>;
    ownedTables?: string[];        // declarative only (not auto-migrated in v1)
    view?: string;                 // opt into a built-in rich view (e.g. "ransomware-intel")
    // Curated technique catalogue for the "technique-catalog" / "attack-catalog"
    // views. Resolved to atomic tests at simulate-time (no pre-baked testGuids
    // needed). `domain` lets the attack-catalog view facet groups by sub-domain
    // (e.g. Docker vs Kubernetes, AWS vs Azure vs GCP) within one library.
    // `uid` + `match` are optional: several named entries may share one ATT&CK id
    // (e.g. many shellcode-injection variants all under T1055). `uid` makes each
    // entry its own row group; `match` narrows the id's atomic tests to those whose
    // name contains any term (`[]` = catalogued for coverage, no runnable atomic).
    catalog?: Array<{ name: string; domain?: string; description?: string; techniques: Array<{ id: string; name: string; tactic?: string; uid?: string; match?: string[] }> }>;
  };
  entryPoints?: Record<string, string>;  // declarative pointers only
}

/** A package = manifest + (optionally inline) scenarios. v1 upload format is JSON. */
export interface ModulePackage {
  manifest: ModuleManifest;
  scenarios?: ModuleScenarioDef[];  // optional override/supplement to contributes.scenarios
}
