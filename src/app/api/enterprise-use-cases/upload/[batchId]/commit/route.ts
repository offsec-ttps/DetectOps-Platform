/**
 * POST /api/enterprise-use-cases/upload/[batchId]/commit
 *
 * Persist the previewed rows from an EnterpriseUploadBatch as EnterpriseUseCase
 * rows. Skips rows whose validationStatus is "red" UNLESS the caller passes
 * `{ includeRed: true }`. Computes initial SIEM-compat matrix per row when
 * the row's format is Sigma / YAML.
 *
 * Returns: { batchId, createdRowCount, skippedRowCount, errorRowCount, ids }
 *
 * Errors:
 *   404 — batch not found
 *   409 — batch already committed
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSiemCompat } from "@/lib/enterprise-use-cases/siem-compat";
import { synthesizeRecommended } from "@/lib/enterprise-use-cases/recommend-logic";
import { buildAutoScenarios } from "@/lib/enterprise-use-cases/auto-scenarios";
import { generateMultiFormat } from "@/lib/enterprise-use-cases/multi-format-generator";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

interface PreviewRow {
  sourceRowRef: string;
  name: string;
  description: string;
  detectionLogic: string;
  severity: string;
  owner: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  dataSources: string[];
  validationStatus: "green" | "yellow" | "red";
  validationDetails: any;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { batchId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const includeRed = body.includeRed === true;

  const batch = await prisma.enterpriseUploadBatch.findUnique({ where: { id: batchId } });
  if (!batch) return NextResponse.json({ error: "batch not found" }, { status: 404 });
  // Ownership: only the uploader (or admin) may commit, when enforcing.
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, batch.uploadedBy);
  if (!owns.ok) return owns.response;
  if (batch.status === "committed") {
    return NextResponse.json({ error: "batch already committed" }, { status: 409 });
  }

  const previewRows = safeJson<PreviewRow[]>(batch.previewJson, []);
  const sessionUser = await getSessionUser().catch(() => null);

  // Compute SIEM-compat matrix per row. The CLI subprocess is the heavy part —
  // batch this in chunks of 4 to keep the request reasonable.
  const CHUNK = 4;
  const compatByIdx: Array<{ siemCompatibility: string; siemDetails: string } | null> = previewRows.map(() => null);
  for (let i = 0; i < previewRows.length; i += CHUNK) {
    const slice = previewRows.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map((p) => computeSiemCompat(p.detectionLogic, batch.format).catch(() => null)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      compatByIdx[i + j] = r ? {
        siemCompatibility: JSON.stringify(r.matrix),
        siemDetails: JSON.stringify({ hash: r.hash, generatedAt: r.generatedAt, toolVersion: r.toolVersion, installed: r.installed, details: r.details }),
      } : { siemCompatibility: "{}", siemDetails: "{}" };
    }
  }

  // Persist
  const now = new Date();
  const cadenceDays = 365;
  const nextDue = new Date(now.getTime() + cadenceDays * 24 * 60 * 60 * 1000);

  const created: string[] = [];
  let skipped = 0, errored = 0;
  let autoRecommended = 0, autoScenariosCreated = 0;
  const errors: Array<{ row: string; message: string }> = [];

  for (let i = 0; i < previewRows.length; i++) {
    const p = previewRows[i];
    if (p.validationStatus === "red" && !includeRed) { skipped++; continue; }
    try {
      // 1. Synthesize the recommended Sigma body deterministically. Same call
      //    the /recommend route uses — if it throws we keep going with empty.
      let recommendedBody = "";
      let recommendIsAlreadySigma = false;
      try {
        const rec = synthesizeRecommended({
          useCaseId: "pending",   // overwritten with the real id below for the persisted body
          name: p.name || `Untitled ${p.sourceRowRef}`,
          description: p.description || "",
          originalDetectionLogic: p.detectionLogic || "",
          format: batch.format,
          severity: p.severity || "medium",
          platforms: p.platforms || [],
          owner: p.owner || "",
          mitreTechniques: p.mitreTechniques || [],
          mitreTactics: p.mitreTactics || [],
        });
        recommendedBody = rec.body;
        recommendIsAlreadySigma = rec.isAlreadySigma;
      } catch { /* keep recommendedBody empty on failure */ }

      // 2. Persist the use-case row, status pre-bumped to "mapped" when we
      //    produced a recommendation. Same lifecycle the /recommend endpoint
      //    would set.
      const initialStatus = recommendedBody ? "mapped" : "imported";
      const row = await prisma.enterpriseUseCase.create({
        data: {
          name: (p.name || "").slice(0, 240) || `Untitled ${p.sourceRowRef}`,
          description: (p.description || "").slice(0, 4000),
          originalDetectionLogic: (p.detectionLogic || "").slice(0, 32_000),
          recommendedDetectionLogic: recommendedBody.slice(0, 32_000),
          editedDetectionLogic: "",
          selectedLogic: "original",
          format: batch.format,
          severity: p.severity || "medium",
          platforms: JSON.stringify(p.platforms || []),
          dataSources: JSON.stringify(p.dataSources || []),
          owner: (p.owner || "").slice(0, 240),
          uploadBatchId: batch.id,
          sourceFilename: batch.filename,
          sourceRowRef: p.sourceRowRef,
          uploadedBy: sessionUser?.id || "",
          status: initialStatus,
          validationStatus: p.validationStatus,
          validationDetails: JSON.stringify(p.validationDetails),
          lastValidatedAt: now,
          nextValidationDueAt: nextDue,
          validationCadenceDays: cadenceDays,
          siemCompatibility: compatByIdx[i]?.siemCompatibility || "{}",
          mitreTechniques: JSON.stringify(p.mitreTechniques || []),
          mitreTactics: JSON.stringify(p.mitreTactics || []),
        },
      });
      created.push(row.id);
      if (recommendedBody) autoRecommended++;

      // 3. Multi-format generation — Sigma → SPL + KQL.
      //    Same call as the /generate-multi-format endpoint. Error-isolated.
      if (recommendedBody) {
        try {
          const mf = await generateMultiFormat(recommendedBody, p.mitreTechniques || []);
          await prisma.enterpriseUseCase.update({
            where: { id: row.id },
            data: {
              recommendedSpl: mf.spl.body,
              recommendedKql: mf.kql.body,
              recommendedNotes: JSON.stringify({
                spl: { source: mf.spl.source, note: mf.spl.note, refId: mf.spl.communityRefId, refSource: mf.spl.communityRefSource },
                kql: { source: mf.kql.source, note: mf.kql.note, refId: mf.kql.communityRefId, refSource: mf.kql.communityRefSource },
                generatedAt: new Date().toISOString(),
              }),
            },
          });
        } catch { /* skip multi-format on this row's failure */ }
      }

      // 4. Auto-suggest scenarios from the extracted techniques. Caps at 8 per
      //    framework. Per-row try/catch so one bad row never blocks the batch.
      try {
        const drafts = await buildAutoScenarios({
          techniques: p.mitreTechniques || [],
          useCaseName: p.name || row.id,
          // Bias ranking with the use case's content so the simulations
          // actually relate to what the use case describes (e.g. "certutil"
          // → the certutil-specific ART test for T1140).
          relevanceHint: `${p.description || ""} ${(p.detectionLogic || "").slice(0, 2000)}`,
        });
        if (drafts.length > 0) {
          let ord = 0;
          for (const d of drafts) {
            ord += 1;
            await prisma.enterpriseUseCaseScenario.create({
              data: {
                useCaseId: row.id,
                ordinal: ord,
                name: d.name.slice(0, 240),
                description: d.description.slice(0, 2000),
                steps: JSON.stringify(d.steps),
                source: "auto",
              },
            });
            autoScenariosCreated++;
          }
          // Lifecycle: scenarios-defined when ≥1 scenario landed
          await prisma.enterpriseUseCase.update({
            where: { id: row.id },
            data: { status: "scenarios-defined" },
          });
        }
      } catch { /* skip this row's scenarios on failure */ }
    } catch (err: any) {
      errored++;
      errors.push({ row: p.sourceRowRef, message: String(err?.message || err).slice(0, 300) });
    }
  }

  await prisma.enterpriseUploadBatch.update({
    where: { id: batch.id },
    data: {
      status: "committed",
      createdRowCount: created.length,
      parseErrors: JSON.stringify([...safeJson<any[]>(batch.parseErrors, []), ...errors]),
    },
  });

  void logEvent({
    category: "enterprise-uc", action: "enterprise-uc.upload.commit",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "EnterpriseUploadBatch", targetId: batch.id,
    message: `${batch.filename} · committed ${created.length} use case(s) (skipped=${skipped}, errored=${errored}) · auto-recommended=${autoRecommended} · auto-scenarios=${autoScenariosCreated}`,
    details: { batchId: batch.id, filename: batch.filename, created: created.length, skipped, errored, includeRed, autoRecommended, autoScenariosCreated },
  });

  return NextResponse.json({
    batchId: batch.id,
    createdRowCount: created.length,
    skippedRowCount: skipped,
    errorRowCount: errored,
    autoRecommendedCount: autoRecommended,
    autoScenariosCount: autoScenariosCreated,
    errors,
    ids: created,
  });
}
