import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...item, extraConfig: JSON.parse(item.extraConfig) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.integration.update({
    where: { id },
    data: {
      authMethod: body.authMethod ?? item.authMethod,
      apiUrl: body.apiUrl ?? item.apiUrl,
      apiKey: body.apiKey ?? item.apiKey,
      clientId: body.clientId ?? item.clientId,
      clientSecret: body.clientSecret ?? item.clientSecret,
      mcpServerUrl: body.mcpServerUrl ?? item.mcpServerUrl,
      username: body.username ?? item.username,
      password: body.password ?? item.password,
      extraConfig: body.extraConfig ? JSON.stringify(body.extraConfig) : item.extraConfig,
      enabled: body.enabled ?? item.enabled,
    },
  });
  return NextResponse.json({ ...updated, extraConfig: JSON.parse(updated.extraConfig) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.integration.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
