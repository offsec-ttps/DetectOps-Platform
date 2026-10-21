/**
 * PATCH /api/enterprise-use-cases/[id]/multi-format-logic
 *
 * Save user edits to ANY of the format bodies (Sigma / SPL / KQL).
 *
 * Body:
 *   {
 *     format: "sigma" | "spl" | "kql"
 *     body:   string                  // the new edited content
 *     selectAsCurrent?: boolean       // when true, also flip selectedLogic=edited + selectedFormat=<format>
 *   }
 *
 * Persists into the corresponding editedXxx column. Optionally bumps
 * selectedLogic so this body becomes the one downstream consumers (run,
 * report, promote) use.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const FORMATS = new Set(["sigma", "spl", "kql"]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const fmt = String(body.format || "");
  if (!FORMATS.has(fmt)) {
    return NextResponse.json({ error: `format must be one of ${[...FORMATS].join("|")}` }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body : "";
  const selectAsCurrent = body.selectAsCurrent === true;

  const row = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (fmt === "sigma") update.editedDetectionLogic = text.slice(0, 32_000);
  if (fmt === "spl")   update.editedSpl = text.slice(0, 32_000);
  if (fmt === "kql")   update.editedKql = text.slice(0, 32_000);
  if (selectAsCurrent) {
    update.selectedLogic = "edited";
    update.selectedFormat = fmt;
  }

  const updated = await prisma.enterpriseUseCase.update({ where: { id }, data: update });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.multi-format.save",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `edited ${fmt} body · ${text.length} chars${selectAsCurrent ? " · set as current" : ""}`,
    details: { format: fmt, length: text.length, selectAsCurrent },
  });

  return NextResponse.json({
    id,
    format: fmt,
    selectedLogic: updated.selectedLogic,
    selectedFormat: updated.selectedFormat,
  });
}
