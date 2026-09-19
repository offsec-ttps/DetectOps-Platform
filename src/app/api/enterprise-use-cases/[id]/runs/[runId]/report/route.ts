/**
 * GET /api/enterprise-use-cases/[id]/runs/[runId]/report
 *
 * Stream a Markdown report for a single run. The report includes both bodies
 * (original + selected), per-step output, detection coverage, and the most
 * recent analyst comments.
 *
 * Accept-style query:
 *   ?format=md   → text/markdown (default; triggers a .md download)
 *   ?format=html → text/html  — minimal preview wrapper around the same Markdown
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderRunReport, type UseCaseSnapshot, type RunSnapshot } from "@/lib/enterprise-use-cases/render-report";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format") || "md";

  const run = await prisma.enterpriseUseCaseRun.findUnique({ where: { id: runId } });
  if (!run || run.useCaseId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [uc, scenario, env, comments] = await Promise.all([
    prisma.enterpriseUseCase.findUnique({ where: { id } }),
    run.scenarioId ? prisma.enterpriseUseCaseScenario.findUnique({ where: { id: run.scenarioId }, select: { id: true, ordinal: true, name: true } }) : null,
    run.environmentId ? prisma.environmentTarget.findUnique({ where: { id: run.environmentId }, select: { id: true, name: true, kind: true } }) : null,
    prisma.enterpriseUseCaseComment.findMany({ where: { useCaseId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  if (!uc) return NextResponse.json({ error: "use case not found" }, { status: 404 });

  const ucSnap: UseCaseSnapshot = {
    id: uc.id, name: uc.name, description: uc.description,
    severity: uc.severity, status: uc.status, owner: uc.owner, format: uc.format,
    platforms: safeJson<string[]>(uc.platforms, []),
    mitreTechniques: safeJson<string[]>(uc.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(uc.mitreTactics, []),
    siemCompatibility: safeJson<Record<string, string>>(uc.siemCompatibility, {}),
    originalDetectionLogic: uc.originalDetectionLogic,
    recommendedDetectionLogic: uc.recommendedDetectionLogic,
    editedDetectionLogic: uc.editedDetectionLogic,
    selectedLogic: uc.selectedLogic,
    sourceFilename: uc.sourceFilename,
    sourceRowRef: uc.sourceRowRef,
    createdAt: uc.createdAt, updatedAt: uc.updatedAt,
  };
  const runSnap: RunSnapshot = {
    id: run.id,
    scenarioName: scenario?.name,
    scenarioOrdinal: scenario?.ordinal,
    environmentName: env?.name,
    environmentKind: env?.kind,
    testedLogicChoice: run.testedLogicChoice,
    mode: run.mode,
    status: run.status,
    validationOutcome: run.validationOutcome,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    actor: run.actor,
    stepResults: safeJson<any[]>(run.stepResults, []),
    detectionResults: safeJson<any[]>(run.detectionResults, []),
    logs: run.logs,
  };
  const md = renderRunReport(ucSnap, runSnap, {
    comments: comments.map((c) => ({ author: c.author, body: c.body, kind: c.kind, createdAt: c.createdAt })),
  });

  const slug = uc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "uc";
  const stamp = (run.completedAt || run.createdAt).toISOString().slice(0, 10);
  const filename = `enterprise-uc-${slug}-run-${stamp}.md`;

  if (format === "html") {
    const html = `<!doctype html><html><body><pre style="white-space: pre-wrap; font-family: monospace;">${md.replace(/</g, "&lt;")}</pre></body></html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
