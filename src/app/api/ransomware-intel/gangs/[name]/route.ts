/**
 * GET /api/ransomware-intel/gangs/[name] — full gang detail + recent victims.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { name } = await ctx.params;
  const gang = await prisma.ransomwareGang.findUnique({ where: { name: decodeURIComponent(name) } });
  if (!gang) return NextResponse.json({ error: "not found" }, { status: 404 });

  const victims = await prisma.ransomwareVictim.findMany({ where: { gangName: gang.name }, orderBy: { discoveredAt: "desc" }, take: 100 });

  return NextResponse.json({
    name: gang.name, aliases: j<string[]>(gang.aliases, []), status: gang.status, tier: gang.tier,
    description: gang.description, leakSiteUrls: j<string[]>(gang.leakSiteUrls, []), screenshotRef: gang.screenshotRef,
    knownTTPs: j<any[]>(gang.knownTTPs, []), iocs: j<any>(gang.iocs, { network: [], file: [], behavioral: [] }),
    signatures: j<any[]>(gang.signatures, []), targetSectors: j<string[]>(gang.targetSectors, []),
    targetRegions: j<string[]>(gang.targetRegions, []), references: j<any[]>(gang.references, []),
    victimCount: gang.victimCount, source: gang.source, enrichedAt: gang.enrichedAt,
    victims: victims.map((v) => ({ victim: v.victim, sector: v.sector, country: v.country, postUrl: v.postUrl, screenshotRef: v.screenshotRef, discoveredAt: v.discoveredAt })),
  });
}
