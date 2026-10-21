import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { requireRole } from "@/lib/auth-guard";
import { safeFetch, labOutboundPolicy } from "@/lib/net/ssrf";

const xmlEsc = (v: unknown) => String(v ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));

/**
 * POST /api/integrations/[id]/sso
 * Initiates SSO login flow — returns the redirect URL for the IdP.
 *
 * For SAML: generates an AuthnRequest and returns the IdP redirect URL.
 * For OIDC: constructs the authorization URL with proper parameters.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  // Only accept a same-origin callback (prevents pointing the ACS / redirect_uri
  // at an attacker host and injecting markup into the AuthnRequest).
  const defaultCb = `${req.nextUrl.origin}/api/integrations/${id}/sso`;
  let callbackBase = defaultCb;
  if (typeof body.callbackUrl === "string") {
    try { if (new URL(body.callbackUrl).origin === req.nextUrl.origin) callbackBase = body.callbackUrl; } catch { /* default */ }
  }
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
        AssertionConsumerServiceURL="${xmlEsc(acsUrl)}"
        Destination="${xmlEsc(item.ssoIdpUrl)}">
        <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${xmlEsc(entityId)}</saml:Issuer>
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
      const discoRes = await safeFetch(`${discoveryUrl}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(8000) }, labOutboundPolicy("INTEGRATIONS_ALLOW_LOOPBACK"));
      if (discoRes.ok) {
        const disco = await discoRes.json();
        const ep = typeof disco.authorization_endpoint === "string" ? disco.authorization_endpoint : "";
        if (/^https?:\/\//i.test(ep)) authorizationEndpoint = ep;
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
  // Unverified "callback" that flips connected/enabled — admin only.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
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
