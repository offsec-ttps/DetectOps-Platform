/**
 * POST /api/ransomware-intel/gangs/[name]/enrich — AI-derive TTPs/IOCs/signatures.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { enrichGang } from "@/lib/ransomware-intel/enrich";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { name } = await ctx.params;
  const r = await enrichGang(decodeURIComponent(name));
  void logEvent({ category: "ransomware-intel" as any, action: "intel.gang.enrich", actor: auth.user.email, status: r.ok ? "ok" : "warn", targetType: "RansomwareGang", targetId: name, message: `enrich ${name}: ${r.ok ? "ok" : r.error}` });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
