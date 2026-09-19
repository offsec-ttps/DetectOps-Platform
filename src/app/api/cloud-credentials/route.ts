/**
 * GET  /api/cloud-credentials             — list (returns metadata only)
 * POST /api/cloud-credentials             — create (encrypts secret material)
 *
 * GET responses NEVER include `accessKeyId` / `secretKey` / `sessionToken`;
 * the runner reads them through the dedicated execute path.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, vaultSource, tailHint } from "@/lib/crypto/credential-vault";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";

const SUPPORTED_PROVIDERS = ["aws", "azure", "gcp", "kubernetes", "entra-id"];

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // When enforcing, scope to the caller's own credentials (multi-tenant); dev
  // shows all so existing local data stays visible.
  const where = auth.enforced ? { ownerId: auth.user.id } : {};

  const rows = await prisma.cloudCredential.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, provider: true, label: true,
      accessKeyId: true, sessionToken: true,
      configJson: true, ownerId: true,
      lastUsedAt: true, createdAt: true, updatedAt: true,
    },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      hasAccessKey: !!r.accessKeyId,
      accessKeyTail: tailHint(r.accessKeyId, 4),
      hasSessionToken: !!r.sessionToken,
      configJson: r.configJson,
      ownerId: r.ownerId,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    vaultSource: vaultSource(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || "").toLowerCase();
  const label = String(body.label || "").trim();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `provider must be one of ${SUPPORTED_PROVIDERS.join("|")}` }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  const accessKeyId  = String(body.accessKeyId  || "");
  const secretKey    = String(body.secretKey    || "");
  const sessionToken = String(body.sessionToken || "");
  const configJson   = typeof body.configJson === "string" ? body.configJson : JSON.stringify(body.configJson || {});

  try {
    const row = await prisma.cloudCredential.create({
      data: {
        provider, label,
        accessKeyId:  encrypt(accessKeyId),
        secretKey:    encrypt(secretKey),
        sessionToken: encrypt(sessionToken),
        configJson,
        ownerId: auth.user.id,
      },
    });
    void logEvent({
      category: "integration", action: "cloud-credential.create",
      actor: auth.user.email, status: "ok",
      targetType: "CloudCredential", targetId: row.id,
      message: `${provider} · ${label}`,
      details: { provider, label, hasAccessKey: !!accessKeyId, hasSessionToken: !!sessionToken, vaultSource: vaultSource() },
    });
    return NextResponse.json({ id: row.id, provider, label, vaultSource: vaultSource() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
