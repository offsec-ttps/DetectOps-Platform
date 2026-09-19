/**
 * POST /api/enterprise-use-cases/[id]/runs/[runId]/github-push
 *
 * Create (or comment on) a GitHub Issue containing the use case + run
 * snapshot. Reuses `src/lib/github.ts::createIssue` — the same path the
 * Detection Pack pipeline uses, so token handling stays consistent.
 *
 * Body:
 *   {
 *     repo:  "owner/repo"           // required
 *     token?: string                // overrides GITHUB_TOKEN env
 *     labels?: string[]             // overrides default status-derived labels
 *     updateIfExists?: boolean      // default true; appends a comment when the UC already has an issue
 *   }
 *
 * Returns: { action: "created" | "commented", issueUrl, issueNumber }
 *
 * Errors:
 *   400 — bad repo format
 *   404 — use case / run not found
 *   503 — missing GitHub token
 *   500 — GitHub API failure
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createIssue, githubRequest } from "@/lib/github";
import { renderIssueTitle, renderIssueBody, type UseCaseSnapshot, type RunSnapshot } from "@/lib/enterprise-use-cases/render-report";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const STATUS_TO_LABELS: Record<string, string[]> = {
  imported:           ["enterprise-uc", "status:imported"],
  mapped:             ["enterprise-uc", "status:mapped"],
  "scenarios-defined":["enterprise-uc", "status:scenarios-defined"],
  validated:          ["enterprise-uc", "status:validated"],
  promoted:           ["enterprise-uc", "status:promoted"],
  retired:            ["enterprise-uc", "status:retired"],
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id, runId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const repo = String(body.repo || "").trim();
  if (!repo) return NextResponse.json({ error: "repo is required (owner/repo)" }, { status: 400 });
  if (!/^[^/]+\/[^/]+$/.test(repo)) return NextResponse.json({ error: "repo must be in owner/repo format" }, { status: 400 });

  const token = (typeof body.token === "string" && body.token) ? body.token : process.env.GITHUB_TOKEN || "";
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN not set — pass token in body or set GITHUB_TOKEN in .env", code: "missing_token" }, { status: 503 });
  }
  const updateIfExists = body.updateIfExists !== false;
  const sessionUser = await getSessionUser().catch(() => null);

  const run = await prisma.enterpriseUseCaseRun.findUnique({ where: { id: runId } });
  if (!run || run.useCaseId !== id) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const [uc, scenario, env, comments] = await Promise.all([
    prisma.enterpriseUseCase.findUnique({ where: { id } }),
    run.scenarioId ? prisma.enterpriseUseCaseScenario.findUnique({ where: { id: run.scenarioId }, select: { id: true, ordinal: true, name: true } }) : null,
    run.environmentId ? prisma.environmentTarget.findUnique({ where: { id: run.environmentId }, select: { id: true, name: true, kind: true } }) : null,
    prisma.enterpriseUseCaseComment.findMany({ where: { useCaseId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  if (!uc) return NextResponse.json({ error: "use case not found" }, { status: 404 });
  // Ownership: only the use case's owner (or admin) may push it to GitHub.
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, uc.uploadedBy);
  if (!owns.ok) return owns.response;

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
    mode: run.mode, status: run.status,
    validationOutcome: run.validationOutcome,
    durationMs: run.durationMs, exitCode: run.exitCode,
    startedAt: run.startedAt, completedAt: run.completedAt,
    actor: run.actor,
    stepResults: safeJson<any[]>(run.stepResults, []),
    detectionResults: safeJson<any[]>(run.detectionResults, []),
    logs: run.logs,
  };

  const issueBody = renderIssueBody(ucSnap, runSnap, {
    detail: "compact",
    comments: comments.map((c) => ({ author: c.author, body: c.body, kind: c.kind, createdAt: c.createdAt })),
    generatorTag: `run ${run.id.slice(0, 8)}`,
  });
  const labels = Array.isArray(body.labels) && body.labels.length
    ? body.labels.map(String).slice(0, 12)
    : STATUS_TO_LABELS[uc.status] || STATUS_TO_LABELS.imported;
  const title = renderIssueTitle(ucSnap, runSnap);
  const [owner, repoName] = repo.split("/");

  try {
    let action: "created" | "commented";
    let issueUrl: string;
    let issueNumber: number;

    if (uc.githubIssueUrl && uc.githubIssueNumber && updateIfExists) {
      const r = await githubRequest(
        token, "POST",
        `/repos/${owner}/${repoName}/issues/${uc.githubIssueNumber}/comments`,
        { body: issueBody },
      );
      if (r.status >= 300) {
        throw new Error(`GitHub HTTP ${r.status}: ${typeof r.data === "string" ? r.data.slice(0, 200) : r.data?.message || ""}`);
      }
      action = "commented";
      issueUrl = uc.githubIssueUrl;
      issueNumber = uc.githubIssueNumber;
    } else {
      const issue = await createIssue(token, owner, repoName, title, issueBody, labels);
      action = "created";
      issueUrl = issue.html_url;
      issueNumber = issue.number;
      await prisma.enterpriseUseCase.update({
        where: { id: uc.id },
        data: { githubIssueUrl: issueUrl, githubIssueNumber: issueNumber },
      });
    }

    void logEvent({
      category: "enterprise-uc",
      action: `enterprise-uc.github-push.${action}`,
      actor: sessionUser?.email || "anonymous",
      status: "ok",
      targetType: "EnterpriseUseCaseRun",
      targetId: run.id,
      message: `${action} GitHub Issue #${issueNumber} on ${repo}`,
      details: { repo, issueUrl, issueNumber, labels },
    });

    return NextResponse.json({ action, issueUrl, issueNumber });
  } catch (err: any) {
    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.github-push.error",
      actor: sessionUser?.email || "anonymous",
      status: "error",
      targetType: "EnterpriseUseCaseRun",
      targetId: run.id,
      message: err?.message || String(err),
      details: { repo, error: String(err?.message || err) },
    });
    return NextResponse.json({ error: err?.message || "GitHub push failed" }, { status: 500 });
  }
}
