/**
 * GET    /api/sigmagen/sessions/[id] — session + messages + runs (with artifact summaries)
 * DELETE /api/sigmagen/sessions/[id] — delete a session (cascades messages + runs)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

/**
 * Ownership guard. Returns the auth result so callers can 401 in enforced mode.
 * In ENFORCED mode an authenticated user is required and must match the owner;
 * in dev mode access is allowed (single-user/no-auth) but a real session, when
 * present, still can't read another user's owned session.
 */
async function authorizeSession(createdBy: string): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const auth = await requireUser();
  if (!auth.ok) return auth;                                  // enforced + no session → 401
  if (createdBy && auth.user.email !== createdBy) {
    // Cross-account: deny when enforcing OR when a real (non-dev) session is present.
    if (auth.enforced || auth.user.id !== "dev-local") {
      return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
    }
  }
  return { ok: true };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await prisma.sigmaGenSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      runs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const authz = await authorizeSession(session.createdBy);
  if (!authz.ok) return authz.response;

  // Resolve artifact summaries for completed runs.
  const packIds = session.runs.map((r) => r.detectionPackId).filter(Boolean) as string[];
  const packs = packIds.length
    ? await prisma.detectionPack.findMany({
        where: { id: { in: packIds } },
        include: { _count: { select: { rules: true, simulations: true } }, irPlaybook: { select: { id: true } } },
      })
    : [];
  const packById = new Map(packs.map((p) => [p.id, p]));

  return NextResponse.json({
    session: { id: session.id, title: session.title, status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt },
    messages: session.messages.map((m) => ({
      id: m.id, role: m.role, content: m.content, inputKind: m.inputKind, attachmentName: m.attachmentName, runId: m.runId, createdAt: m.createdAt,
    })),
    runs: session.runs.map((r) => {
      const pack = r.detectionPackId ? packById.get(r.detectionPackId) : null;
      return {
        id: r.id,
        status: r.status,
        inputKind: r.inputKind,
        inputTitle: r.inputTitle,
        steps: safeJson<unknown[]>(r.steps, []),
        techniques: safeJson<string[]>(r.techniques, []),
        references: safeJson<unknown[]>(r.references, []),
        intel: safeJson<Record<string, unknown>>(r.intelJson, {}),
        guardrail: safeJson<Record<string, unknown>>(r.guardrailJson, {}),
        useCases: safeJson<unknown[]>(r.useCasesJson, []),
        detectionPackId: r.detectionPackId,
        useCaseIds: safeJson<string[]>(r.useCaseIds, []),
        costUsd: r.costUsd,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
        packSummary: pack ? { ruleCount: pack._count.rules, simulationCount: pack._count.simulations, hasIrPlaybook: !!pack.irPlaybook } : null,
      };
    }),
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await prisma.sigmaGenSession.findUnique({ where: { id }, select: { createdBy: true } });
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const authz = await authorizeSession(session.createdBy);
  if (!authz.ok) return authz.response;
  await prisma.sigmaGenSession.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
