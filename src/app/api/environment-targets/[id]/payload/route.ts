/**
 * POST /api/environment-targets/[id]/payload
 *
 * Multipart upload of a shell payload artefact for a `kind=shell` env. The
 * payload bytes are stored under .uploads/enterprise-payloads/<sha256><ext>;
 * the env row's `payloadRef` is updated to `sha256:<hash><ext>` so the
 * future shell runner can fetch the bytes back.
 *
 * Limits: 8 MB · whitelist of extensions (see payload-store.ts).
 *
 * Errors:
 *   400 — bad request (no file, wrong env kind, bad extension, too large)
 *   404 — env not found
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { savePayload, payloadRef, getMaxBytes, isAllowedExtension } from "@/lib/enterprise-use-cases/payload-store";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const env = await prisma.environmentTarget.findUnique({ where: { id } });
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, env.ownerId);
  if (!owns.ok) return owns.response;
  if (env.kind !== "shell") {
    return NextResponse.json({
      error: `payload upload only valid for kind=shell envs; this env is kind=${env.kind}`,
    }, { status: 400 });
  }

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 415 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "field 'file' is required" }, { status: 400 });
  }
  if (file.size > getMaxBytes()) {
    return NextResponse.json({ error: `payload too large (max ${getMaxBytes()} bytes, got ${file.size})` }, { status: 400 });
  }
  if (!isAllowedExtension(file.name)) {
    return NextResponse.json({ error: `extension not allowed; supported: .ps1 .sh .py .bat .vbs .exe .bin .dll .raw .b64 .txt` }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let saved: Awaited<ReturnType<typeof savePayload>>;
  try { saved = await savePayload(file.name, buf); }
  catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 400 });
  }

  const ref = payloadRef(saved);
  await prisma.environmentTarget.update({
    where: { id },
    data: { payloadRef: ref, payloadKind: env.payloadKind || inferPayloadKind(saved.ext) },
  });

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.environment.payload",
    actor: auth.user.email,
    status: "ok",
    targetType: "EnvironmentTarget",
    targetId: id,
    message: `${saved.filename} (${saved.sizeBytes} bytes) sha256=${saved.sha256.slice(0, 16)}…`,
    details: { sha256: saved.sha256, sizeBytes: saved.sizeBytes, ext: saved.ext, payloadRef: ref },
  });

  return NextResponse.json({
    sha256: saved.sha256,
    sizeBytes: saved.sizeBytes,
    ext: saved.ext,
    storedAt: saved.storedAt,
    filename: saved.filename,
    payloadRef: ref,
  });
}

function inferPayloadKind(ext: string): "script" | "binary" | "inline" {
  if (ext === ".exe" || ext === ".dll" || ext === ".bin") return "binary";
  if (ext === ".ps1" || ext === ".sh" || ext === ".py" || ext === ".bat" || ext === ".vbs") return "script";
  return "inline";
}
