/**
 * GET    /api/use-cases/[id]    — full detail with steps + playbook history
 * PATCH  /api/use-cases/[id]    — update metadata + full step replace
 * DELETE /api/use-cases/[id]    — soft-archive (status="archived")
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import type { StepDraft } from "@/lib/use-cases/types";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.useCase.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { orderIndex: "asc" } },
      playbooks: { orderBy: [{ format: "asc" }, { version: "desc" }] },
      canvas: true,
    },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...row,
    mitreTechniques: safeJson<string[]>(row.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(row.mitreTactics, []),
    platforms: safeJson<string[]>(row.platforms, []),
    tags: safeJson<string[]>(row.tags, []),
    steps: row.steps.map((s) => ({
      ...s,
      parameters: safeJson<Record<string, unknown>>(s.parameters, {}),
    })),
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.useCase.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.authorId);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.slice(0, 240);
  if (typeof body.description === "string") data.description = body.description.slice(0, 4000);
  if (typeof body.framework === "string") data.framework = body.framework;
  if (typeof body.status === "string") data.status = body.status;
  if (Array.isArray(body.platforms)) data.platforms = JSON.stringify(body.platforms);
  if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);

  // Full step replace when caller supplies a `steps` array.
  let stepReplace = false;
  if (Array.isArray(body.steps)) {
    stepReplace = true;
    const steps: StepDraft[] = body.steps;
    await prisma.$transaction([
      prisma.useCaseStep.deleteMany({ where: { useCaseId: id } }),
      prisma.useCase.update({
        where: { id },
        data: {
          ...data,
          mitreTechniques: JSON.stringify(
            [...new Set(steps.map((s) => s.techniqueId).filter(Boolean))],
          ),
          steps: {
            create: steps.map((s, i) => ({
              orderIndex: typeof s.orderIndex === "number" ? s.orderIndex : i,
              kind: s.kind,
              refId: s.refId || "",
              techniqueId: s.techniqueId || "",
              displayName: s.displayName || s.techniqueId || `step ${i + 1}`,
              parameters: JSON.stringify(s.parameters ?? {}),
              expectedSignal: (s.expectedSignal || "").slice(0, 500),
              notes: (s.notes || "").slice(0, 2000),
            })),
          },
        },
      }),
    ]);
  } else if (Object.keys(data).length > 0) {
    await prisma.useCase.update({ where: { id }, data: data as any });
  }

  void logEvent({
    category: "usecase", action: "usecase.update",
    actor: auth.user.email, status: "ok",
    targetType: "usecase", targetId: id,
    message: stepReplace ? "steps replaced" : "metadata updated",
    details: { fieldsTouched: Object.keys(data), stepReplace },
  });

  const fresh = await prisma.useCase.findUnique({
    where: { id },
    include: { steps: { orderBy: { orderIndex: "asc" } } },
  });
  return NextResponse.json(fresh);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.useCase.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.authorId);
  if (!owns.ok) return owns.response;
  await prisma.useCase.update({ where: { id }, data: { status: "archived" } });
  void logEvent({
    category: "usecase", action: "usecase.archive",
    actor: auth.user.email, status: "ok",
    targetType: "usecase", targetId: id,
    message: "archived",
  });
  return NextResponse.json({ status: "archived" });
}
