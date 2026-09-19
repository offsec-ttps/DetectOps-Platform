/** GET /api/c2/[id]/agents — list the C2 beacons currently checked in. */

import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/c2/registry";
import { loadOwnedC2 } from "@/lib/c2/http";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const prov = getProvider(r.server.provider);
  if (!prov) return NextResponse.json({ error: "unknown provider" }, { status: 400 });

  try {
    const beacons = await prov.listAgents(r.server);
    return NextResponse.json({ beacons });
  } catch (e: any) {
    return NextResponse.json({ beacons: [], error: String(e?.message || e) }, { status: 502 });
  }
}
