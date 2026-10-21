/**
 * POST /api/community/mitre-car/sync — pull all CAR analytics from upstream.
 * GET — return last sync info from CommunitySource row.
 */

import { NextResponse } from "next/server";
import { isSourceEnabled } from "@/lib/community-sources/flags";
import { mitreCarAdapter } from "@/lib/community-sources/adapters/mitre-car";
import { requireRole } from "@/lib/auth-guard";

export const maxDuration = 300;

export async function POST() {
  // Internet-fetching / bulk-rewriting maintenance op: admin only (dev: open).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  if (!isSourceEnabled("mitreCar")) {
    return NextResponse.json(
      { error: "MITRE CAR source is disabled. Set ENABLE_MITRE_CAR_SOURCE=true." },
      { status: 403 },
    );
  }
  try {
    const result = await mitreCarAdapter.sync();
    return NextResponse.json({ status: "completed", ...result });
  } catch (err: any) {
    return NextResponse.json({ status: "failed", error: err.message }, { status: 500 });
  }
}

export async function GET() {
  if (!isSourceEnabled("mitreCar")) {
    return NextResponse.json({ enabled: false });
  }
  const { prisma } = await import("@/lib/prisma");
  const source = await prisma.communitySource.findUnique({
    where: { name: "MITRE CAR" },
  });
  return NextResponse.json({
    enabled: true,
    registered: !!source,
    totalRules: source?.totalRules ?? 0,
    lastSyncAt: source?.lastSyncAt?.toISOString() ?? null,
  });
}
