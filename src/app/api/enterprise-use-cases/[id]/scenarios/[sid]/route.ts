/**
 * PATCH  /api/enterprise-use-cases/[id]/scenarios/[sid] — edit name/description/steps
 * DELETE /api/enterprise-use-cases/[id]/scenarios/[sid] — remove
 *
 * PATCH: `source` flips to "manual-edit" on any change unless it was already
 * "manual-edit" (which is sticky). Steps are normalised to the allowed
 * framework enum.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const ALLOWED_FRAMEWORKS = new Set([
  "atomic", "purplesharp", "stratus",
  "manual", "reverse-shell", "bind-shell", "agent",
]);

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function normaliseSteps(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).map((s: any) => ({
    framework: ALLOWED_FRAMEWORKS.has(String(s?.framework)) ? String(s.framework) : "manual",
    refId: typeof s?.refId === "string" ? s.refId : undefined,
    techniqueId: typeof s?.techniqueId === "string" ? s.techniqueId : undefined,
    displayName: typeof s?.displayName === "string" ? s.displayName.slice(0, 240) : "Untitled step",
    parameters: (s?.parameters && typeof s.parameters === "object") ? s.parameters : {},
    expectedSignal: typeof s?.expectedSignal === "string" ? s.expectedSignal.slice(0, 1000) : "",
    notes: typeof s?.notes === "string" ? s.notes.slice(0, 2000) : "",
  }));
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const sc = await prisma.enterpriseUseCaseScenario.findUnique({ where: { id: sid } });
  if (!sc || sc.useCaseId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.slice(0, 240);
  if (typeof body.description === "string") data.description = body.description.slice(0, 2000);
  if ("steps" in body) data.steps = JSON.stringify(normaliseSteps(body.steps));
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields" }, { status: 400 });
  }
  // Flip source — auto → mixed; manual-edit stays sticky
  data.source = sc.source === "manual-edit" ? "manual-edit" : "mixed";

  const updated = await prisma.enterpriseUseCaseScenario.update({
    where: { id: sid },
    data: data as any,
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.scenario.update",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCaseScenario",
    targetId: sid,
    message: `${updated.name} · fields: ${Object.keys(data).filter((k) => k !== "source").join(", ")}`,
    details: { useCaseId: id, scenarioId: sid, fields: Object.keys(data), newSource: updated.source },
  });

  return NextResponse.json({
    id: updated.id, ordinal: updated.ordinal, name: updated.name, description: updated.description,
    steps: safeJson<unknown[]>(updated.steps, []),
    source: updated.source,
    updatedAt: updated.updatedAt,
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await ctx.params;
  const sc = await prisma.enterpriseUseCaseScenario.findUnique({ where: { id: sid } });
  if (!sc || sc.useCaseId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.enterpriseUseCaseScenario.delete({ where: { id: sid } });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.scenario.delete",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCaseScenario",
    targetId: sid,
    message: `removed: ${sc.name}`,
  });

  // If no scenarios remain AND status was "scenarios-defined", drop back to "mapped"
  const remaining = await prisma.enterpriseUseCaseScenario.count({ where: { useCaseId: id } });
  if (remaining === 0) {
    await prisma.enterpriseUseCase.updateMany({
      where: { id, status: "scenarios-defined" },
      data: { status: "mapped" },
    });
  }

  return NextResponse.json({ ok: true });
}
