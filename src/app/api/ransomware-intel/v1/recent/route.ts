/** GET /api/ransomware-intel/v1/recent?limit= — most recent victim posts across all gangs (key-gated). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

export async function GET(req: NextRequest) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const rows = await prisma.ransomwareVictim.findMany({ orderBy: { discoveredAt: "desc" }, take: limit });
  return NextResponse.json({ count: rows.length, recent: rows.map((v) => ({ gang: v.gangName, victim: v.victim, sector: v.sector, country: v.country, discoveredAt: v.discoveredAt })) }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
