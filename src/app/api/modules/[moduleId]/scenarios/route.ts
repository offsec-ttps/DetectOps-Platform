/**
 * GET /api/modules/[moduleId]/scenarios — compiled scenarios for a module
 * (the module page renders these + lets the user run one).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getModuleScenarios } from "@/lib/modules/registry";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ moduleId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { moduleId } = await ctx.params;
  const { manifest, scenarios, errors } = await getModuleScenarios(moduleId);
  if (!manifest) return NextResponse.json({ error: errors[0] || "not found" }, { status: 404 });
  return NextResponse.json({ scenarios, errors });
}
