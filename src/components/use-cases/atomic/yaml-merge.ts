/**
 * Bridge between upstream Atomic-Red-Team YAML shape (technique block with N
 * atomic_tests) and our single-test form state (`AtomicYamlInput`).
 *
 * Upstream YAML looks like:
 *   attack_technique: T1003.001
 *   display_name: OS Credential Dumping: LSASS Memory
 *   atomic_tests:
 *     - name: Dump LSASS via comsvcs.dll
 *       auto_generated_guid: ...
 *       description: ...
 *       supported_platforms: [windows]
 *       input_arguments:
 *         output_file: { description: ..., type: path, default: "..." }
 *       dependency_executor_name: powershell
 *       dependencies:
 *         - description: ...
 *           prereq_command: ...
 *           get_prereq_command: ...
 *       executor:
 *         name: powershell
 *         elevation_required: true
 *         command: ...
 *         cleanup_command: ...
 *
 * The form edits ONE atomic test at a time, so we accept either:
 *   - a wrapper { attack_technique, display_name, atomic_tests: [...] } + a test index
 *   - a bare test object
 *   - an array of bare test objects (legacy)
 */

import { baseAtomic } from "./schema";
import type { AtomicYamlInput } from "@/lib/use-cases/types";

interface RawUpstreamTest {
  name?: unknown;
  auto_generated_guid?: unknown;
  description?: unknown;
  supported_platforms?: unknown;
  input_arguments?: unknown;
  dependency_executor_name?: unknown;
  dependencies?: unknown;
  executor?: unknown;
}

interface RawUpstreamWrapper {
  attack_technique?: unknown;
  display_name?: unknown;
  atomic_tests?: unknown;
}

function asString(v: unknown, fallback: string | null = null): string | null {
  if (typeof v === "string" && v.trim()) return v;
  return fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).toLowerCase()).filter(Boolean);
}

function asBool(v: unknown): boolean {
  return v === true || v === "true";
}

/** Normalise upstream input_arguments object → our flat array. */
function normaliseInputArgs(v: unknown): AtomicYamlInput["input_arguments"] {
  if (!v || typeof v !== "object") return [];
  const out: AtomicYamlInput["input_arguments"] = [];
  for (const [name, def] of Object.entries(v as Record<string, unknown>)) {
    if (typeof def !== "object" || !def) continue;
    const d = def as { description?: unknown; type?: unknown; default?: unknown };
    out.push({
      name,
      type: typeof d.type === "string" ? d.type : "string",
      description: typeof d.description === "string" ? d.description : "",
      default: d.default == null ? "" : String(d.default),
    });
  }
  return out;
}

function normaliseDependencies(v: unknown): AtomicYamlInput["dependencies"] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const d = x as { description?: unknown; prereq_command?: unknown; get_prereq_command?: unknown };
      return {
        description: typeof d.description === "string" ? d.description : "",
        prereq_command: typeof d.prereq_command === "string" ? d.prereq_command : "",
        get_prereq_command: typeof d.get_prereq_command === "string" ? d.get_prereq_command : "",
      };
    });
}

function normaliseExecutor(v: unknown): AtomicYamlInput["executor"] {
  if (!v || typeof v !== "object") return { ...baseAtomic.executor };
  const e = v as Record<string, unknown>;
  return {
    name: typeof e.name === "string" ? e.name : "",
    command: typeof e.command === "string" ? e.command : null,
    cleanup_command: typeof e.cleanup_command === "string" ? e.cleanup_command : null,
    elevation_required: asBool(e.elevation_required),
    steps: typeof e.steps === "string" ? e.steps : null,
  };
}

/**
 * Convert one upstream test (within a technique block) into our form shape.
 * `outerTechniqueId` and `outerDisplayName` come from the wrapping technique
 * block; bare-test YAMLs leave them blank for the user to fill in.
 */
export function mergeUpstreamTestIntoForm(
  test: RawUpstreamTest,
  outerTechniqueId: string | null,
  outerDisplayName: string | null,
): AtomicYamlInput {
  return {
    attack_technique: outerTechniqueId,
    display_name: outerDisplayName,
    name: asString(test.name),
    description: asString(test.description),
    supported_platforms: asStringArray(test.supported_platforms),
    input_arguments: normaliseInputArgs(test.input_arguments),
    dependency_executor_name: typeof test.dependency_executor_name === "string"
      ? test.dependency_executor_name : "",
    dependencies: normaliseDependencies(test.dependencies),
    executor: normaliseExecutor(test.executor),
    auto_generated_guid: asString(test.auto_generated_guid),
  };
}

export interface SplitYamlResult {
  /** True if the YAML was a technique wrapper with N atomic_tests; otherwise a bare test. */
  isWrapper: boolean;
  techniqueId: string | null;
  displayName: string | null;
  tests: Array<{ name: string; raw: RawUpstreamTest }>;
}

/**
 * Inspect a parsed YAML root and return a normalised view: the technique
 * metadata + an array of test objects ready for the form.
 */
export function splitUpstreamYaml(parsed: unknown): SplitYamlResult {
  // Wrapper form
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const w = parsed as RawUpstreamWrapper;
    if (Array.isArray(w.atomic_tests)) {
      return {
        isWrapper: true,
        techniqueId: asString(w.attack_technique),
        displayName: asString(w.display_name),
        tests: (w.atomic_tests as RawUpstreamTest[]).map((t, i) => ({
          name: typeof t.name === "string" ? t.name : `test ${i + 1}`,
          raw: t,
        })),
      };
    }
  }
  // Bare array
  if (Array.isArray(parsed)) {
    return {
      isWrapper: false,
      techniqueId: null,
      displayName: null,
      tests: (parsed as RawUpstreamTest[]).map((t, i) => ({
        name: typeof t.name === "string" ? t.name : `test ${i + 1}`,
        raw: t,
      })),
    };
  }
  // Bare object — treat as a single test
  if (parsed && typeof parsed === "object") {
    const t = parsed as RawUpstreamTest;
    return {
      isWrapper: false,
      techniqueId: null,
      displayName: null,
      tests: [{ name: typeof t.name === "string" ? t.name : "test 1", raw: t }],
    };
  }
  return { isWrapper: false, techniqueId: null, displayName: null, tests: [] };
}
