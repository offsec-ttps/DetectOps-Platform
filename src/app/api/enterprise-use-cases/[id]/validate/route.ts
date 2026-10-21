/**
 * POST /api/enterprise-use-cases/[id]/validate
 *
 * Re-run the deterministic validator AND recompute the SIEM-compat matrix
 * for the currently-selected detection logic. Cheap when the body hasn't
 * changed (matrix cache hit).
 *
 * Returns the updated use case row's validation block.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { validateUseCase } from "@/lib/enterprise-use-cases/validate";
import { computeSiemCompat } from "@/lib/enterprise-use-cases/siem-compat";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function pickLogic(row: {
  selectedLogic: string;
  originalDetectionLogic: string;
  recommendedDetectionLogic: string;
  editedDetectionLogic: string;
}): string {
  if (row.selectedLogic === "edited" && row.editedDetectionLogic) return row.editedDetectionLogic;
  if (row.selectedLogic === "recommended" && row.recommendedDetectionLogic) return row.recommendedDetectionLogic;
  return row.originalDetectionLogic;
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const row = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const selectedBody = pickLogic(row);
  const verdict = validateUseCase({
    name: row.name,
    description: row.description,
    detectionLogic: selectedBody,
    severity: row.severity,
    platforms: safeJson<string[]>(row.platforms, []),
    mitreTechniques: safeJson<string[]>(row.mitreTechniques, []),
  });
  const compat = await computeSiemCompat(selectedBody, row.format);

  const now = new Date();
  const nextDue = new Date(now.getTime() + (row.validationCadenceDays || 365) * 24 * 60 * 60 * 1000);
  const updated = await prisma.enterpriseUseCase.update({
    where: { id },
    data: {
      validationStatus: verdict.verdict,
      validationDetails: JSON.stringify(verdict),
      siemCompatibility: JSON.stringify(compat.matrix),
      lastValidatedAt: now,
      nextValidationDueAt: nextDue,
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc", action: "enterprise-uc.validate",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "EnterpriseUseCase", targetId: id,
    message: `verdict=${verdict.verdict} · siem=[${Object.entries(compat.matrix).map(([k, v]) => `${k}:${v}`).join(",")}]`,
    details: { verdict: verdict.verdict, siemInstalled: compat.installed },
  });

  return NextResponse.json({
    id: updated.id,
    validationStatus: updated.validationStatus,
    validationDetails: verdict,
    siemCompatibility: compat.matrix,
    siemInstalled: compat.installed,
    siemToolVersion: compat.toolVersion,
    lastValidatedAt: updated.lastValidatedAt,
    nextValidationDueAt: updated.nextValidationDueAt,
  });
}
