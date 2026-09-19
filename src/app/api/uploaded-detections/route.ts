/**
 * GET  /api/uploaded-detections          — list paged uploads
 * POST /api/uploaded-detections          — accept a file (multipart/form-data),
 *                                          sniff format, build inferred mappings,
 *                                          persist a row, return preview
 *
 * The multipart parser uses Web standards (NextRequest.formData()), so no
 * extra deps are required. We cap file size at 256 KB — anything bigger is
 * almost certainly not a single detection rule.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inferUpload } from "@/lib/use-cases/upload/infer-mapping";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

const MAX_BYTES = 256 * 1024;

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "25", 10)));
  const where: Record<string, unknown> = {};
  if (sp.get("format")) where.format = sp.get("format");

  const [rows, total] = await Promise.all([
    prisma.uploadedDetection.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, filename: true, format: true, useCaseId: true,
        parsedTechniques: true, parsedTactics: true, parsedLogsource: true,
        inferredMappings: true, uploadedBy: true, createdAt: true,
      },
    }),
    prisma.uploadedDetection.count({ where: where as any }),
  ]);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      parsedTechniques: safeJson<string[]>(r.parsedTechniques, []),
      parsedTactics: safeJson<string[]>(r.parsedTactics, []),
      inferredMappings: safeJson<Record<string, unknown>>(r.inferredMappings, {}),
    })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser().catch(() => null);
  const t0 = Date.now();

  let filename = "rule";
  let body = "";

  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "field 'file' required" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: `file too large (${file.size} > ${MAX_BYTES} bytes)` }, { status: 413 });
      }
      filename = (file as File).name || "rule";
      body = await file.text();
    } else if (ctype.startsWith("application/json")) {
      // Direct text upload (used by curl smoke tests + paste-text UI)
      const j = await req.json();
      filename = String(j.filename || "rule");
      body = String(j.body || "");
      if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
        return NextResponse.json({ error: `body too large (>${MAX_BYTES} bytes)` }, { status: 413 });
      }
    } else {
      return NextResponse.json({ error: "Content-Type must be multipart/form-data or application/json" }, { status: 415 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "could not parse upload" }, { status: 400 });
  }

  if (!body.trim()) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }

  const inf = await inferUpload(filename, body);

  const row = await prisma.uploadedDetection.create({
    data: {
      filename: filename.slice(0, 240),
      format: inf.format,
      rawContent: body,
      parsedTechniques: JSON.stringify(inf.techniques),
      parsedTactics: JSON.stringify(inf.tactics),
      parsedLogsource: inf.logsource.slice(0, 500),
      inferredMappings: JSON.stringify(inf.mappings),
      uploadedBy: sessionUser?.email || "",
    },
  });

  void logEvent({
    category: "usecase", action: "usecase.upload",
    actor: sessionUser?.email || "anonymous", status: "ok",
    durationMs: Date.now() - t0,
    targetType: "UploadedDetection", targetId: row.id,
    message: `${inf.format} · ${inf.techniques.length} technique(s) · ${inf.mappings.atomic.length}+${inf.mappings.purplesharp.length}+${inf.mappings.stratus.length} suggestions`,
    details: {
      format: inf.format, confidence: inf.formatConfidence,
      techniques: inf.techniques,
      atomicSuggestions: inf.mappings.atomic.length,
      purplesharpSuggestions: inf.mappings.purplesharp.length,
      stratusSuggestions: inf.mappings.stratus.length,
      filename,
    },
  });

  return NextResponse.json({
    id: row.id,
    filename: row.filename,
    format: inf.format,
    formatConfidence: inf.formatConfidence,
    formatReason: inf.formatReason,
    techniques: inf.techniques,
    tactics: inf.tactics,
    logsource: inf.logsource,
    summary: inf.summary,
    mappings: inf.mappings,
  });
}
