/**
 * POST /api/modules/[moduleId]/install — install (enable) a module for use,
 * resolving its declared dependencies first. In this single-workspace model,
 * modules are global; "install" verifies deps are live and enables the module.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { resolveDependencies } from "@/lib/modules/deps";
import type { ModuleManifest } from "@/lib/modules/types";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const row = await prisma.simulationModule.findUnique({ where: { moduleId } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.status !== "live") return NextResponse.json({ error: `module is ${row.status}; only live modules can be installed` }, { status: 409 });

  let manifest: ModuleManifest;
  try { manifest = JSON.parse(row.manifest); } catch { return NextResponse.json({ error: "manifest unparseable" }, { status: 500 }); }

  const dep = await resolveDependencies(manifest);
  if (!dep.ok) {
    return NextResponse.json({ error: "unresolved dependencies", cycle: dep.cycle, missing: dep.missing }, { status: 409 });
  }

  await prisma.simulationModule.update({ where: { moduleId }, data: { enabled: true, installedAt: new Date() } });
  void logEvent({ category: "module" as any, action: "module.install", actor: auth.user.email, status: "ok", targetType: "SimulationModule", targetId: row.id, message: `${moduleId} installed (deps: ${dep.resolved.length})` });
  return NextResponse.json({ ok: true, enabled: true, dependencies: dep.resolved });
}
