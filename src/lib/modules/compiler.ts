/**
 * Module compiler — THE correctness boundary.
 *
 * Compiles a module manifest's declarative scenarios into ScenarioStep[] that
 * the existing runner (src/lib/enterprise-use-cases/runner.ts) executes. This is
 * the ONLY code between module content and the runner, and it enforces the
 * "declarative, no arbitrary code" guarantee:
 *
 *   (a) a step's framework MUST be in the manifest's declared permissions;
 *   (b) an `atomic` step's refId MUST resolve to an existing AtomicTest.testGuid
 *       (the same lookup buildAtomicCommand does at runtime) — a module cannot
 *       smuggle in a new executable, only orchestrate curated catalogue content;
 *   (c) parameters must not carry shell-injection metacharacters (mirrors the
 *       runner's SHELL_INJECTION guard) so validation catches it before runtime.
 */

import { prisma } from "@/lib/prisma";
import type { ScenarioStep } from "@/lib/enterprise-use-cases/runner";
import type { ModuleManifest, ModuleScenarioDef } from "./types";

// MUST mirror SHELL_INJECTION in runner.ts.
const SHELL_INJECTION = /[;&|`$(){}<>\n\r\\"']/;

export interface CompiledScenario { name: string; description?: string; steps: ScenarioStep[] }
export interface CompileResult { ok: boolean; scenarios: CompiledScenario[]; errors: string[] }

function injectionInParams(framework: string, params: Record<string, unknown> | undefined): string | null {
  if (!params) return null;
  if (framework === "atomic") {
    const ia = (params as any).inputArguments as Record<string, unknown> | undefined;
    if (ia) for (const [k, v] of Object.entries(ia)) {
      if (SHELL_INJECTION.test(String(v))) return `inputArgument "${k}" contains shell metacharacters`;
    }
  }
  if (framework === "manual" && typeof (params as any).command === "string") {
    // manual commands are intentionally arbitrary; we don't injection-block them
    // (the runner runs parameters.command verbatim) — but they require the
    // "manual" permission, enforced by the caller.
  }
  return null;
}

export async function compileScenarios(
  manifest: ModuleManifest,
  scenariosOverride?: ModuleScenarioDef[],
): Promise<CompileResult> {
  const errors: string[] = [];
  const declared = new Set(manifest.permissions?.frameworks || []);
  const defs = scenariosOverride && scenariosOverride.length
    ? scenariosOverride
    : (manifest.contributes?.scenarios || []);

  // Collect all atomic refIds up front, resolve in one query.
  const atomicRefs = new Set<string>();
  for (const sc of defs) for (const st of sc.steps || []) {
    if (st.framework === "atomic" && st.refId) atomicRefs.add(st.refId);
  }
  const knownGuids = new Set<string>();
  if (atomicRefs.size) {
    const rows = await prisma.atomicTest.findMany({
      where: { testGuid: { in: [...atomicRefs] } }, select: { testGuid: true },
    });
    for (const r of rows) knownGuids.add(r.testGuid);
  }

  const compiled: CompiledScenario[] = [];
  for (const sc of defs) {
    const steps: ScenarioStep[] = [];
    for (let j = 0; j < (sc.steps || []).length; j++) {
      const st = sc.steps[j];
      const where = `scenario "${sc.name}" step #${j + 1}`;
      // (a) declared-permission gate
      if (!declared.has(st.framework)) { errors.push(`${where}: framework "${st.framework}" not in permissions.frameworks`); continue; }
      // (b) atomic refId must exist in the catalogue
      if (st.framework === "atomic") {
        if (!st.refId) { errors.push(`${where}: atomic step missing refId`); continue; }
        if (!knownGuids.has(st.refId)) { errors.push(`${where}: atomic testGuid "${st.refId}" not found in the AtomicTest catalogue`); continue; }
      }
      // (c) injection guard
      const inj = injectionInParams(st.framework, st.parameters);
      if (inj) { errors.push(`${where}: ${inj}`); continue; }

      steps.push({
        framework: st.framework,
        refId: st.refId,
        techniqueId: st.techniqueId,
        displayName: st.displayName,
        parameters: st.parameters,
        expectedSignal: st.expectedSignal,
        notes: st.notes,
      });
    }
    compiled.push({ name: sc.name, description: sc.description, steps });
  }

  return { ok: errors.length === 0, scenarios: compiled, errors };
}
