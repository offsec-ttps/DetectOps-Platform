import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import { invalidHttpUrl } from "@/lib/net/ssrf";
import { publicIntegration, incomingSecret, incomingString, exfilGuard } from "./_secrets";

export async function GET() {
  const items = await prisma.integration.findMany({ orderBy: { name: "asc" } });
  // Secrets are never returned — masked + has* flags only.
  const parsed = items.map((i) => publicIntegration(i));
  return NextResponse.json({ items: parsed, total: parsed.length });
}

export async function POST(req: NextRequest) {
  // Integrations are global (shared credentials used by fleets / deploy / SIEM
  // validation) → only admins may create or re-point them.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { name, type, authMethod, extraConfig, enabled } = body;

  if (!name || typeof name !== "string") return NextResponse.json({ error: "name is required" }, { status: 400 });
  for (const k of ["apiUrl", "mcpServerUrl", "ssoIdpUrl"]) {
    const bad = invalidHttpUrl(body[k], k);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  }

  const existing = await prisma.integration.findUnique({ where: { name } });
  if (existing) {
    const guard = exfilGuard(existing, body);
    if (guard.error) return NextResponse.json({ error: guard.error }, { status: 400 });
    const data: Record<string, unknown> = {
      type: typeof type === "string" && type ? type : existing.type,
      authMethod: typeof authMethod === "string" && authMethod ? authMethod : existing.authMethod,
      apiUrl: incomingString(body.apiUrl, existing.apiUrl),
      apiKey: incomingSecret(body.apiKey, existing.apiKey),
      clientId: incomingString(body.clientId, existing.clientId),
      clientSecret: incomingSecret(body.clientSecret, existing.clientSecret),
      mcpServerUrl: incomingString(body.mcpServerUrl, existing.mcpServerUrl),
      username: incomingString(body.username, existing.username),
      password: incomingSecret(body.password, existing.password),
      ssoProvider: incomingString(body.ssoProvider, existing.ssoProvider),
      ssoIdpUrl: incomingString(body.ssoIdpUrl, existing.ssoIdpUrl),
      ssoEntityId: incomingString(body.ssoEntityId, existing.ssoEntityId),
      ssoAcsUrl: incomingString(body.ssoAcsUrl, existing.ssoAcsUrl),
      ssoCertificate: incomingSecret(body.ssoCertificate, existing.ssoCertificate),
      ssoScopes: incomingString(body.ssoScopes, existing.ssoScopes),
      extraConfig: extraConfig && typeof extraConfig === "object" ? JSON.stringify(extraConfig) : existing.extraConfig,
      enabled: typeof enabled === "boolean" ? enabled : existing.enabled,
    };
    for (const f of guard.clear) data[f] = "";
    const updated = await prisma.integration.update({ where: { name }, data: data as any });
    return NextResponse.json(publicIntegration(updated));
  }

  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 2048) : "");
  const integration = await prisma.integration.create({
    data: {
      name: name.slice(0, 240),
      type: str(type),
      authMethod: str(authMethod) || "api_key",
      apiUrl: str(body.apiUrl),
      apiKey: str(body.apiKey),
      clientId: str(body.clientId),
      clientSecret: str(body.clientSecret),
      mcpServerUrl: str(body.mcpServerUrl),
      username: str(body.username),
      password: str(body.password),
      ssoProvider: str(body.ssoProvider),
      ssoIdpUrl: str(body.ssoIdpUrl),
      ssoEntityId: str(body.ssoEntityId),
      ssoAcsUrl: str(body.ssoAcsUrl),
      ssoCertificate: typeof body.ssoCertificate === "string" ? body.ssoCertificate.slice(0, 16384) : "",
      ssoScopes: str(body.ssoScopes),
      extraConfig: JSON.stringify(extraConfig && typeof extraConfig === "object" ? extraConfig : {}),
      enabled: enabled === true,
    },
  });
  return NextResponse.json(publicIntegration(integration), { status: 201 });
}
