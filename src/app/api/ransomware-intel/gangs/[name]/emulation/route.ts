/**
 * GET /api/ransomware-intel/gangs/[name]/emulation — the gang's curated
 * emulation plan with every chain step resolved against the local atomic
 * catalogue (runnable / excluded / missing). 404 when no plan exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getPlan, resolvePlan, summarizePlan } from "@/lib/ransomware-intel/emulation";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { name } = await ctx.params;
  const plan = getPlan(decodeURIComponent(name));
  if (!plan) return NextResponse.json({ error: "no emulation plan for this gang" }, { status: 404 });
  const [steps, summary] = await Promise.all([resolvePlan(plan), summarizePlan(plan)]);
  const { chain: _chain, ...meta } = plan;
  // plan.summary (prose profile) is returned as summaryText; summary = counts.
  return NextResponse.json({ ...meta, summaryText: plan.summary || "", summary, steps });
}
