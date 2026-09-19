/**
 * POST /api/enterprise-use-cases/upload
 *
 * Multipart-form-data ingest of a custom enterprise use case file. The body
 * may carry one or many use cases — the format iterator yields one
 * `ParsedRow` per logical use case. Creates an `EnterpriseUploadBatch` row
 * with the preview payload so the user can review BEFORE committing rows
 * into `EnterpriseUseCase`.
 *
 * Returns: { batchId, parsedRowCount, parseErrors, preview }
 *
 * Errors:
 *   400 — no file / unsupported type / too large
 *   500 — parser failure (logged + reflected in EnterpriseUploadBatch.status="failed")
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { iterateUpload } from "@/lib/enterprise-use-cases/format-iterator";
import { validateUseCase, normaliseSeverity } from "@/lib/enterprise-use-cases/validate";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";

const MAX_BYTES = 5 * 1024 * 1024;            // 5 MB hard cap
const ALLOWED_EXTS = new Set([
  "xlsx", "xlsm", "xls", "csv", "tsv",
  "md", "markdown", "txt", "text",
  "yml", "yaml", "toml",
  "spl", "kql", "yara", "yar",
]);

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const sessionUser = auth.user;
  const actor = sessionUser.email;

  // Content-type dispatch — accept multipart OR application/json with base64
  const ct = req.headers.get("content-type") || "";
  let filename = "";
  let buffer: Buffer | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "field 'file' is required (multipart/form-data)" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `file too large (max ${MAX_BYTES} bytes)` }, { status: 400 });
    }
    filename = file.name || "upload";
    buffer = Buffer.from(await file.arrayBuffer());
  } else if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    filename = String(body.filename || "paste.txt");
    if (typeof body.text === "string") buffer = Buffer.from(body.text, "utf-8");
    else if (typeof body.base64 === "string") buffer = Buffer.from(body.base64, "base64");
    if (!buffer) return NextResponse.json({ error: "body must include {filename, text} or {filename, base64}" }, { status: 400 });
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: `file too large (max ${MAX_BYTES} bytes)` }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data or application/json" }, { status: 415 });
  }

  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext && !ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({
      error: `unsupported extension .${ext}; allowed: ${[...ALLOWED_EXTS].join(", ")}`,
    }, { status: 400 });
  }

  let parsedRowCount = 0;
  let parseErrors: Array<{ row: string; message: string }> = [];
  let preview: any[] = [];
  let format = "unknown";

  try {
    const result = iterateUpload({ filename, buffer });
    format = result.format;
    parseErrors = result.errors;
    parsedRowCount = result.rows.length;

    // Pre-compute validation verdict per row so the preview table can render badges
    preview = result.rows.map((r) => {
      const v = validateUseCase({
        name: r.name,
        description: r.description,
        detectionLogic: r.detectionLogic,
        severity: r.severity,
        platforms: r.platforms,
        mitreTechniques: r.mitreTechniques,
      });
      return {
        sourceRowRef: r.sourceRowRef,
        name: r.name,
        description: r.description,
        detectionLogic: r.detectionLogic,
        severity: normaliseSeverity(r.severity),
        owner: r.owner,
        platforms: r.platforms,
        mitreTechniques: r.mitreTechniques,
        mitreTactics: r.mitreTactics,
        dataSources: r.dataSources,
        validationStatus: v.verdict,
        validationDetails: v,
      };
    });
  } catch (err: any) {
    const batch = await prisma.enterpriseUploadBatch.create({
      data: {
        filename, format,
        bytes: buffer.length,
        parsedRowCount: 0,
        status: "failed",
        parseErrors: JSON.stringify([{ row: "file", message: err?.message || String(err) }]),
        previewJson: "[]",
        uploadedBy: sessionUser?.id || "",
      },
    });
    void logEvent({
      category: "enterprise-uc", action: "enterprise-uc.upload",
      actor, status: "error",
      targetType: "EnterpriseUploadBatch", targetId: batch.id,
      message: `${filename} → parse failed`,
      details: { filename, format, bytes: buffer.length, error: String(err?.message || err) },
    });
    return NextResponse.json({ error: `parse failed: ${err?.message || err}` }, { status: 500 });
  }

  const batch = await prisma.enterpriseUploadBatch.create({
    data: {
      filename, format,
      bytes: buffer.length,
      parsedRowCount,
      status: "preview",
      parseErrors: JSON.stringify(parseErrors),
      previewJson: JSON.stringify(preview),
      uploadedBy: sessionUser?.id || "",
    },
  });

  void logEvent({
    category: "enterprise-uc", action: "enterprise-uc.upload",
    actor, status: "ok",
    targetType: "EnterpriseUploadBatch", targetId: batch.id,
    message: `${filename} (${format}) · parsed ${parsedRowCount} use case(s), ${parseErrors.length} error(s)`,
    details: { filename, format, bytes: buffer.length, parsedRowCount, errorCount: parseErrors.length },
  });

  return NextResponse.json({
    batchId: batch.id,
    filename,
    format,
    parsedRowCount,
    parseErrors,
    preview: preview.map((p) => ({
      sourceRowRef: p.sourceRowRef,
      name: p.name,
      description: p.description.slice(0, 240),
      detectionLogicPreview: p.detectionLogic.slice(0, 240),
      severity: p.severity,
      owner: p.owner,
      platforms: p.platforms,
      mitreTechniques: p.mitreTechniques,
      validationStatus: p.validationStatus,
      failedChecks: Object.entries(p.validationDetails.checks)
        .filter(([, c]: any) => !c.ok)
        .map(([k, c]: any) => ({ check: k, message: c.message, severity: c.severity })),
    })),
  });
}
