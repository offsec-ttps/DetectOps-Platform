/**
 * POST /api/enterprise-use-cases/[id]/runs  — execute a scenario against an env (synchronous, ≤ ENTERPRISE_UC_RUN_TIMEOUT_MS)
 * GET  /api/enterprise-use-cases/[id]/runs  — history with optional filters
 *
 * POST body:
 *   {
 *     scenarioId:   string         // required
 *     environmentId: string        // required
 *     mode:          "simulate-only" | "simulate-and-validate"
 *     testedLogicChoice?: "original" | "recommended" | "edited"
 *     confirmDestructive?: boolean // required when env.kind ∈ {user-cloud, shell} AND mode=simulate-and-validate
 *   }
 *
 * Errors:
 *   400 — bad body / wrong env state / missing confirm gate
 *   404 — useCase / scenario / env not found
 *   500 — runner threw
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runScenario } from "@/lib/enterprise-use-cases/runner";
import { getSessionUser } from "@/lib/auth";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

async function assertUseCaseOwner(id: string, auth: { user: { id: string; role: string }; enforced: boolean }) {
  const { prisma } = await import("@/lib/prisma");
  const uc = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { uploadedBy: true } });
  if (!uc) return { ok: false as const, response: NextResponse.json({ error: "use case not found" }, { status: 404 }) };
  const owns = ownsOr404({ user: auth.user as any, enforced: auth.enforced }, uc.uploadedBy);
  return owns.ok ? { ok: true as const } : owns;
}

// The run executes against (and decrypts the credentials of) the supplied
// environment, so the caller must own that environment too — otherwise a user
// could detonate destructive attacks using another tenant's cloud credentials.
async function assertEnvOwner(environmentId: string, auth: { user: { id: string; role: string }; enforced: boolean }) {
  const { prisma } = await import("@/lib/prisma");
  const env = await prisma.environmentTarget.findUnique({ where: { id: environmentId }, select: { ownerId: true } });
  if (!env) return { ok: false as const, response: NextResponse.json({ error: "environment not found" }, { status: 404 }) };
  const owns = ownsOr404({ user: auth.user as any, enforced: auth.enforced }, env.ownerId);
  return owns.ok ? { ok: true as const } : owns;
}

const MODES = new Set(["simulate-only", "simulate-and-validate"]);
const CHOICES = new Set(["original", "recommended", "edited"]);

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const owns = await assertUseCaseOwner(id, auth);
  if (!owns.ok) return owns.response;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || "50", 10)));
  const status = sp.get("status") || "";
  const environmentId = sp.get("environmentId") || "";

  const where: Record<string, unknown> = { useCaseId: id };
  if (status) where.status = status;
  if (environmentId) where.environmentId = environmentId;

  const rows = await prisma.enterpriseUseCaseRun.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Lookup env names so the UI doesn't have to chase them
  const envIds = [...new Set(rows.map((r) => r.environmentId).filter(Boolean) as string[])];
  const envs = envIds.length
    ? await prisma.environmentTarget.findMany({ where: { id: { in: envIds } }, select: { id: true, name: true, kind: true } })
    : [];
  const envMap = new Map(envs.map((e) => [e.id, e]));

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      scenarioId: r.scenarioId,
      environmentId: r.environmentId,
      environmentName: r.environmentId ? envMap.get(r.environmentId)?.name || null : null,
      environmentKind: r.environmentId ? envMap.get(r.environmentId)?.kind || null : null,
      testedLogicChoice: r.testedLogicChoice,
      mode: r.mode,
      status: r.status,
      validationOutcome: r.validationOutcome,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      exitCode: r.exitCode,
      stepResults: safeJson<unknown[]>(r.stepResults, []),
      hasLogs: r.logs.length > 0,
      detectionResults: safeJson<unknown[]>(r.detectionResults, []),
      actor: r.actor,
      createdAt: r.createdAt,
    })),
  });
}

const RUN_MODES = new Set(["immediate", "draft", "scheduled"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const owns = await assertUseCaseOwner(id, auth);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));
  const sessionUser = await getSessionUser().catch(() => null);
  const { prisma } = await import("@/lib/prisma");
  const { logEvent } = await import("@/lib/event-log");
  const { runPreflight } = await import("@/lib/enterprise-use-cases/preflight");

  const scenarioId = String(body.scenarioId || "");
  const environmentId = String(body.environmentId || "");
  const mode = String(body.mode || "");
  const runMode = String(body.runMode || "immediate");
  const scheduledFor = body.scheduledFor ? new Date(String(body.scheduledFor)) : null;
  const testedLogicChoice = body.testedLogicChoice ? String(body.testedLogicChoice) : undefined;
  const confirmDestructive = body.confirmDestructive === true;

  if (!scenarioId) return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  if (!environmentId) return NextResponse.json({ error: "environmentId is required" }, { status: 400 });
  const envOwns = await assertEnvOwner(environmentId, auth);
  if (!envOwns.ok) return envOwns.response;
  if (!MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...MODES].join("|")}` }, { status: 400 });
  }
  if (!RUN_MODES.has(runMode)) {
    return NextResponse.json({ error: `runMode must be one of ${[...RUN_MODES].join("|")}` }, { status: 400 });
  }
  if (testedLogicChoice && !CHOICES.has(testedLogicChoice)) {
    return NextResponse.json({ error: `testedLogicChoice must be one of ${[...CHOICES].join("|")}` }, { status: 400 });
  }
  if (runMode === "scheduled") {
    if (!scheduledFor || isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ error: "runMode=scheduled requires a valid scheduledFor ISO date" }, { status: 400 });
    }
    if (scheduledFor.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "scheduledFor cannot be more than 1 minute in the past" }, { status: 400 });
    }
  }

  // Capture preflight at create time so the row carries readiness with it.
  const preflight = await runPreflight({
    useCaseId: id, scenarioId, environmentId,
    mode: mode as "simulate-only" | "simulate-and-validate",
  }).catch(() => null);

  // Draft + Scheduled: persist a row without running, return the id.
  if (runMode === "draft" || runMode === "scheduled") {
    const ucCheck = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { id: true } });
    if (!ucCheck) return NextResponse.json({ error: "use case not found" }, { status: 404 });
    const scCheck = await prisma.enterpriseUseCaseScenario.findUnique({ where: { id: scenarioId }, select: { useCaseId: true } });
    if (!scCheck || scCheck.useCaseId !== id) return NextResponse.json({ error: "scenario not found" }, { status: 404 });
    const envCheck = await prisma.environmentTarget.findUnique({ where: { id: environmentId }, select: { id: true, enabled: true } });
    if (!envCheck) return NextResponse.json({ error: "environment not found" }, { status: 404 });

    const row = await prisma.enterpriseUseCaseRun.create({
      data: {
        useCaseId: id,
        scenarioId,
        environmentId,
        testedLogicChoice: testedLogicChoice || "",
        mode,
        runMode,
        scheduledFor: runMode === "scheduled" ? scheduledFor : null,
        status: runMode === "scheduled" ? "scheduled" : "draft",
        preflight: JSON.stringify(preflight || {}),
        actor: sessionUser?.email || "anonymous",
      },
    });
    void logEvent({
      category: "enterprise-uc",
      action: `enterprise-uc.run.${runMode}`,
      actor: sessionUser?.email || "anonymous",
      status: "ok",
      targetType: "EnterpriseUseCaseRun",
      targetId: row.id,
      message: runMode === "scheduled"
        ? `scheduled for ${scheduledFor!.toISOString()}`
        : "saved as draft",
      details: { scenarioId, environmentId, mode, scheduledFor: scheduledFor?.toISOString() },
    });
    return NextResponse.json({
      runId: row.id,
      runMode,
      scheduledFor: row.scheduledFor,
      status: row.status,
      preflight,
    });
  }

  // Immediate path — gate on preflight verdict
  if (preflight && !preflight.runnable) {
    return NextResponse.json({
      error: "Preflight blocked the run — fix failing checks first or save as draft",
      preflight,
    }, { status: 409 });
  }

  try {
    const result = await runScenario({
      useCaseId: id,
      scenarioId,
      environmentId,
      mode: mode as "simulate-only" | "simulate-and-validate",
      testedLogicChoice: testedLogicChoice as any,
      confirmDestructive,
      actor: sessionUser?.email || "anonymous",
    });
    return NextResponse.json({ ...result, preflight });
  } catch (err: any) {
    const code = err?.code as string | undefined;
    if (code === "not_found") return NextResponse.json({ error: err.message }, { status: 404 });
    if (code === "bad_state") return NextResponse.json({ error: err.message }, { status: 400 });
    if (code === "needs_confirm") {
      return NextResponse.json({ error: err.message, needsConfirm: true }, { status: 409 });
    }
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
