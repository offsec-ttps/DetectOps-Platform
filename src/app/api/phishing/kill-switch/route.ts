/**
 * POST /api/phishing/kill-switch — global emergency stop. Aborts every campaign
 * that is running/approved/pending, immediately. Audited.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const res = await prisma.phishingCampaign.updateMany({
    where: { status: { in: ["running", "approved", "pending_approval"] } },
    data: { status: "aborted", completedAt: new Date() },
  });
  void logEvent({ category: "phishing" as any, action: "phishing.kill-switch", actor: auth.user.email, status: "warn", message: `KILL-SWITCH: ${res.count} campaign(s) aborted` });
  return NextResponse.json({ ok: true, aborted: res.count });
}
