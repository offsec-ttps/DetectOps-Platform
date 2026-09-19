import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const items = await prisma.integration.findMany({ orderBy: { name: "asc" } });
  const parsed = items.map((i) => ({ ...i, extraConfig: JSON.parse(i.extraConfig) }));
  return NextResponse.json({ items: parsed, total: parsed.length });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, type, authMethod, apiUrl, apiKey, clientId, clientSecret, mcpServerUrl, username, password, ssoProvider, ssoIdpUrl, ssoEntityId, ssoAcsUrl, ssoCertificate, ssoScopes, extraConfig, enabled } = body;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await prisma.integration.findUnique({ where: { name } });
  if (existing) {
    const updated = await prisma.integration.update({
      where: { name },
      data: {
        type: type || existing.type,
        authMethod: authMethod || existing.authMethod,
        apiUrl: apiUrl ?? existing.apiUrl,
        apiKey: apiKey ?? existing.apiKey,
        clientId: clientId ?? existing.clientId,
        clientSecret: clientSecret ?? existing.clientSecret,
        mcpServerUrl: mcpServerUrl ?? existing.mcpServerUrl,
        username: username ?? existing.username,
        password: password ?? existing.password,
        ssoProvider: ssoProvider ?? existing.ssoProvider,
        ssoIdpUrl: ssoIdpUrl ?? existing.ssoIdpUrl,
        ssoEntityId: ssoEntityId ?? existing.ssoEntityId,
        ssoAcsUrl: ssoAcsUrl ?? existing.ssoAcsUrl,
        ssoCertificate: ssoCertificate ?? existing.ssoCertificate,
        ssoScopes: ssoScopes ?? existing.ssoScopes,
        extraConfig: extraConfig ? JSON.stringify(extraConfig) : existing.extraConfig,
        enabled: enabled ?? existing.enabled,
      },
    });
    return NextResponse.json(updated);
  }

  const integration = await prisma.integration.create({
    data: {
      name,
      type: type || "",
      authMethod: authMethod || "api_key",
      apiUrl: apiUrl || "",
      apiKey: apiKey || "",
      clientId: clientId || "",
      clientSecret: clientSecret || "",
      mcpServerUrl: mcpServerUrl || "",
      username: username || "",
      password: password || "",
      ssoProvider: ssoProvider || "",
      ssoIdpUrl: ssoIdpUrl || "",
      ssoEntityId: ssoEntityId || "",
      ssoAcsUrl: ssoAcsUrl || "",
      ssoCertificate: ssoCertificate || "",
      ssoScopes: ssoScopes || "",
      extraConfig: JSON.stringify(extraConfig || {}),
      enabled: enabled || false,
    },
  });
  return NextResponse.json(integration, { status: 201 });
}
