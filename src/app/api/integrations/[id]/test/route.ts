import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guard";
import https from "https";
import http from "http";
import { assertSafeOutboundUrl, safeLookup, labOutboundPolicy, type OutboundPolicy } from "@/lib/net/ssrf";

// Integration-specific test configs
const TEST_CONFIGS: Record<string, { testPath: string; authStyle: string }> = {
  "Splunk Enterprise": { testPath: "/services/server/info?output_mode=json", authStyle: "bearer" },
  "Microsoft Sentinel": { testPath: "/providers/Microsoft.SecurityInsights?api-version=2023-11-01", authStyle: "bearer" },
  "CrowdStrike Falcon": { testPath: "/sensors/queries/installers/ccid/v1", authStyle: "bearer" },
  "AWS CloudTrail": { testPath: "/", authStyle: "none" },
  "Okta": { testPath: "/api/v1/users/me", authStyle: "ssws" },
  "Palo Alto NGFW": { testPath: "/api/?type=version", authStyle: "pan_key" },
  "Elastic Security": { testPath: "/", authStyle: "apikey" },
  "GitHub Actions": { testPath: "/user", authStyle: "bearer" },
  "Jira": { testPath: "/rest/api/3/myself", authStyle: "basic" },
  "Slack": { testPath: "/auth.test", authStyle: "bearer_post" },
  "SentinelOne": { testPath: "/web/api/v2.1/system/status", authStyle: "apitoken" },
  "Azure AD": { testPath: "/v1.0/organization", authStyle: "bearer" },
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Admin-only, like the sibling integration write routes: this fetches a
  // stored integration's URL using its stored credentials.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const item = await prisma.integration.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const baseUrl = item.apiUrl || "";
  if (!baseUrl && !item.mcpServerUrl) {
    await prisma.integration.update({
      where: { id },
      data: { connected: false, lastTestedAt: new Date(), lastError: "No API URL configured" },
    });
    return NextResponse.json({
      success: false, message: "No API URL configured",
      response: { status: 0, body: null, headers: {} },
    });
  }

  const config = TEST_CONFIGS[item.name] || { testPath: "/", authStyle: "bearer" };
  const testUrl = `${baseUrl}${config.testPath}`;

  // Build auth headers
  const headers: Record<string, string> = {
    "User-Agent": "DetectOps/1.0",
    "Accept": "application/json",
  };
  const method = config.authStyle === "bearer_post" ? "POST" : "GET";

  switch (config.authStyle) {
    case "bearer":
      if (item.apiKey) headers["Authorization"] = `Bearer ${item.apiKey}`;
      break;
    case "ssws":
      if (item.apiKey) headers["Authorization"] = `SSWS ${item.apiKey}`;
      break;
    case "apikey":
      if (item.apiKey) headers["Authorization"] = `ApiKey ${item.apiKey}`;
      break;
    case "apitoken":
      if (item.apiKey) headers["Authorization"] = `APIToken ${item.apiKey}`;
      break;
    case "basic":
      if (item.username && item.apiKey) {
        headers["Authorization"] = `Basic ${Buffer.from(`${item.username}:${item.apiKey}`).toString("base64")}`;
      }
      break;
    case "bearer_post":
      if (item.apiKey) headers["Authorization"] = `Bearer ${item.apiKey}`;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      break;
    case "pan_key":
      // PAN-OS sends key as query param — already in testPath
      break;
  }

  // SSRF guard: lab tools (Splunk on 10.x) are legitimate, cloud metadata /
  // link-local never are; loopback only in dev or INTEGRATIONS_ALLOW_LOOPBACK=1.
  const policy = labOutboundPolicy("INTEGRATIONS_ALLOW_LOOPBACK");
  const chk = await assertSafeOutboundUrl(testUrl, policy);
  if (!chk.ok) {
    const msg = `Blocked outbound request: ${chk.error}`;
    await prisma.integration.update({ where: { id }, data: { connected: false, lastTestedAt: new Date(), lastError: msg } });
    return NextResponse.json({ success: false, message: msg, response: { status: 0, body: null, headers: {} } }, { status: 400 });
  }

  try {
    const result = await makeRequest(testUrl, method, headers, policy);

    let success = result.status >= 200 && result.status < 400;
    let errorDetail = "";

    // Slack returns HTTP 200 but {"ok":false} for auth failures
    if (success && item.name === "Slack") {
      try {
        const slackBody = JSON.parse(result.body);
        if (slackBody.ok === false) {
          success = false;
          errorDetail = slackBody.error || "Authentication failed";
        }
      } catch { /* not JSON */ }
    }

    if (!success) {
      // Parse error details from response body
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.message) errorDetail = parsed.message;
        else if (parsed.error) errorDetail = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
        else if (parsed.messages) errorDetail = parsed.messages.map((m: any) => m.text || m.message || m).join("; ");
        else if (parsed.errorMessage) errorDetail = parsed.errorMessage;
        else if (parsed.error_description) errorDetail = parsed.error_description;
        else errorDetail = result.body.substring(0, 300);
      } catch {
        errorDetail = result.body.substring(0, 300);
      }
    }

    // Try to extract useful info from successful response
    let successInfo = "";
    if (success) {
      try {
        const parsed = JSON.parse(result.body);
        // GitHub
        if (parsed.login) successInfo = `Authenticated as: ${parsed.login}`;
        // Splunk
        else if (parsed.entry?.[0]?.content?.serverName) successInfo = `Server: ${parsed.entry[0].content.serverName} v${parsed.entry[0].content.version}`;
        // Okta
        else if (parsed.profile?.email) successInfo = `User: ${parsed.profile.email}`;
        // Jira
        else if (parsed.emailAddress) successInfo = `User: ${parsed.displayName} (${parsed.emailAddress})`;
        // Slack
        else if (parsed.user) successInfo = `Team: ${parsed.team} / User: ${parsed.user}`;
        // Elastic
        else if (parsed.cluster_name) successInfo = `Cluster: ${parsed.cluster_name} v${parsed.version?.number}`;
        // SentinelOne
        else if (parsed.data?.health) successInfo = `Health: ${parsed.data.health}`;
        // Azure AD
        else if (parsed.value?.[0]?.displayName) successInfo = `Org: ${parsed.value[0].displayName}`;
        // Generic
        else if (parsed.ok === true) successInfo = "API responded OK";
      } catch { /* not JSON — still success */ }
    }

    const message = success
      ? `Connected to ${item.name}${successInfo ? ` — ${successInfo}` : ""}`
      : `${item.name} returned HTTP ${result.status}${errorDetail ? `: ${errorDetail}` : ""}`;

    await prisma.integration.update({
      where: { id },
      data: {
        connected: success,
        lastTestedAt: new Date(),
        lastError: success ? null : message,
      },
    });

    return NextResponse.json({
      success,
      message,
      response: {
        status: result.status,
        statusText: result.statusText,
        headers: result.responseHeaders,
        body: success ? (successInfo || "OK") : errorDetail || result.body.substring(0, 500),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let userMessage = msg;

    if (msg.includes("ECONNREFUSED")) userMessage = `Connection refused — is ${item.name} running at ${baseUrl}?`;
    else if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) userMessage = `Connection timed out — check that ${baseUrl} is reachable`;
    else if (msg.includes("ENOTFOUND")) userMessage = `DNS resolution failed — hostname not found for ${baseUrl}`;
    else if (msg.includes("CERT_")) userMessage = `TLS certificate error — ${msg}. Try with a valid certificate or allow self-signed certs.`;
    else if (msg.includes("UNABLE_TO_VERIFY")) userMessage = `SSL verification failed for ${baseUrl}`;

    await prisma.integration.update({
      where: { id },
      data: { connected: false, lastTestedAt: new Date(), lastError: userMessage },
    });

    return NextResponse.json({
      success: false,
      message: userMessage,
      response: { status: 0, body: msg, headers: {} },
    });
  }
}

const MAX_BODY = 256 * 1024;

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  policy: OutboundPolicy,
): Promise<{ status: number; statusText: string; body: string; responseHeaders: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        rejectUnauthorized: false, // Accept self-signed certs
        lookup: safeLookup(policy) as any, // re-check the IP actually connected to (DNS rebinding)
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY) { body = body.slice(0, MAX_BODY); res.destroy(); }
        });
        res.on("close", () => resolve({ status: res.statusCode || 0, statusText: res.statusMessage || "", body, responseHeaders: {} }));
        res.on("end", () => {
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") responseHeaders[k] = v;
          }
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            body,
            responseHeaders,
          });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("Connection timed out after 15s")); });
    req.end();
  });
}
