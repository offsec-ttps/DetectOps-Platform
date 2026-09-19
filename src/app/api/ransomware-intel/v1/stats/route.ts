/** GET /api/ransomware-intel/v1/stats — aggregate stats (key-gated). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

export async function GET(req: NextRequest) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const [gangs, victims, active] = await Promise.all([
    prisma.ransomwareGang.count(),
    prisma.ransomwareVictim.count(),
    prisma.ransomwareGang.count({ where: { status: "active" } }),
  ]);
  const top = await prisma.ransomwareGang.findMany({ orderBy: { victimCount: "desc" }, take: 10, select: { name: true, victimCount: true } });
  return NextResponse.json({ gangs, activeGangs: active, victims, topByVictims: top }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
