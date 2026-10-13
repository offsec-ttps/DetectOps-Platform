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

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  await ensureSimulationModules().catch(() => {});

  const rows = await prisma.simulationModule.findMany({ where: { status: "live", enabled: true }, orderBy: { createdAt: "asc" } });
  const gangCount = await prisma.ransomwareGang.count().catch(() => 0);
  const aptGroupCount = await prisma.aptGroup.count().catch(() => 0);

  const items = rows.map((r) => {
    const manifest = j<any>(r.manifest, {});
    const view = manifest?.contributes?.view || "";
    let stat = "";
    if (view === "ransomware-intel") stat = `${gangCount} gangs tracked`;
    else if (view === "apt-catalog") stat = `${aptGroupCount} APT groups`;
    else if (view === "attack-sim") stat = `${getLibraryByModule(r.moduleId)?.techniques.length || 0} techniques`;
    else if (view === "technique-catalog" || view === "attack-catalog") {
      const techs = (manifest?.contributes?.catalog || []).reduce((n: number, g: any) => n + (g.techniques?.length || 0), 0);
      stat = `${techs} techniques`;
    } else stat = `${(manifest?.contributes?.scenarios || []).length} scenarios`;
    return { moduleId: r.moduleId, name: r.name, category: r.category, description: r.description, icon: r.icon || manifest?.icon || "", view, stat };
  });

  return NextResponse.json({ items });
}
