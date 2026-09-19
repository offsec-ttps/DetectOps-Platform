/** GET /api/ransomware-intel/v1/victims?gang=&limit= — public victim feed (key-gated). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

export async function GET(req: NextRequest) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const gang = sp.get("gang") || undefined;
  const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100));
  const rows = await prisma.ransomwareVictim.findMany({ where: gang ? { gangName: gang } : {}, orderBy: { discoveredAt: "desc" }, take: limit });
  return NextResponse.json({ count: rows.length, victims: rows.map((v) => ({ gang: v.gangName, victim: v.victim, sector: v.sector, country: v.country, postUrl: v.postUrl, discoveredAt: v.discoveredAt })) }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
