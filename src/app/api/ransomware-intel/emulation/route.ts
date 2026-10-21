/**
 * GET /api/ransomware-intel/emulation — every curated ransomware emulation plan
 * with its availability against the local atomic catalogue (runnable / excluded /
 * gap step counts). Plans live in config/ransomware-emulation/plans/.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { loadPlans, summarizePlan } from "@/lib/ransomware-intel/emulation";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const plans = [...loadPlans().values()];
  const items = await Promise.all(plans.map((p) => summarizePlan(p)));
  items.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return NextResponse.json({ items });
}
