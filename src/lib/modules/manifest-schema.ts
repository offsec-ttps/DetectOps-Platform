/**
 * Hand-written manifest validator (no ajv dep in this repo). Pure + client-safe
 * so the builder playground can call it for live feedback. Structural + semantic
 * checks only; catalogue/permission/dry-run checks live in the compiler + the
 * validation pipeline.
 */

import {
  MODULE_FRAMEWORKS, MODULE_CATEGORIES, type ModuleManifest, type ModulePackage,
} from "./types";
import { isValid as isValidSemver } from "./semver";
import { isBuiltinModuleView } from "./views";

const ID_RE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ModuleManifest;
}

function isObj(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function validateManifest(input: unknown): ManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Accept either a bare manifest or a {manifest, scenarios} package.
  const m: any = isObj(input) && isObj((input as any).manifest) ? (input as any).manifest : input;

  if (!isObj(m)) return { ok: false, errors: ["manifest must be a JSON object"], warnings };

  if (typeof m.id !== "string" || !ID_RE.test(m.id)) errors.push("id must match publisher.name (e.g. acme.ransomware-sim)");
  if (typeof m.name !== "string" || !m.name.trim()) errors.push("name is required");
  if (typeof m.version !== "string" || !isValidSemver(m.version)) errors.push("version must be valid semver (e.g. 1.0.0)");
  if (typeof m.category !== "string" || !MODULE_CATEGORIES.includes(m.category)) errors.push(`category must be one of: ${MODULE_CATEGORIES.join(", ")}`);
  if (typeof m.description !== "string" || !m.description.trim()) warnings.push("description is recommended for the marketplace listing");
  if (typeof m.author !== "string" || !m.author.trim()) errors.push("author is required");
  if (typeof m.compatibleCoreVersion !== "string" || !m.compatibleCoreVersion.trim()) errors.push("compatibleCoreVersion is required (e.g. ^1.0.0)");

  // permissions
  const perms = m.permissions;
  if (!isObj(perms) || !Array.isArray(perms.frameworks)) {
    errors.push("permissions.frameworks[] is required");
  } else {
    for (const f of perms.frameworks) {
      if (!MODULE_FRAMEWORKS.includes(f)) errors.push(`permissions.frameworks: unknown framework "${f}"`);
    }
    if (perms.integrations && !Array.isArray(perms.integrations)) errors.push("permissions.integrations must be an array");
    if (perms.dataScopes && !Array.isArray(perms.dataScopes)) errors.push("permissions.dataScopes must be an array");
  }

  // dependencies
  if (m.dependencies !== undefined) {
    if (!Array.isArray(m.dependencies)) errors.push("dependencies must be an array");
    else for (const d of m.dependencies) {
      if (!isObj(d) || typeof d.name !== "string" || typeof d.version !== "string") errors.push("each dependency needs {name, version}");
    }
  }

  // contributes.view (optional built-in rich view)
  if (m.contributes && typeof m.contributes === "object" && m.contributes.view !== undefined) {
    if (typeof m.contributes.view !== "string" || !isBuiltinModuleView(m.contributes.view)) {
      warnings.push(`contributes.view "${m.contributes.view}" is not a known built-in view — the default scenario list will render`);
    }
  }

  // contributes.scenarios
  const contributes = m.contributes;
  if (!isObj(contributes) || !Array.isArray(contributes.scenarios)) {
    errors.push("contributes.scenarios[] is required");
  } else if (contributes.scenarios.length === 0) {
    warnings.push("module has no scenarios — it will install but do nothing");
  } else {
    contributes.scenarios.forEach((sc: any, i: number) => {
      if (!isObj(sc) || typeof sc.name !== "string" || !sc.name.trim()) errors.push(`scenario #${i + 1}: name is required`);
      if (!Array.isArray(sc.steps) || sc.steps.length === 0) { errors.push(`scenario "${sc?.name ?? i + 1}": at least one step is required`); return; }
      sc.steps.forEach((st: any, j: number) => {
        const where = `scenario "${sc.name}" step #${j + 1}`;
        if (!isObj(st)) { errors.push(`${where}: must be an object`); return; }
        if (!MODULE_FRAMEWORKS.includes(st.framework)) errors.push(`${where}: framework must be one of ${MODULE_FRAMEWORKS.join("|")}`);
        if (typeof st.displayName !== "string" || !st.displayName.trim()) errors.push(`${where}: displayName is required`);
        if (st.framework === "atomic" && (typeof st.refId !== "string" || !st.refId.trim())) errors.push(`${where}: atomic steps need refId (an AtomicTest testGuid)`);
        // Declared-permission check: every emitted framework must be declared.
        if (Array.isArray(perms?.frameworks) && !perms.frameworks.includes(st.framework)) {
          errors.push(`${where}: framework "${st.framework}" is not in permissions.frameworks`);
        }
      });
    });
  }

  return { ok: errors.length === 0, errors, warnings, manifest: errors.length === 0 ? (m as ModuleManifest) : undefined };
}

/** Normalize input into a ModulePackage (manifest + scenarios), trusting validateManifest ran. */
export function toPackage(input: unknown): ModulePackage {
  const m: any = isObj(input) && isObj((input as any).manifest) ? (input as any) : { manifest: input };
  return { manifest: m.manifest as ModuleManifest, scenarios: Array.isArray(m.scenarios) ? m.scenarios : undefined };
}
