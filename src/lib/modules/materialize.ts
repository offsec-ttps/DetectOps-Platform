/**
 * Bridge a module scenario into the EXISTING runner without changing it.
 *
 * The runner (runScenario) reads steps from an EnterpriseUseCaseScenario row, so
 * "running a module" = compile its scenario to ScenarioStep[], persist a backing
 * EnterpriseUseCase + scenario tagged `module:<moduleId>`, then call the unchanged
 * runScenario({useCaseId, scenarioId, environmentId, mode}).
 *
 * Defense in depth: re-assert the declared-permission gate here so even a tampered
 * DB manifest can't emit a framework the module never declared.
 */

import { prisma } from "@/lib/prisma";
import { compileScenarios } from "./compiler";
import type { ModuleManifest } from "./types";
import type { ScenarioStep } from "@/lib/enterprise-use-cases/runner";

/**
 * Ad-hoc materialize: persist a backing EnterpriseUseCase + scenario from a
 * caller-built ScenarioStep[] (e.g. a ransomware-gang simulation), so it runs
 * through the unchanged runScenario. Steps are assumed pre-validated (atomic
 * refIds resolved via inferSimulations against the AtomicTest catalogue).
 */
export async function materializeAdhoc(opts: {
  label: string; description?: string; steps: ScenarioStep[];
  mitreTechniques?: string[]; ownerId: string; sourceRef: string;
}): Promise<{ useCaseId: string; scenarioId: string }> {
  const uc = await prisma.enterpriseUseCase.create({
    data: {
      name: opts.label, description: opts.description || "", severity: "high", platforms: "[]",
      status: "scenarios-defined", mitreTechniques: JSON.stringify(opts.mitreTechniques || []),
      sourceRowRef: opts.sourceRef, owner: opts.ownerId, uploadedBy: opts.ownerId,
    },
  });
  const scenario = await prisma.enterpriseUseCaseScenario.create({
    data: { useCaseId: uc.id, ordinal: 0, name: opts.label, description: opts.description || "", steps: JSON.stringify(opts.steps), source: "auto" },
  });
  return { useCaseId: uc.id, scenarioId: scenario.id };
}

export type MaterializeResult = { ok: true; useCaseId: string; scenarioId: string } | { ok: false; error: string };

export async function materializeScenario(opts: {
  moduleId: string;
  scenarioName: string;
  ownerId: string;
}): Promise<MaterializeResult> {
  const row = await prisma.simulationModule.findUnique({ where: { moduleId: opts.moduleId } });
  if (!row) return { ok: false, error: "module not found" };
  let manifest: ModuleManifest;
  try { manifest = JSON.parse(row.manifest) as ModuleManifest; } catch { return { ok: false, error: "manifest unparseable" }; }

  const compiled = await compileScenarios(manifest);
  if (!compiled.ok) return { ok: false, error: `compile failed: ${compiled.errors[0] || "unknown"}` };
  const sc = compiled.scenarios.find((s) => s.name === opts.scenarioName);
  if (!sc) return { ok: false, error: `scenario "${opts.scenarioName}" not found in module` };

  // Defense in depth — declared permission re-check.
  const declared = new Set(manifest.permissions?.frameworks || []);
  const offending = sc.steps.find((s) => !declared.has(s.framework as any));
  if (offending) return { ok: false, error: `step framework "${offending.framework}" exceeds declared permissions` };

  const uc = await prisma.enterpriseUseCase.create({
    data: {
      name: `${manifest.name} · ${sc.name}`,
      description: sc.description || manifest.description || "",
      severity: "medium",
      platforms: "[]",
      status: "scenarios-defined",
      mitreTechniques: JSON.stringify([...new Set(sc.steps.map((s) => s.techniqueId).filter(Boolean))]),
      sourceRowRef: `module:${opts.moduleId}`,
      owner: opts.ownerId,
      uploadedBy: opts.ownerId,
    },
  });
  const scenario = await prisma.enterpriseUseCaseScenario.create({
    data: {
      useCaseId: uc.id,
      ordinal: 0,
      name: sc.name,
      description: sc.description || "",
      steps: JSON.stringify(sc.steps),
      source: "auto",
    },
  });

  return { ok: true, useCaseId: uc.id, scenarioId: scenario.id };
}
