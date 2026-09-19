/**
 * GET  /api/siem            — list the user's SIEM connections (+ provider catalog)
 * POST /api/siem            — create a connection (secrets AES-GCM encrypted)
 *
 * Splunk: { kind:"splunk", url, authMode:"token"|"basic", username?, token?|password? }
 * MDE:    { kind:"mde", tenantId, clientId, clientSecret }
 * Common: { name, scope, targetRef?, isDefault? }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { encrypt } from "@/lib/crypto/credential-vault";
import { getSiemProvider, listSiemProviders } from "@/lib/siem/registry";
import { serializeSiem } from "@/lib/siem/http";
import { logEvent } from "@/lib/event-log";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const scope = req.nextUrl.searchParams.get("scope") || "";
  const where: Record<string, unknown> = auth.enforced ? { ownerId: auth.user.id } : {};
  if (scope) where.scope = { in: [scope, "any"] };
  const rows = await prisma.siemConnection.findMany({ where: where as any, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  return NextResponse.json({ providers: listSiemProviders(), items: rows.map(serializeSiem) });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const name = String(body.name || "").trim();
  const kind = String(body.kind || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!getSiemProvider(kind)) return NextResponse.json({ error: `kind must be splunk | mde` }, { status: 400 });

  const scope = ["local", "cloud", "fleet", "c2", "any"].includes(body.scope) ? body.scope : "any";
  const dupe = await prisma.siemConnection.findUnique({ where: { name } });
  if (dupe) return NextResponse.json({ error: `a SIEM connection named "${name}" already exists` }, { status: 409 });

  const secrets: Record<string, string> = {};
  let url = "", authMode = "token", username = "", tenantId = "", clientId = "";

  if (kind === "splunk") {
    url = String(body.url || "").trim().replace(/\/+$/, "");
    if (!url) return NextResponse.json({ error: "url is required for Splunk" }, { status: 400 });
    authMode = body.authMode === "basic" ? "basic" : "token";
    if (authMode === "token") {
      if (!body.token) return NextResponse.json({ error: "token is required for Splunk token auth" }, { status: 400 });
      secrets.token = String(body.token);
    } else {
      username = String(body.username || "admin");
      if (!body.password) return NextResponse.json({ error: "password is required for Splunk basic auth" }, { status: 400 });
      secrets.password = String(body.password);
    }
  } else {
    // mde
    tenantId = String(body.tenantId || "").trim();
    clientId = String(body.clientId || "").trim();
    authMode = "oauth";
    if (!tenantId || !clientId) return NextResponse.json({ error: "tenantId and clientId are required for MDE" }, { status: 400 });
    if (!body.clientSecret) return NextResponse.json({ error: "clientSecret is required for MDE" }, { status: 400 });
    secrets.clientSecret = String(body.clientSecret);
  }

  let secretsEnc: string;
  try { secretsEnc = encrypt(JSON.stringify(secrets)); }
  catch (e: any) { return NextResponse.json({ error: `secret encryption failed: ${e?.message || e}` }, { status: 500 }); }

  const row = await prisma.siemConnection.create({
    data: {
      name: name.slice(0, 240), kind, scope, targetRef: String(body.targetRef || "").slice(0, 240),
      isDefault: !!body.isDefault, url, authMode, username, tenantId, clientId, secretsEnc,
      ownerId: auth.user.id, status: "unknown",
    },
  });
  void logEvent({
    category: "detection", action: "siem.connect", actor: auth.user.email, status: "ok",
    targetType: "SiemConnection", targetId: row.id, message: `${kind} connection "${name}" (scope ${scope})`,
  });
  return NextResponse.json({ connection: serializeSiem(row) });
}
