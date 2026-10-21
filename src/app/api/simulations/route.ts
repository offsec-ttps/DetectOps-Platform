/**
 * GET /api/simulations — the simulation-category grid. Ensures the first-party
 * modules (LOTL, Phishing) exist, then returns all LIVE simulation modules as
 * category tiles for the landing grid.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { ensureSimulationModules } from "@/lib/modules/seed-simulations";
import { getLibraryByModule } from "@/lib/attack-sim/registry";
import { publishedTechniqueEntries, entryCatalogItems } from "@/lib/library-entries/store";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  await ensureSimulationModules().catch(() => {});

  const rows = await prisma.simulationModule.findMany({ where: { status: "live", enabled: true }, orderBy: { createdAt: "asc" } });
  const gangCount = await prisma.ransomwareGang.count().catch(() => 0);
  const aptGroupCount = await prisma.aptGroup.count().catch(() => 0);

  // Analyst-added entries per module (Module Builder) — counted into each library's stat.
  const entryDocs = await publishedTechniqueEntries().catch(() => []);
  const entryCount = new Map<string, number>();
  for (const e of entryDocs) entryCount.set(e.row.moduleId, (entryCount.get(e.row.moduleId) || 0) + entryCatalogItems(e.doc).length);
  const attackSimEntryCount = new Map<string, number>();
  for (const e of entryDocs) attackSimEntryCount.set(e.row.moduleId, (attackSimEntryCount.get(e.row.moduleId) || 0) + 1);

  const items = rows.map((r) => {
    const manifest = j<any>(r.manifest, {});
    const view = manifest?.contributes?.view || "";
    let stat = "";
    if (view === "ransomware-intel") stat = `${gangCount} gangs tracked`;
    else if (view === "apt-catalog") stat = `${aptGroupCount} APT groups`;
    else if (view === "attack-sim") stat = `${(getLibraryByModule(r.moduleId)?.techniques.length || 0) + (attackSimEntryCount.get(r.moduleId) || 0)} techniques`;
    else if (view === "technique-catalog" || view === "attack-catalog") {
      const techs = (manifest?.contributes?.catalog || []).reduce((n: number, g: any) => n + (g.techniques?.length || 0), 0);
      stat = `${techs + (entryCount.get(r.moduleId) || 0)} techniques`;
    } else stat = `${(manifest?.contributes?.scenarios || []).length} scenarios`;
    return { moduleId: r.moduleId, name: r.name, category: r.category, description: r.description, icon: r.icon || manifest?.icon || "", view, stat };
  });

  return NextResponse.json({ items });
}
