/**
 * Library Entry document schema (v1) — the atomic-style record an analyst authors
 * to add ONE new technique to an existing simulation library.
 *
 * Like an Atomic Red Team YAML, an entry is a small declarative document:
 *   - `kind: technique` — a knowledge + simulation entry (kill-chain, detections,
 *     mitigations, references) whose Simulate leg LINKS EXISTING, vetted local atomic
 *     tests (never free-form commands). `atomics: []` = coverage-only.
 *   - `kind: lotl`      — a Living-off-the-Land technique (binary + command) added to
 *     one of the LOTL libraries; gated for admin approval because it carries a command.
 *
 * Pure + client-safe (no DB / node imports). Server-side checks that need the DB
 * (target library exists, linked atomics resolve) live in store.ts.
 */

export const DOC_SCHEMA_VERSION = 1;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const MITIGATION_KINDS = ["gpo", "asr", "config", "network", "awareness", "edr", "allowlist"] as const;
export const LOTL_EXECUTORS = ["cmd", "powershell", "bash", "sh", "manual"] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const ATTACK_ID_RE = /^T\d{4}(\.\d{3})?$/;
export const KEY_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;

export interface AtomicLink { technique: string; name_includes?: string[]; why?: string }
export interface QueryDoc { format: "sigma" | "spl"; title: string; query: string }
export interface MitigationDoc { title: string; kind: (typeof MITIGATION_KINDS)[number]; mitre_id?: string; detail: string }
export interface ReferenceDoc { title: string; url: string }

export interface TechniqueEntryDoc {
  schema: number;
  kind: "technique";
  library: string;                 // target simulation moduleId (e.g. detectops.ad-attack)
  key: string;                     // slug, unique within the library
  name: string;
  group: string;                   // catalog group (OS / top-level), e.g. "Windows"
  domain: string;                  // facet within the library, e.g. "Remote Thread & Native API"
  attack_id: string;               // primary ATT&CK id
  attack_techniques: string[];
  tactic: string;
  platforms: string[];
  severity: (typeof SEVERITIES)[number];
  summary: string;
  description: string;
  abuse: string;
  lab_setup: string[];
  chain_narrative: string[];
  atomics: AtomicLink[];           // links to EXISTING local atomic tests; [] = coverage-only
  simulate_note: string;
  detection: { summary: string; data_sources: string[]; queries: QueryDoc[] };
  mitigations: MitigationDoc[];
  references: ReferenceDoc[];
  changelog: string;
}

export interface LotlEntryDoc {
  schema: number;
  kind: "lotl";
  library: string;                 // "lotl:<sourceId>", e.g. lotl:lolbas
  key: string;
  name: string;
  description: string;
  command: string;
  executor: (typeof LOTL_EXECUTORS)[number];
  cleanup_command: string;
  attack_id: string;
  tactic: string;
  binary_path: string;
  elevation_required: boolean;
  risk_level: (typeof RISK_LEVELS)[number];
  platforms: string[];
  source_url: string;
  changelog: string;
}

export type EntryDoc = TechniqueEntryDoc | LotlEntryDoc;

export const slugify = (s: string) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const str = (v: unknown, d = "") => (typeof v === "string" ? v.trim() : v == null ? d : String(v).trim());
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Default catalog group from platforms when the author leaves it blank. */
export function defaultGroup(platforms: string[]): string {
  const p = platforms.map((x) => x.toLowerCase());
  if (p.includes("windows")) return "Windows";
  if (p.includes("linux")) return "Linux";
  if (p.includes("macos")) return "macOS";
  if (p.some((x) => ["aws", "azure", "gcp", "cloud", "saas"].includes(x))) return "Cloud";
  return "General";
}

/** Coerce arbitrary parsed YAML/JSON into a well-typed entry doc (never throws). */
export function normalizeDoc(raw: any): EntryDoc {
  const kind = str(raw?.kind, "technique").toLowerCase() === "lotl" ? "lotl" : "technique";
  const library = str(raw?.library);
  const name = str(raw?.name);
  const key = str(raw?.key) || slugify(name);
  const platforms = strArr(raw?.platforms).map((p) => p.toLowerCase());
  const attack_id = str(raw?.attack_id).toUpperCase();
  const tactic = str(raw?.tactic).toLowerCase().replace(/\s+/g, "-");
  const schema = Number(raw?.schema) || DOC_SCHEMA_VERSION;
  const changelog = str(raw?.changelog);

  if (kind === "lotl") {
    return {
      schema, kind, library, key, name, description: str(raw?.description), command: typeof raw?.command === "string" ? raw.command : "",
      executor: (LOTL_EXECUTORS as readonly string[]).includes(str(raw?.executor)) ? (str(raw?.executor) as any) : "manual",
      cleanup_command: typeof raw?.cleanup_command === "string" ? raw.cleanup_command : "",
      attack_id, tactic, binary_path: str(raw?.binary_path), elevation_required: !!raw?.elevation_required,
      risk_level: (RISK_LEVELS as readonly string[]).includes(str(raw?.risk_level)) ? (str(raw?.risk_level) as any) : "medium",
      platforms, source_url: str(raw?.source_url), changelog,
    };
  }

  const det = raw?.detection || {};
  return {
    schema, kind, library, key, name,
    group: str(raw?.group) || defaultGroup(platforms),
    domain: str(raw?.domain) || "Analyst-added",
    attack_id,
    attack_techniques: strArr(raw?.attack_techniques).map((t) => t.toUpperCase()).concat(attack_id && !strArr(raw?.attack_techniques).map((t) => t.toUpperCase()).includes(attack_id) ? [attack_id] : []),
    tactic, platforms,
    severity: (SEVERITIES as readonly string[]).includes(str(raw?.severity)) ? (str(raw?.severity) as any) : "medium",
    summary: str(raw?.summary), description: str(raw?.description), abuse: str(raw?.abuse),
    lab_setup: strArr(raw?.lab_setup), chain_narrative: strArr(raw?.chain_narrative),
    atomics: arr(raw?.atomics).map((a) => ({ technique: str(a?.technique).toUpperCase(), name_includes: strArr(a?.name_includes), why: str(a?.why) })),
    simulate_note: str(raw?.simulate_note),
    detection: {
      summary: str(det?.summary),
      data_sources: strArr(det?.data_sources),
      queries: arr(det?.queries).map((q) => ({ format: str(q?.format).toLowerCase() as any, title: str(q?.title), query: typeof q?.query === "string" ? q.query : "" })),
    },
    mitigations: arr(raw?.mitigations).map((m) => ({ title: str(m?.title), kind: str(m?.kind).toLowerCase() as any, mitre_id: str(m?.mitre_id) || undefined, detail: str(m?.detail) })),
    references: arr(raw?.references).map((r) => ({ title: str(r?.title), url: str(r?.url) })),
    changelog,
  };
}

export interface Issues { errors: string[]; warnings: string[] }

/** Structural validation that needs no DB. Server-side checks are layered on top. */
export function checkDoc(doc: EntryDoc): Issues {
  const errors: string[] = []; const warnings: string[] = [];
  if (!doc.library) errors.push("library: required (target library — pick one from the Module Builder list)");
  if (!KEY_RE.test(doc.key)) errors.push("key: 3–60 chars, lowercase letters/digits/hyphens (auto-derived from name when omitted)");
  if (doc.name.length < 3 || doc.name.length > 120) errors.push("name: 3–120 characters");
  if (doc.attack_id && !ATTACK_ID_RE.test(doc.attack_id)) errors.push(`attack_id: "${doc.attack_id}" is not a valid ATT&CK id (T#### or T####.###)`);

  if (doc.kind === "lotl") {
    if (!doc.library.startsWith("lotl:")) errors.push('library: a lotl entry must target "lotl:<sourceId>" (e.g. lotl:lolbas)');
    if (!doc.command.trim()) errors.push("command: required for a lotl entry");
    if (doc.command.length > 4000) errors.push("command: max 4000 characters");
    if (doc.description.length < 10) errors.push("description: at least 10 characters");
    if (!doc.platforms.length) errors.push("platforms: at least one (windows | linux | macos)");
    if (!doc.attack_id) warnings.push("attack_id: not set — the technique will be unmapped for ATT&CK/coverage");
    return { errors, warnings };
  }

  if (doc.library.startsWith("lotl:")) errors.push("library: a technique entry must target a simulation module (not a lotl library) — use kind: lotl for LOTL");
  if (!doc.attack_id) errors.push("attack_id: required (primary ATT&CK id)");
  if (!doc.tactic) errors.push("tactic: required (e.g. defense-evasion)");
  if (!doc.platforms.length) errors.push("platforms: at least one (windows | linux | macos | aws | azure | gcp …)");
  for (const t of doc.attack_techniques) if (!ATTACK_ID_RE.test(t)) errors.push(`attack_techniques: "${t}" is not a valid ATT&CK id`);
  if (doc.summary.length < 10) errors.push("summary: at least 10 characters (one line shown on the card)");
  if (doc.description.length < 20) errors.push("description: at least 20 characters");
  doc.atomics.forEach((a, i) => {
    if (!ATTACK_ID_RE.test(a.technique)) errors.push(`atomics[${i}].technique: "${a.technique}" is not a valid ATT&CK id`);
    if (!a.name_includes?.length) warnings.push(`atomics[${i}]: no name_includes — links ALL local tests for ${a.technique}; add name_includes to avoid duplicating other entries' tests`);
  });
  if (!doc.detection.queries.length) warnings.push("detection.queries: none — add at least one Sigma or SPL query so the entry is detection-ready");
  doc.detection.queries.forEach((q, i) => {
    if (q.format !== "sigma" && q.format !== "spl") errors.push(`detection.queries[${i}].format: must be "sigma" or "spl"`);
    if (!q.title) errors.push(`detection.queries[${i}].title: required`);
    if (!q.query.trim()) errors.push(`detection.queries[${i}].query: required`);
    if (q.query.length > 8000) errors.push(`detection.queries[${i}].query: max 8000 characters`);
  });
  if (!doc.mitigations.length) warnings.push("mitigations: none — add at least one mitigation");
  doc.mitigations.forEach((m, i) => {
    if (!m.title || !m.detail) errors.push(`mitigations[${i}]: title and detail are required`);
    if (!(MITIGATION_KINDS as readonly string[]).includes(m.kind)) errors.push(`mitigations[${i}].kind: must be one of ${MITIGATION_KINDS.join(" | ")}`);
  });
  doc.references.forEach((r, i) => {
    if (!r.title || !/^https?:\/\//i.test(r.url)) errors.push(`references[${i}]: title and an http(s) url are required`);
  });
  if (!doc.references.length) warnings.push("references: none — cite the source of the new method (report, blog, ATT&CK page)");
  return { errors, warnings };
}

/** Starter YAML shown in the builder (comments explain every field). */
export function templateYaml(kind: "technique" | "lotl", library: string, group = "Windows", domain = "Analyst-added"): string {
  if (kind === "lotl") {
    return `# Living-off-the-Land entry — adds one technique to a LOTL library.
# Requires admin approval before it is published (it carries a command).
schema: 1
kind: lotl
library: ${library || "lotl:lolbas"}
name: Example binary proxy execution
description: One or two sentences on how the binary is abused and why defenders care.
command: example.exe /run https://example.invalid/test
executor: cmd                # cmd | powershell | bash | sh | manual
cleanup_command: ""
attack_id: T1218             # ATT&CK id (optional but recommended)
tactic: defense-evasion
binary_path: C:\\Windows\\System32\\example.exe
elevation_required: false
risk_level: medium           # low | medium | high
platforms: [windows]
source_url: https://example.com/where-you-found-it
changelog: Initial entry
`;
  }
  return `# Technique entry — adds one named technique to the target library.
# The Simulate leg LINKS existing local atomic tests (it never runs free-form
# commands). Use atomics: [] for a coverage-only entry.
schema: 1
kind: technique
library: ${library || "detectops.shellcode-injection-sim"}
key: example-new-method            # unique slug within the library (auto from name if omitted)
name: Example new injection method
group: ${group}                    # catalog group, e.g. Windows | Linux | macOS | Cloud
domain: ${domain}                  # facet inside the library
attack_id: T1055                   # primary ATT&CK id
attack_techniques: [T1055]
tactic: defense-evasion
platforms: [windows]
severity: high                     # low | medium | high | critical
summary: One line shown on the technique card.
description: What the technique does, at the level a detection engineer needs.
abuse: How real attackers use it and why it evades common detections.
lab_setup:
  - Windows endpoint (isolated VM)
  - Sysmon EID 1, 8, 10
chain_narrative:
  - "Target selection: ..."
  - "Memory operation: ..."
  - "Execution trigger: ..."
atomics:                           # link EXISTING local tests only; [] = coverage-only
  - technique: T1055
    name_includes: [CreateRemoteThread]
    why: Vetted Atomic Red Team test that reproduces this behaviour.
simulate_note: Run only in an isolated lab VM.
detection:
  summary: Correlate the stages, not a single API call.
  data_sources: [Sysmon EID 8 (CreateRemoteThread)]
  queries:
    - format: spl
      title: Remote thread with no backing module
      query: index=* sourcetype="XmlWinEventLog:Microsoft-Windows-Sysmon/Operational" EventCode=8 StartModule="" | stats count by SourceImage, TargetImage
    - format: sigma
      title: Remote thread starting in unbacked memory
      query: |
        title: Remote Thread Starting In Unbacked Memory
        logsource:
          product: windows
          category: create_remote_thread
        detection:
          selection:
            StartModule: ''
          condition: selection
        level: high
mitigations:
  - title: Exploit Protection (ACG / CIG)
    kind: config                   # gpo | asr | config | network | awareness | edr | allowlist
    mitre_id: M1050
    detail: Enable Arbitrary Code Guard and Code Integrity Guard for high-value processes.
references:
  - title: MITRE ATT&CK T1055
    url: https://attack.mitre.org/techniques/T1055/
changelog: Initial entry
`;
}
