import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { invalidHttpUrl } from "@/lib/net/ssrf";
import { publicIntegration, incomingSecret, incomingString, exfilGuard } from "../_secrets";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(publicIntegration(item));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  for (const k of ["apiUrl", "mcpServerUrl"]) {
    const bad = invalidHttpUrl(body[k], k);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  }
  const guard = exfilGuard(item, body);
  if (guard.error) return NextResponse.json({ error: guard.error }, { status: 400 });

  const data: Record<string, unknown> = {
    authMethod: incomingString(body.authMethod, item.authMethod),
    apiUrl: incomingString(body.apiUrl, item.apiUrl),
    apiKey: incomingSecret(body.apiKey, item.apiKey),
    clientId: incomingString(body.clientId, item.clientId),
    clientSecret: incomingSecret(body.clientSecret, item.clientSecret),
    mcpServerUrl: incomingString(body.mcpServerUrl, item.mcpServerUrl),
    username: incomingString(body.username, item.username),
    password: incomingSecret(body.password, item.password),
    extraConfig: body.extraConfig && typeof body.extraConfig === "object" ? JSON.stringify(body.extraConfig) : item.extraConfig,
    enabled: typeof body.enabled === "boolean" ? body.enabled : item.enabled,
  };
  for (const f of guard.clear) data[f] = "";
  const updated = await prisma.integration.update({ where: { id }, data: data as any });
  return NextResponse.json(publicIntegration(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  await prisma.integration.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
