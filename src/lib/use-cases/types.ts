/**
 * Use Case Builder — shared types.
 *
 * Authoring side:
 *   AtomicYamlInput        — the field-by-field shape AtomicGen edits.
 *   PurpleSharpPlaybookInput — verified from PurpleTeamPlaybook samples.
 *
 * Persistence side:
 *   UseCaseDraft / StepDraft — what the POST /api/use-cases body looks like.
 *   PlaybookFormat            — every exporter target.
 *
 * Anything that gets persisted as a JSON column passes through one of these.
 */

export type PlaybookFormat = "atomic-yaml" | "purplesharp-json" | "stratus-sh";
export type AuthorMode = "atomic" | "purplesharp" | "canvas";
export type FrameworkKind = "atomic" | "purplesharp" | "stratus" | "mixed";
export type UseCaseSource = "manual" | "ti" | "rule" | "upload";
export type StepKind = "atomic" | "purplesharp" | "stratus" | "manual" | "condition";

/**
 * ART test shape (technique-level). Mirrors AtomicGen.io's `base` object in
 * its App.jsx, kept as a single test (one test per UseCase emit). For
 * multi-test playbooks we wrap many of these inside one technique block.
 */
export interface AtomicYamlInput {
  attack_technique: string | null;          // T1003.001
  display_name: string | null;              // human technique name
  name: string | null;                      // test name
  description: string | null;
  supported_platforms: string[];            // ["windows", "linux", …]
  input_arguments: Array<{
    name: string;
    type: string;                           // path | string | url | integer
    description?: string;
    default?: string;
  }>;
  dependency_executor_name: string;         // powershell | bash | sh | …
  dependencies: Array<{
    description: string;
    prereq_command: string;
    get_prereq_command?: string;
  }>;
  executor: {
    name: string;                           // powershell | command_prompt | bash | sh | manual
    command: string | null;
    cleanup_command: string | null;
    elevation_required: boolean;
    steps?: string | null;                  // for executor.name === "manual"
  };
  auto_generated_guid: string | null;
}

/**
 * PurpleSharp JSON playbook shape — verified against
 * github.com/mvelazc0/PurpleTeamPlaybook (Conti_CredentialAccess.json).
 */
export interface PurpleSharpPlaybookInput {
  type: "local" | "remote";
  sleep: number;
  playbooks: Array<{
    name: string;
    enabled: boolean;
    task_sleep: number;
    tasks: Array<{
      technique_id: string;                 // T1003.001
      technique_name: string;
      variation?: number;
      url?: string;
      command?: string;
    }>;
  }>;
}

/**
 * Per-step record persisted on UseCaseStep.parameters as JSON. The exporter
 * picks the relevant slice based on `kind`.
 */
export interface StepParameters {
  // Common
  expectedSignal?: string;

  // ART (atomic)
  atomic?: {
    yaml?: AtomicYamlInput;                       // full YAML body if authored standalone
    testGuid?: string;                            // FK into AtomicTest.testGuid if picked from library
    testName?: string;
    testDescription?: string;
    techniqueName?: string;
    tactic?: string;
    executor?: string;                            // executor.name override
    platforms?: string[];
    elevationRequired?: boolean;
    command?: string;
    cleanupCommand?: string;
    inputArguments?: Record<string, string>;      // user-editable values  (interpolated at runtime)
    argSpecs?: Record<string, { description?: string; type?: string; default?: string }>;
  };

  // PurpleSharp
  purplesharp?: {
    variation: number;
    url?: string;
    command?: string;
    techniqueName?: string;
    variationLabel?: string;
    description?: string;
    tactic?: string;
    requiresUrl?: boolean;
    requiresCommand?: boolean;
  };

  // Stratus
  stratus?: {
    phases: Array<"warmup" | "detonate" | "cleanup">;
    region?: string;
    attackId?: string;
    name?: string;
    description?: string;
    platform?: string;
    tactic?: string;
    prerequisites?: string;
    detonateCmd?: string;
    cleanupCmd?: string;
    isIdempotent?: boolean;
  };

  // Free-form manual step (also used as a fallback when the LLM can't map a
  // suggestion to a known catalogue entry).
  manual?: {
    executor?: "powershell" | "bash" | "sh" | "command_prompt" | "manual";
    binary?: string;            // explicit binary or script path override
    command?: string;
    cleanup_command?: string;
    options?: string[];         // flag/option list (rendered verbatim after the binary)
  };

  // Branching condition node — the runner picks the "true" edge when
  // `predicate` evaluates truthy at runtime, else the "false" edge.
  condition?: {
    predicate?: string;         // human-readable check (e.g. "previous exit == 0")
    label?: string;             // short tag shown on the node
  };
}

export interface StepDraft {
  orderIndex: number;
  kind: StepKind;
  refId?: string;
  techniqueId: string;
  displayName: string;
  parameters?: StepParameters;
  expectedSignal?: string;
  notes?: string;
}

export interface UseCaseDraft {
  name: string;
  description?: string;
  authorMode: AuthorMode;
  framework: FrameworkKind;
  source?: UseCaseSource;
  sourceRefType?: string;
  sourceRefId?: string;
  platforms?: string[];
  tags?: string[];
  steps?: StepDraft[];
}

export const SUPPORTED_PLATFORMS = [
  "windows", "macos", "linux",
  "office-365", "azure-ad", "google-workspace",
  "saas", "iaas", "containers",
  "iaas:gcp", "iaas:azure", "iaas:aws",
] as const;

export const EXECUTOR_NAMES = [
  "powershell", "command_prompt", "bash", "sh", "manual",
] as const;
