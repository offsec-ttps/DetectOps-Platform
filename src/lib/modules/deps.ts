/**
 * Module dependency resolution (semver). Walks manifest.dependencies, finds the
 * best live module satisfying each range, detects missing deps + cycles.
 */

import { prisma } from "@/lib/prisma";
import { satisfies } from "./semver";
import type { ModuleManifest } from "./types";

export interface DepResolution {
  ok: boolean;
  resolved: Array<{ name: string; range: string; version: string }>;
  missing: Array<{ name: string; range: string; reason: string }>;
  cycle: string[] | null;
}

export async function resolveDependencies(manifest: ModuleManifest): Promise<DepResolution> {
  const resolved: DepResolution["resolved"] = [];
  const missing: DepResolution["missing"] = [];
  const visiting = new Set<string>();
  let cycle: string[] | null = null;

  async function walk(modId: string, deps: ModuleManifest["dependencies"], path: string[]): Promise<void> {
    for (const dep of deps || []) {
      if (path.includes(dep.name)) { cycle = [...path, dep.name]; continue; }
      const row = await prisma.simulationModule.findUnique({ where: { moduleId: dep.name } });
      if (!row || row.status !== "live") { missing.push({ name: dep.name, range: dep.version, reason: row ? `status ${row.status}` : "not installed" }); continue; }
      if (!satisfies(row.version, dep.version)) { missing.push({ name: dep.name, range: dep.version, reason: `installed ${row.version} does not satisfy` }); continue; }
      if (!resolved.find((r) => r.name === dep.name)) resolved.push({ name: dep.name, range: dep.version, version: row.version });
      // Recurse into the dependency's own deps.
      try {
        const depManifest = JSON.parse(row.manifest) as ModuleManifest;
        if (!visiting.has(dep.name)) { visiting.add(dep.name); await walk(dep.name, depManifest.dependencies, [...path, dep.name]); }
      } catch { /* ignore unparseable dep manifest */ }
    }
  }

  await walk(manifest.id, manifest.dependencies, [manifest.id]);
  return { ok: missing.length === 0 && !cycle, resolved, missing, cycle };
}
