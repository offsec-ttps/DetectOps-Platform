/**
 * PATCH /api/enterprise-use-cases/[id]/status
 *
 * Manual lifecycle walk for the use case status:
 *   imported → mapped → scenarios-defined → validated → promoted | retired
 *
 * Body: { status: <one of the values above> }
 *
 * Guard rails:
 *   - `validated` and `promoted` cannot be set without at least one matched
 *     non-stub simulate-and-validate run. Pass `force=true` to override.
 *   - Any state can transition to `retired`.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const VALID_STATES = ["imported", "mapped", "scenarios-defined", "validated", "promoted", "retired"] as const;
type State = typeof VALID_STATES[number];

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const next = String(body.status || "") as State;
  const force = body.force === true;

  if (!VALID_STATES.includes(next)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATES.join("|")}` }, { status: 400 });
  }

  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Gate "validated"/"promoted" on a matched non-stub run
  if ((next === "validated" || next === "promoted") && !force) {
    const runs = await prisma.enterpriseUseCaseRun.findMany({
      where: { useCaseId: id, mode: "simulate-and-validate", validationOutcome: "matched" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const anyNonStub = runs.some((r) => {
      const steps = safeJson<Array<{ status: string }>>(r.stepResults, []);
      return steps.length > 0 && !steps.every((s) => s.status === "stubbed");
    });
    if (!anyNonStub) {
      return NextResponse.json({
        error: `cannot set status="${next}" without a matched non-stub simulate-and-validate run; pass force=true to override`,
      }, { status: 409 });
    }
  }

  await prisma.enterpriseUseCase.update({ where: { id }, data: { status: next } });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.status",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `${uc.status} → ${next}${force ? " (force)" : ""}`,
    details: { previous: uc.status, next, force },
  });

  return NextResponse.json({ id, previous: uc.status, status: next });
}
