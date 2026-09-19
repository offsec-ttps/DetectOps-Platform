/**
 * GET    /api/enterprise-use-cases/[id]   — full detail
 * PATCH  /api/enterprise-use-cases/[id]   — metadata edit
 * DELETE /api/enterprise-use-cases/[id]   — soft-retire (status="retired")
 *
 * PATCH-able fields:
 *   name, description, severity, platforms, dataSources, owner,
 *   validationCadenceDays, nextValidationDueAt,
 *   originalDetectionLogic, editedDetectionLogic, selectedLogic,
 *   status, mitreTechniques, mitreTactics
 *
 * Any change to a *DetectionLogic field invalidates the SIEM-compat matrix
 * for that body; the matrix is recomputed on the next explicit validate call.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

const PATCHABLE = new Set([
  "name", "description", "severity",
  "platforms", "dataSources", "owner",
  "validationCadenceDays", "nextValidationDueAt",
  "originalDetectionLogic", "editedDetectionLogic", "selectedLogic",
  "status", "mitreTechniques", "mitreTactics",
]);

const STATUS_ENUM = new Set([
  "imported", "mapped", "scenarios-defined", "validated", "promoted", "retired",
]);
const SELECTED_ENUM = new Set(["original", "recommended", "edited"]);

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const row = await prisma.enterpriseUseCase.findUnique({
    where: { id },
    include: {
      scenarios: { orderBy: { ordinal: "asc" } },
      runs: { orderBy: { createdAt: "desc" }, take: 20 },
      comments: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.uploadedBy);
  if (!owns.ok) return owns.response;
  return NextResponse.json({
    id: row.id,
    name: row.name,
    description: row.description,
    originalDetectionLogic: row.originalDetectionLogic,
    recommendedDetectionLogic: row.recommendedDetectionLogic,
    recommendedSpl: row.recommendedSpl,
    recommendedKql: row.recommendedKql,
    recommendedNotes: safeJson<any>(row.recommendedNotes, {}),
    editedDetectionLogic: row.editedDetectionLogic,
    editedSpl: row.editedSpl,
    editedKql: row.editedKql,
    selectedLogic: row.selectedLogic,
    selectedFormat: row.selectedFormat,
    format: row.format,
    severity: row.severity,
    platforms: safeJson<string[]>(row.platforms, []),
    dataSources: safeJson<string[]>(row.dataSources, []),
    owner: row.owner,
    sourceFilename: row.sourceFilename,
    sourceRowRef: row.sourceRowRef,
    uploadBatchId: row.uploadBatchId,
    status: row.status,
    validationStatus: row.validationStatus,
    validationDetails: safeJson<any>(row.validationDetails, { checks: {}, verdict: "pending" }),
    lastValidatedAt: row.lastValidatedAt,
    nextValidationDueAt: row.nextValidationDueAt,
    validationCadenceDays: row.validationCadenceDays,
    siemCompatibility: safeJson<Record<string, string>>(row.siemCompatibility, {}),
    mitreTechniques: safeJson<string[]>(row.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(row.mitreTactics, []),
    githubIssueUrl: row.githubIssueUrl,
    githubIssueNumber: row.githubIssueNumber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    scenarios: row.scenarios.map((s) => ({
      id: s.id, ordinal: s.ordinal, name: s.name, description: s.description,
      steps: safeJson<unknown[]>(s.steps, []),
      source: s.source,
    })),
    recentRuns: row.runs.map((r) => ({
      id: r.id, mode: r.mode, status: r.status, validationOutcome: r.validationOutcome,
      testedLogicChoice: r.testedLogicChoice, durationMs: r.durationMs, createdAt: r.createdAt,
    })),
    comments: row.comments.map((c) => ({
      id: c.id, author: c.author, body: c.body, kind: c.kind, createdAt: c.createdAt, runId: c.runId,
    })),
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { uploadedBy: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.uploadedBy);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "platforms" || k === "dataSources" || k === "mitreTechniques" || k === "mitreTactics") {
      data[k] = JSON.stringify(v ?? []);
    } else if (k === "validationCadenceDays") {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      data[k] = Number.isFinite(n) ? Math.max(1, Math.min(3650, Math.round(n))) : 365;
    } else if (k === "nextValidationDueAt") {
      data[k] = v ? new Date(String(v)) : null;
    } else if (k === "status") {
      if (!STATUS_ENUM.has(String(v))) {
        return NextResponse.json({ error: `status must be one of ${[...STATUS_ENUM].join("|")}` }, { status: 400 });
      }
      data[k] = v;
    } else if (k === "selectedLogic") {
      if (!SELECTED_ENUM.has(String(v))) {
        return NextResponse.json({ error: `selectedLogic must be one of ${[...SELECTED_ENUM].join("|")}` }, { status: 400 });
      }
      data[k] = v;
    } else {
      data[k] = v;
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 });
  }

  try {
    const updated = await prisma.enterpriseUseCase.update({ where: { id }, data: data as any });
    void logEvent({
      category: "enterprise-uc", action: "enterprise-uc.update",
      actor: auth.user.email, status: "ok",
      targetType: "EnterpriseUseCase", targetId: id,
      message: `Updated ${Object.keys(data).join(", ")}`,
      details: { fields: Object.keys(data) },
    });
    return NextResponse.json({ id: updated.id, updated: Object.keys(data) });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.enterpriseUseCase.findUnique({ where: { id }, select: { uploadedBy: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.uploadedBy);
  if (!owns.ok) return owns.response;

  try {
    await prisma.enterpriseUseCase.update({ where: { id }, data: { status: "retired" } });
    void logEvent({
      category: "enterprise-uc", action: "enterprise-uc.retire",
      actor: auth.user.email, status: "ok",
      targetType: "EnterpriseUseCase", targetId: id,
      message: "soft-retired (status=retired)",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
