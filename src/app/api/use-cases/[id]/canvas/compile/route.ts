/**
 * POST /api/use-cases/[id]/canvas/compile
 *
 * Reads the persisted canvas, runs topological sort, replaces UseCaseStep rows
 * with the compiled order. Rejects on cycle.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compileCanvasToSteps } from "@/lib/use-cases/canvas/compile";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const useCase = await prisma.useCase.findUnique({
    where: { id },
    include: { canvas: true },
  });
  if (!useCase) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!useCase.canvas) {
    return NextResponse.json({ error: "no canvas saved for this UseCase" }, { status: 400 });
  }

  const nodes = safeJson<any[]>(useCase.canvas.nodes, []);
  const edges = safeJson<any[]>(useCase.canvas.edges, []);
  const sessionUser = await getSessionUser().catch(() => null);

  const result = compileCanvasToSteps(nodes, edges);
  if (!result.ok) {
    void logEvent({
      category: "usecase", action: "usecase.canvas.compile",
      actor: sessionUser?.email || "anonymous", status: "error",
      targetType: "usecase", targetId: id,
      message: result.error.message,
      errorMessage: result.error.message,
      details: { code: result.error.code, cycle: result.error.cycle },
    });
    return NextResponse.json(result, { status: 400 });
  }

  // Aggregate technique union
  const techniques = [...new Set(result.steps.map((s) => s.techniqueId).filter(Boolean))];

  // Replace steps in a single transaction
  await prisma.$transaction([
    prisma.useCaseStep.deleteMany({ where: { useCaseId: id } }),
    prisma.useCase.update({
      where: { id },
      data: {
        mitreTechniques: JSON.stringify(techniques),
        framework: "mixed",
        steps: {
          create: result.steps.map((s) => ({
            orderIndex: s.orderIndex,
            kind: s.kind,
            refId: s.refId || "",
            techniqueId: s.techniqueId || "",
            displayName: s.displayName,
            parameters: JSON.stringify(s.parameters ?? {}),
            expectedSignal: (s.expectedSignal || "").slice(0, 500),
            notes: (s.notes || "").slice(0, 2000),
          })),
        },
      },
    }),
  ]);

  void logEvent({
    category: "usecase", action: "usecase.canvas.compile",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "usecase", targetId: id,
    message: `${result.steps.length} step(s) compiled · ${result.isolatedNodes.length} isolated`,
    details: {
      stepCount: result.steps.length,
      isolatedCount: result.isolatedNodes.length,
      techniques: techniques.length,
    },
  });

  return NextResponse.json({
    ok: true,
    stepCount: result.steps.length,
    isolatedNodes: result.isolatedNodes,
    techniques,
  });
}
