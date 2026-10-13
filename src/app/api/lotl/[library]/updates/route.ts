/**
 * GET /api/lotl/[library]/updates — compare the stored commit SHA against the
 * upstream repo's latest to report whether a re-sync would pull new content.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/lotl/registry";
import { checkForUpdates } from "@/lib/lotl/sync";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ library: string }> }) {
  const { library } = await ctx.params;
  if (!getRegistry().get(library)) return NextResponse.json({ error: `unknown library: ${library}` }, { status: 404 });
  try {
    const res = await checkForUpdates(library);
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
