/**
 * PATCH /api/enterprise-use-cases/[id]/selected-logic
 *
 * Body: { choice: "original"|"recommended"|"edited", editedDetectionLogic?: string }
 *
 * Side-effects on save:
 *   1. Persist `selectedLogic` (and `editedDetectionLogic` when supplied).
 *   2. Re-run the deterministic validator against the new selected body.
 *   3. Recompute the SIEM-compatibility matrix against the new body.
 *   4. Refresh `lastValidatedAt` + `nextValidationDueAt`.
 *
 * Returns the updated validation + compat snapshot.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { validateUseCase } from "@/lib/enterprise-use-cases/validate";
import { computeSiemCompat } from "@/lib/enterprise-use-cases/siem-compat";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const CHOICE_ENUM = new Set(["original", "recommended", "edited"]);

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function pickBody(choice: string, originals: { original: string; recommended: string; edited: string }): string {
  if (choice === "edited") return originals.edited;
  if (choice === "recommended") return originals.recommended;
  return originals.original;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));

  const choice = String(body.choice || "");
  if (!CHOICE_ENUM.has(choice)) {
    return NextResponse.json({
      error: `choice must be one of ${[...CHOICE_ENUM].join("|")}`,
    }, { status: 400 });
  }

  const editedBody = typeof body.editedDetectionLogic === "string" ? body.editedDetectionLogic : undefined;

  const row = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // For "edited" choice, persist the new body if supplied; otherwise fall back
  // to the existing editedDetectionLogic. Reject if neither is present.
  if (choice === "edited") {
    const finalEdited = editedBody !== undefined ? editedBody : row.editedDetectionLogic;
    if (!finalEdited?.trim()) {
      return NextResponse.json({
        error: "choice='edited' requires editedDetectionLogic in the body or already persisted",
      }, { status: 400 });
    }
  }

  const newEdited = editedBody !== undefined ? editedBody : row.editedDetectionLogic;
  const newSelectedBody = pickBody(choice, {
    original: row.originalDetectionLogic,
    recommended: row.recommendedDetectionLogic,
    edited: newEdited,
  });

  const verdict = validateUseCase({
    name: row.name,
    description: row.description,
    detectionLogic: newSelectedBody,
    severity: row.severity,
    platforms: safeJson<string[]>(row.platforms, []),
    mitreTechniques: safeJson<string[]>(row.mitreTechniques, []),
  });
  const compat = await computeSiemCompat(newSelectedBody, row.format);

  const now = new Date();
  const nextDue = new Date(now.getTime() + (row.validationCadenceDays || 365) * 24 * 60 * 60 * 1000);

  const fmt = typeof body.format === "string" && ["sigma", "spl", "kql"].includes(body.format) ? body.format : undefined;

  const updated = await prisma.enterpriseUseCase.update({
    where: { id },
    data: {
      selectedLogic: choice,
      ...(fmt ? { selectedFormat: fmt } : {}),
      editedDetectionLogic: newEdited,
      validationStatus: verdict.verdict,
      validationDetails: JSON.stringify(verdict),
      siemCompatibility: JSON.stringify(compat.matrix),
      lastValidatedAt: now,
      nextValidationDueAt: nextDue,
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.selected-logic",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `selectedLogic=${choice} · verdict=${verdict.verdict}`,
    details: { choice, verdict: verdict.verdict, siemInstalled: compat.installed },
  });

  return NextResponse.json({
    id: updated.id,
    selectedLogic: updated.selectedLogic,
    editedDetectionLogic: updated.editedDetectionLogic,
    validationStatus: updated.validationStatus,
    validationDetails: verdict,
    siemCompatibility: compat.matrix,
    siemInstalled: compat.installed,
    lastValidatedAt: updated.lastValidatedAt,
    nextValidationDueAt: updated.nextValidationDueAt,
  });
}
