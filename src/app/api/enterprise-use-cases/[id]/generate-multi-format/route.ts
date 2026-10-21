/**
 * POST /api/enterprise-use-cases/[id]/generate-multi-format
 *
 * Generate the SPL (Splunk) + KQL (Sentinel / Defender) variants from the
 * current recommended Sigma body. Strategy:
 *   1. Look for a battle-tested community rule for each format.
 *   2. Fall back to sigma-cli conversion if no community match.
 *   3. Persist into EnterpriseUseCase.recommendedSpl / recommendedKql.
 *   4. Capture per-format conversion notes into recommendedNotes JSON.
 *
 * Returns: { spl: FormatResult, kql: FormatResult, notes }
 */

import { NextRequest, NextResponse } from "next/server";
import { guardUseCase } from "@/lib/enterprise-use-cases/access";
import { prisma } from "@/lib/prisma";
import { generateMultiFormat } from "@/lib/enterprise-use-cases/multi-format-generator";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await guardUseCase(id);   // owner/admin only
  if (denied) return denied;
  const row = await prisma.enterpriseUseCase.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Use the edited Sigma if present (user has tuned it), otherwise the
  // recommended one, otherwise the original. SPL/KQL track whatever Sigma is
  // the most-recently-canonical body.
  const sigmaBody = (row.editedDetectionLogic && (row.format === "sigma" || row.format === "yaml"))
    ? row.editedDetectionLogic
    : row.recommendedDetectionLogic || row.originalDetectionLogic;

  const techniques = safeJson<string[]>(row.mitreTechniques, []);
  const result = await generateMultiFormat(sigmaBody, techniques);

  await prisma.enterpriseUseCase.update({
    where: { id },
    data: {
      recommendedSpl: result.spl.body,
      recommendedKql: result.kql.body,
      recommendedNotes: JSON.stringify({
        spl: { source: result.spl.source, note: result.spl.note, refId: result.spl.communityRefId, refSource: result.spl.communityRefSource },
        kql: { source: result.kql.source, note: result.kql.note, refId: result.kql.communityRefId, refSource: result.kql.communityRefSource },
        generatedAt: new Date().toISOString(),
      }),
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.generate-multi-format",
    actor: sessionUser?.email || "anonymous",
    status: "ok",
    targetType: "EnterpriseUseCase",
    targetId: id,
    message: `spl=${result.spl.source} · kql=${result.kql.source}`,
    details: { splSource: result.spl.source, kqlSource: result.kql.source },
  });

  return NextResponse.json({
    id,
    spl: result.spl,
    kql: result.kql,
  });
}
