/**
 * GET /api/ransomware-intel/v1/groups/[name] — public gang detail (key-gated).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const { name } = await ctx.params;
  const g = await prisma.ransomwareGang.findUnique({ where: { name: decodeURIComponent(name) } });
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  const victims = await prisma.ransomwareVictim.findMany({ where: { gangName: g.name }, orderBy: { discoveredAt: "desc" }, take: 50 });
  return NextResponse.json({
    name: g.name, aliases: j<string[]>(g.aliases, []), status: g.status, description: g.description,
    leakSiteUrls: j<string[]>(g.leakSiteUrls, []), techniques: j<any[]>(g.knownTTPs, []),
    iocs: j<any>(g.iocs, {}), signatures: j<any[]>(g.signatures, []), sectors: j<string[]>(g.targetSectors, []),
    references: j<any[]>(g.references, []), victimCount: g.victimCount,
    recentVictims: victims.map((v) => ({ victim: v.victim, sector: v.sector, country: v.country, discoveredAt: v.discoveredAt })),
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
