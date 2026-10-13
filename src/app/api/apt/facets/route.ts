/**
 * GET /api/apt/facets — the two browse dimensions for the APT Simulation
 * library: `country` (APT attribution origin) and `domain` (targeted sector),
 * plus actorType. Each entry carries the number of groups it covers so the UI
 * can render counts. Groups without attribution are bucketed as "Unattributed".
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const groups = await prisma.aptGroup.findMany({
    select: { originCountry: true, originCode: true, actorType: true, primarySectors: true, atomicCount: true },
  });

  const countries = new Map<string, { name: string; code: string; groups: number; atomics: number }>();
  const sectors = new Map<string, { name: string; groups: number }>();
  const actorTypes = new Map<string, number>();

  for (const g of groups) {
    const cname = g.originCountry || "Unattributed";
    const c = countries.get(cname) || { name: cname, code: g.originCode || "", groups: 0, atomics: 0 };
    c.groups++; c.atomics += g.atomicCount; countries.set(cname, c);

    actorTypes.set(g.actorType || "unknown", (actorTypes.get(g.actorType || "unknown") || 0) + 1);

    let ps: string[] = [];
    try { ps = JSON.parse(g.primarySectors || "[]"); } catch { ps = []; }
    for (const s of ps) {
      const e = sectors.get(s) || { name: s, groups: 0 };
      e.groups++; sectors.set(s, e);
    }
  }

  // Attributed countries first (by group count), Unattributed last.
  const countryList = [...countries.values()].sort((a, b) => {
    if (a.name === "Unattributed") return 1;
    if (b.name === "Unattributed") return -1;
    return b.groups - a.groups;
  });
  const sectorList = [...sectors.values()].sort((a, b) => b.groups - a.groups);
  const typeList = [...actorTypes.entries()].map(([name, groups]) => ({ name, groups })).sort((a, b) => b.groups - a.groups);

  return NextResponse.json({
    totals: { groups: groups.length, countries: countryList.filter((c) => c.name !== "Unattributed").length, sectors: sectorList.length },
    countries: countryList,
    sectors: sectorList,
    actorTypes: typeList,
  });
}
