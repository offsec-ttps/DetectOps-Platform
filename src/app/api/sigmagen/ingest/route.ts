/**
 * POST /api/sigmagen/ingest
 *
 * Parse-only endpoint — normalises an input and returns a preview so the chat
 * can confirm "parsed your PDF (12 pages)" before the user runs the pipeline.
 * Does NOT run the multi-agent pipeline.
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (PDF / docx / txt)
 *   - JSON: { url } | { text } | { kind: "ioc", text }
 *
 * Returns: { kind, title, charCount, iocCount, previewText, references }
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeInput, iocCount, type IngestRequest } from "@/lib/sigmagen/ingest";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

export async function POST(req: NextRequest) {
  try {
    const ctype = (req.headers.get("content-type") || "").toLowerCase();
    let ingestReq: IngestRequest;

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided in form field 'file'." }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` }, { status: 413 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      ingestReq = { fileBuffer: buf, fileName: file.name, mimeType: file.type };
    } else {
      const body = await req.json().catch(() => ({}));
      ingestReq = {
        kind: body.kind,
        url: typeof body.url === "string" ? body.url : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
      };
    }

    const norm = await normalizeInput(ingestReq);
    return NextResponse.json({
      kind: norm.kind,
      title: norm.title,
      charCount: norm.charCount,
      iocCount: iocCount(norm.iocs),
      iocs: norm.iocs,
      previewText: norm.text.slice(0, 1200),
      references: norm.references.slice(0, 25),
      meta: norm.meta,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Ingestion failed" }, { status: 400 });
  }
}
