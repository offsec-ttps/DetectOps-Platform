/**
 * GET  /api/enterprise-use-cases/[id]/scenarios — list all scenarios
 * POST /api/enterprise-use-cases/[id]/scenarios — create a custom scenario
 *
 * Body for POST: { name, description?, steps: Step[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { id: true } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows = await prisma.enterpriseUseCaseScenario.findMany({
    where: { useCaseId: id },
    orderBy: { ordinal: "asc" },
  });
  return NextResponse.json({
    items: rows.map((s) => ({
      id: s.id,
      ordinal: s.ordinal,
      name: s.name,
      description: s.description,
      steps: safeJson<unknown[]>(s.steps, []),
      source: s.source,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));

  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!uc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const description = String(body.description || "").trim();
  const steps = normaliseSteps(body.steps);

  // Pick the next ordinal
  const last = await prisma.enterpriseUseCaseScenario.findFirst({
    where: { useCaseId: id }, orderBy: { ordinal: "desc" }, select: { ordinal: true },
  });
  const ordinal = (last?.ordinal ?? 0) + 1;

  const row = await prisma.enterpriseUseCaseScenario.create({
    data: {
      useCaseId: id,
      ordinal,
      name: name.slice(0, 240),
      description: description.slice(0, 2000),
      steps: JSON.stringify(steps),
      source: "manual-edit",
    },
  });

  // Lifecycle: scenarios-defined
  if (uc.status === "imported" || uc.status === "mapped") {
    await prisma.enterpriseUseCase.update({
      where: { id }, data: { status: "scenarios-defined" },
    });
  }

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.scenario.create",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCaseScenario",
    targetId: row.id,
    message: `${name} · ${steps.length} step(s)`,
    details: { useCaseId: id, scenarioId: row.id, ordinal, stepCount: steps.length },
  });

  return NextResponse.json({
    id: row.id, ordinal: row.ordinal, name: row.name, description: row.description,
    steps, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt,
  });
}
