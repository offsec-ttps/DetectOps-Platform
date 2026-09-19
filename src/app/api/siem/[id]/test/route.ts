/** POST /api/siem/[id]/test — probe the SIEM connection; persist status. */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSiemProvider, resolveSiemConfig } from "@/lib/siem/registry";
import { loadOwnedSiem } from "@/lib/siem/http";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedSiem(id);
  if (!r.ok) return r.response;
  const prov = getSiemProvider(r.server.kind);
  if (!prov) return NextResponse.json({ ok: false, error: "unknown SIEM kind" }, { status: 400 });

  const cfg = resolveSiemConfig(r.server);
  if (!cfg.ok) {
    await prisma.siemConnection.update({ where: { id }, data: { status: "error", lastError: cfg.reason } });
    return NextResponse.json({ ok: false, error: cfg.reason });
  }
  const result = await prov.test(cfg.cfg).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  await prisma.siemConnection.update({
    where: { id },
    data: { status: result.ok ? "online" : "error", lastError: result.ok ? "" : (result.error || "").slice(0, 500), lastTested: new Date() },
  });
  return NextResponse.json(result);
}
