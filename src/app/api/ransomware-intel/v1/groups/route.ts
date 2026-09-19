/**
 * GET /api/ransomware-intel/v1/groups — public, API-key-gated gang list.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireIntelApiKey } from "@/lib/ransomware-intel/api-keys";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET(req: NextRequest) {
  const auth = await requireIntelApiKey(req);
  if (!auth.ok) return auth.response;
  const rows = await prisma.ransomwareGang.findMany({ orderBy: [{ victimCount: "desc" }, { name: "asc" }], take: 1000 });
  return NextResponse.json({
    count: rows.length,
    groups: rows.map((r) => ({
      name: r.name, aliases: j<string[]>(r.aliases, []), status: r.status,
      techniques: j<any[]>(r.knownTTPs, []).map((t: any) => t.id), sectors: j<string[]>(r.targetSectors, []),
      victimCount: r.victimCount, source: r.source,
    })),
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
