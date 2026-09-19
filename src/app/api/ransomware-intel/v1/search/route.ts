/** GET /api/ransomware-intel/v1/search?q= — search gangs + victims (key-gated). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

export async function GET(req: NextRequest) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
  const ql = q.toLowerCase();
  const [gangs, victims] = await Promise.all([
    prisma.ransomwareGang.findMany({ take: 500 }),
    prisma.ransomwareVictim.findMany({ where: { victim: { contains: q } }, orderBy: { discoveredAt: "desc" }, take: 50 }),
  ]);
  return NextResponse.json({
    gangs: gangs.filter((g) => g.name.toLowerCase().includes(ql) || g.aliases.toLowerCase().includes(ql)).map((g) => ({ name: g.name, status: g.status, victimCount: g.victimCount })),
    victims: victims.map((v) => ({ gang: v.gangName, victim: v.victim, discoveredAt: v.discoveredAt })),
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
