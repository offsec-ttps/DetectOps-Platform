import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * POST /api/integrations/[id]/sso
 * Initiates SSO login flow — returns the redirect URL for the IdP.
 *
 * For SAML: generates an AuthnRequest and returns the IdP redirect URL.
 * For OIDC: constructs the authorization URL with proper parameters.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const callbackBase = body.callbackUrl || `${req.nextUrl.origin}/api/integrations/${id}/sso`;
  const provider = item.ssoProvider || item.authMethod.replace("_sso", "");

  if (provider === "saml") {
    // SAML SSO — construct AuthnRequest redirect
    const requestId = `_${crypto.randomUUID()}`;
    const issueInstant = new Date().toISOString();
    const acsUrl = item.ssoAcsUrl || `${callbackBase}/callback`;
    const entityId = item.ssoEntityId || `detectops:${item.name.toLowerCase().replace(/\s+/g, "-")}`;

    const authnRequest = Buffer.from(`
      <samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
        ID="${requestId}"
        Version="2.0"
        IssueInstant="${issueInstant}"
        AssertionConsumerServiceURL="${acsUrl}"
        Destination="${item.ssoIdpUrl}">
        <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${entityId}</saml:Issuer>
      </samlp:AuthnRequest>
    `.trim()).toString("base64");

    const redirectUrl = `${item.ssoIdpUrl}?SAMLRequest=${encodeURIComponent(authnRequest)}&RelayState=${encodeURIComponent(id)}`;

    await prisma.integration.update({
      where: { id },
      data: { ssoState: "pending" },
    });

    return NextResponse.json({
      provider: "saml",
      redirectUrl,
      requestId,
      entityId,
      acsUrl,
    });
  }

  if (provider === "oidc") {
    // OIDC SSO — construct authorization URL
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const redirectUri = item.ssoAcsUrl || `${callbackBase}/callback`;
    const scopes = item.ssoScopes || "openid profile email";
    const discoveryUrl = item.ssoIdpUrl;

    // Try to fetch the OIDC discovery document for the authorization endpoint
    let authorizationEndpoint = `${discoveryUrl}/authorize`;
    try {
      const discoRes = await fetch(`${discoveryUrl}/.well-known/openid-configuration`);
      if (discoRes.ok) {
        const disco = await discoRes.json();
        authorizationEndpoint = disco.authorization_endpoint || authorizationEndpoint;
      }
    } catch { /* use default */ }

    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", item.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("nonce", nonce);

    await prisma.integration.update({
      where: { id },
      data: {
        ssoState: "pending",
        extraConfig: JSON.stringify({
          ...JSON.parse(item.extraConfig || "{}"),
          sso_state: state,
          sso_nonce: nonce,
        }),
      },
    });

    return NextResponse.json({
      provider: "oidc",
      redirectUrl: authUrl.toString(),
      state,
      redirectUri,
      scopes,
    });
  }

  return NextResponse.json({ error: `Unsupported SSO provider: ${provider}` }, { status: 400 });
}

/**
 * PUT /api/integrations/[id]/sso
 * Simulates completing the SSO callback — in production this would verify
 * the SAML assertion or exchange the OIDC authorization code for tokens.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { email, status } = body;

  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.integration.update({
    where: { id },
    data: {
      ssoState: status || "authenticated",
      ssoLastLoginAt: new Date(),
      ssoUserEmail: email || "",
      connected: status === "authenticated",
      enabled: status === "authenticated",
      lastTestedAt: new Date(),
      lastError: status === "failed" ? "SSO authentication failed" : null,
    },
  });

  return NextResponse.json({ success: true, status: status || "authenticated" });
}
