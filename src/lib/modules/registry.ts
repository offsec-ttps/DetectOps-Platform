/**
 * Module Registry — single discovery point for installed simulation modules.
 * Mirrors src/lib/community-sources/registry.ts: load from DB, flag-gated,
 * expose a status snapshot + nav contributions + compiled scenarios.
 */

import { prisma } from "@/lib/prisma";
import { isModuleFeatureEnabled } from "./flags";
import { compileScenarios, type CompiledScenario } from "./compiler";
import type { ModuleManifest } from "./types";

function safeManifest(s: string): ModuleManifest | null {
  try { return JSON.parse(s) as ModuleManifest; } catch { return null; }
}

export interface ModuleSummary {
  id: string;            // row id
  moduleId: string;      // publisher.name
  name: string;
  version: string;
  category: string;
  description: string;
  author: string;
  icon: string;
  status: string;
  signatureState: string;
  enabled: boolean;
  ownerId: string;
  createdAt: string;
}

/** Live (installed + approved + live + enabled) modules, gated by the master flag. */
export async function getModules(opts?: { includeNonLive?: boolean; ownerId?: string }): Promise<ModuleSummary[]> {
  if (!isModuleFeatureEnabled("marketplace")) return [];
  const where: any = {};
  if (!opts?.includeNonLive) { where.status = "live"; where.enabled = true; }
  if (opts?.ownerId) where.ownerId = opts.ownerId;
  const rows = await prisma.simulationModule.findMany({ where, orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({
    id: r.id, moduleId: r.moduleId, name: r.name, version: r.version, category: r.category,
    description: r.description, author: r.author, icon: r.icon, status: r.status,
    signatureState: r.signatureState, enabled: r.enabled, ownerId: r.ownerId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getModule(moduleId: string) {
  return prisma.simulationModule.findUnique({ where: { moduleId } });
}

export interface ModuleNavEntry { moduleId: string; label: string; href: string; icon?: string; badge?: string }

/** Flatten every live module's contributes.nav into sidebar entries. */
export async function getModuleNav(): Promise<ModuleNavEntry[]> {
  const mods = await getModules();
  const out: ModuleNavEntry[] = [];
  for (const m of mods) {
    const row = await prisma.simulationModule.findUnique({ where: { moduleId: m.moduleId }, select: { manifest: true } });
    const manifest = row ? safeManifest(row.manifest) : null;
    const navs = manifest?.contributes?.nav;
    if (navs && navs.length) {
      for (const n of navs) {
        out.push({ moduleId: m.moduleId, label: n.label, href: `/modules/${m.moduleId}${n.sub ? `/${n.sub}` : ""}`, icon: n.icon, badge: n.badge });
      }
    } else {
      // Default: one entry per module.
      out.push({ moduleId: m.moduleId, label: m.name, href: `/modules/${m.moduleId}`, icon: m.icon || undefined });
    }
  }
  return out;
}

/** Compile a live module's scenarios (for the catch-all module page + run). */
export async function getModuleScenarios(moduleId: string): Promise<{ manifest: ModuleManifest | null; scenarios: CompiledScenario[]; errors: string[] }> {
  const row = await prisma.simulationModule.findUnique({ where: { moduleId } });
  if (!row) return { manifest: null, scenarios: [], errors: ["module not found"] };
  const manifest = safeManifest(row.manifest);
  if (!manifest) return { manifest: null, scenarios: [], errors: ["manifest unparseable"] };
  const c = await compileScenarios(manifest);
  return { manifest, scenarios: c.scenarios, errors: c.errors };
}

/** Status snapshot for the marketplace UI. */
export async function getRegistryStatus() {
  const all = await prisma.simulationModule.findMany({ orderBy: { updatedAt: "desc" } });
  return {
    marketplaceEnabled: isModuleFeatureEnabled("marketplace"),
    autoApprove: isModuleFeatureEnabled("autoApprove"),
    signingRequired: isModuleFeatureEnabled("signing"),
    counts: {
      total: all.length,
      live: all.filter((m) => m.status === "live").length,
      pending: all.filter((m) => ["submitted", "validating", "approved"].includes(m.status)).length,
      rejected: all.filter((m) => m.status === "rejected").length,
    },
  };
}
