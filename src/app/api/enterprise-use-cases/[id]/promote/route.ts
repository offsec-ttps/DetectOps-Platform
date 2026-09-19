/**
 * POST /api/enterprise-use-cases/[id]/promote
 *
 * Promote a validated Enterprise Use Case into a Detection Pack row.
 * See src/lib/enterprise-use-cases/promote.ts for the gating + persistence
 * details.
 *
 * Body: { force?: boolean }
 *
 * Returns: { detectionPackId, slug, ruleCount, simulationCount, reusedExisting }
 *
 * Errors:
 *   400 — empty detection logic body
 *   404 — use case not found
 *   409 — not validated (no matched non-stub run; pass force=true to override)
 *   500 — persist failure
 */

import { NextRequest, NextResponse } from "next/server";
import { promoteUseCase } from "@/lib/enterprise-use-cases/promote";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const force = body.force === true;
  const sessionUser = await getSessionUser().catch(() => null);

  try {
    const result = await promoteUseCase(id, {
      force,
      actor: sessionUser?.email || "anonymous",
    });
    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.promote",
      actor: sessionUser?.email || "anonymous",
      status: "ok",
      targetType: "EnterpriseUseCase",
      targetId: id,
      message: `${result.reusedExisting ? "reused" : "created"} DetectionPack ${result.slug} · rules=${result.ruleCount} · sims=${result.simulationCount}${force ? " · force=true" : ""}`,
      details: { detectionPackId: result.detectionPackId, slug: result.slug, force, ...result },
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const code = err?.code as string | undefined;
    const status = code === "not_found" ? 404
                 : code === "not_validated" ? 409
                 : code === "empty_logic" ? 400
                 : 500;
    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.promote",
      actor: sessionUser?.email || "anonymous",
      status: "error",
      targetType: "EnterpriseUseCase",
      targetId: id,
      message: err?.message || String(err),
      details: { code, error: String(err?.message || err) },
    });
    return NextResponse.json({ error: err?.message || String(err), code }, { status });
  }
}
