/**
 * POST /api/ransomware-intel/collect — run a collection now (admin/manual).
 * GET  /api/ransomware-intel/collect — recent collection runs + collector status.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { runCollection, collectorStatuses } from "@/lib/ransomware-intel/registry";
import { isIntelEnabled } from "@/lib/ransomware-intel/flags";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const runs = await prisma.intelCollectionRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  return NextResponse.json({
    enabled: isIntelEnabled(),
    collectors: collectorStatuses(),
    runs: runs.map((r) => ({ id: r.id, collector: r.collector, status: r.status, groupsNew: r.groupsNew, groupsUpdated: r.groupsUpdated, victimsNew: r.victimsNew, errors: JSON.parse(r.errors || "[]"), startedAt: r.startedAt, completedAt: r.completedAt })),
  });
}

export async function POST(_req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isIntelEnabled()) return NextResponse.json({ error: "ransomware-intel disabled" }, { status: 403 });
  const result = await runCollection();
  void logEvent({ category: "ransomware-intel" as any, action: "intel.collect", actor: auth.user.email, status: "ok", message: `collect: +${result.groupsNew} gangs, ~${result.groupsUpdated}, +${result.victimsNew} victims`, details: result });
  return NextResponse.json({ ok: true, ...result });
}
