/**
 * ART YAML schema constants — ported verbatim from atomicgen.io App.jsx.
 * Upstream: https://github.com/krdmnbrk/atomicgen.io (Apache-2.0).
 */

import type { AtomicYamlInput } from "@/lib/use-cases/types";

export const EXECUTOR_NAMES = [
  "powershell",
  "command_prompt",
  "bash",
  "sh",
  "manual",
] as const;

export const SUPPORTED_PLATFORMS = [
  "Windows", "Macos", "Linux",
  "Office-365", "Azure-AD", "Google-Workspace",
  "SaaS", "IaaS", "Containers",
  "IaaS:gcp", "IaaS:azure", "IaaS:aws",
].map((p) => p.toLowerCase());

export const INPUT_ARGUMENT_TYPES = ["path", "string", "url", "integer", "boolean"] as const;

export const baseAtomic: AtomicYamlInput = {
  attack_technique: null,
  display_name: null,
  name: null,
  description: null,
  supported_platforms: [],
  input_arguments: [],
  dependency_executor_name: "",
  dependencies: [],
  executor: {
    name: "",
    command: null,
    cleanup_command: null,
    elevation_required: false,
    steps: null,
  },
  auto_generated_guid: null,
};

export interface FieldError { ok: boolean; message?: string; }

export function validateAtomic(v: AtomicYamlInput): Record<string, FieldError> {
  const errs: Record<string, FieldError> = {};
  if (!v.attack_technique || !/^T\d{4}(\.\d{3})?$/i.test(v.attack_technique)) {
    errs.attack_technique = { ok: false, message: "Required (T#### or T####.###)" };
  } else { errs.attack_technique = { ok: true }; }

  errs.display_name = v.display_name ? { ok: true } : { ok: false, message: "Required" };
  errs.name = v.name ? { ok: true } : { ok: false, message: "Required" };
  errs.description = v.description ? { ok: true } : { ok: false, message: "Required" };
  errs.supported_platforms = v.supported_platforms?.length
    ? { ok: true }
    : { ok: false, message: "Pick at least one platform" };
  errs.executor_name = v.executor.name
    ? { ok: true }
    : { ok: false, message: "Required" };
  if (v.executor.name && v.executor.name !== "manual") {
    errs.executor_command = v.executor.command
      ? { ok: true }
      : { ok: false, message: "Command required" };
  } else if (v.executor.name === "manual") {
    errs.executor_steps = v.executor.steps
      ? { ok: true }
      : { ok: false, message: "Steps required for manual executor" };
  }
  return errs;
}

export function allOk(errs: Record<string, FieldError>): boolean {
  return Object.values(errs).every((e) => e.ok);
}
