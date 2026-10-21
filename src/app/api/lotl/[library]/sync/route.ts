/**
 * POST /api/lotl/[library]/sync — ingest/refresh a LOTL library from its
 * upstream repo. Guards against concurrent runs. Requires a session, since the
 * ingested rows carry executable commands later run on lab hosts.
 * GET returns the current sync-meta row for the library.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { getRegistry } from "@/lib/lotl/registry";
import { syncLotl } from "@/lib/lotl/sync";

export const maxDuration = 300;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ library: string }> }) {
  // Rewrites a shared LOTL library from upstream — maintenance op, admin only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { library } = await ctx.params;
  if (!getRegistry().get(library)) return NextResponse.json({ error: `unknown library: ${library}` }, { status: 404 });

  const existing = await prisma.lotlSyncMeta.findUnique({ where: { library } });
  if (existing?.status === "running") {
    return NextResponse.json({ error: "a sync is already running for this library" }, { status: 409 });
  }

  try {
    const result = await syncLotl(library);
    void logEvent({
      category: "usecase", action: "lotl.sync", actor: auth.user.email, status: "ok",
      targetType: "LotlTechnique", targetId: library,
      message: `${library} synced: +${result.newCount} ~${result.updatedCount} -${result.removedCount} (${result.totalTests} total)`,
      details: { ...result },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ library: string }> }) {
  const { library } = await ctx.params;
  const meta = await prisma.lotlSyncMeta.findUnique({ where: { library } });
  return NextResponse.json({ library, meta });
}
