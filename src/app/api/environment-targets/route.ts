/**
 * GET  /api/environment-targets — list with kind filter + counts
 * POST /api/environment-targets — create new env (encrypts agent token before persist)
 *
 * Body shape varies by kind; this route validates the minimal required fields
 * per kind and rejects 400 otherwise:
 *
 *   our-template-deployed: name, kind, hostname, sshUser  (sshKeyRef optional)
 *   user-cloud           : name, kind, cloudProvider, credentialId
 *   agent                : name, kind, agentEnrollmentToken
 *   shell                : name, kind, shellMode (reverse|bind), listenerHost, listenerPort
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/credential-vault";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { checkC2Url, isSafeHost, isSafeSshUser } from "@/lib/c2/url-guard";

const ENV_KINDS = new Set(["our-template-deployed", "user-cloud", "agent", "shell"]);
const SHELL_MODES = new Set(["reverse", "bind"]);
const CLOUD_PROVIDERS = new Set(["aws", "azure", "gcp"]);

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") || "";
  const enabledOnly = sp.get("enabled") === "true";
  const where: Record<string, unknown> = {};
  if (kind) where.kind = kind;
  if (enabledOnly) where.enabled = true;
  if (auth.enforced) where.ownerId = auth.user.id;   // tenant-scope the list

  const rows = await prisma.environmentTarget.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
  });

  // Aggregate counts per kind for the UI chip strip
  const byKind = await prisma.environmentTarget.groupBy({
    by: ["kind"],
    _count: true,
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      templateRef: r.templateRef,
      cloudProvider: r.cloudProvider,
      shellMode: r.shellMode,
      description: r.description,
      hostname: r.hostname,
      port: r.port,
      region: r.region,
      credentialId: r.credentialId,
      sshUser: r.sshUser,
      sshKeyRef: r.sshKeyRef,
      hasAgentToken: r.agentEnrollmentToken.length > 0,
      listenerHost: r.listenerHost,
      listenerPort: r.listenerPort,
      payloadKind: r.payloadKind,
      payloadRef: r.payloadRef,
      enabled: r.enabled,
      lastSeenAt: r.lastSeenAt,
      lastError: r.lastError,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    counts: byKind.map((g) => ({ kind: g.kind, count: g._count })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const sessionUser = auth.user;

  const body = await req.json().catch(() => ({}));

  const name = String(body.name || "").trim();
  const kind = String(body.kind || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!ENV_KINDS.has(kind)) return NextResponse.json({ error: `kind must be one of ${[...ENV_KINDS].join("|")}` }, { status: 400 });

  // Per-kind required fields
  if (kind === "our-template-deployed") {
    if (!body.hostname) return NextResponse.json({ error: "hostname is required for our-template-deployed" }, { status: 400 });
    if (!body.sshUser) return NextResponse.json({ error: "sshUser is required for our-template-deployed" }, { status: 400 });
    // These reach the ssh argv on the platform host — reject option-like / shell-y values.
    if (!isSafeHost(String(body.hostname))) return NextResponse.json({ error: "hostname must be a plain hostname or IP address" }, { status: 400 });
    if (!isSafeSshUser(String(body.sshUser))) return NextResponse.json({ error: "sshUser contains disallowed characters" }, { status: 400 });
    if (body.sshKeyRef && String(body.sshKeyRef).startsWith("-")) return NextResponse.json({ error: "sshKeyRef must be a file path" }, { status: 400 });
  } else if (kind === "user-cloud") {
    if (!body.cloudProvider || !CLOUD_PROVIDERS.has(body.cloudProvider)) {
      return NextResponse.json({ error: `cloudProvider must be one of ${[...CLOUD_PROVIDERS].join("|")}` }, { status: 400 });
    }
    if (!body.credentialId) return NextResponse.json({ error: "credentialId is required for user-cloud" }, { status: 400 });
    // Verify the credential exists AND belongs to the caller — otherwise an env
    // could borrow another user's cloud credential to run Stratus detonations.
    const cred = await prisma.cloudCredential.findUnique({ where: { id: String(body.credentialId) } });
    if (!cred) return NextResponse.json({ error: "credentialId points at a missing CloudCredential" }, { status: 400 });
    if (!ownsOr404(auth, cred.ownerId).ok) {
      return NextResponse.json({ error: "credentialId points at a missing CloudCredential" }, { status: 400 });
    }
  } else if (kind === "agent") {
    const backend = String(body.agentBackend || "native-fleet");
    if (backend === "caldera") {
      if (!body.calderaUrl || !String(body.calderaUrl).trim()) return NextResponse.json({ error: "calderaUrl is required for a Caldera agent env" }, { status: 400 });
      if (!body.calderaApiKey || !String(body.calderaApiKey).trim()) return NextResponse.json({ error: "calderaApiKey is required for a Caldera agent env" }, { status: 400 });
      const checked = checkC2Url(String(body.calderaUrl));
      if (!checked.ok) return NextResponse.json({ error: `calderaUrl: ${checked.error}` }, { status: 400 });
    } else if (!body.agentEnrollmentToken || !String(body.agentEnrollmentToken).trim()) {
      return NextResponse.json({ error: "agentEnrollmentToken is required for a native-fleet agent env" }, { status: 400 });
    }
  } else if (kind === "shell") {
    if (!body.shellMode || !SHELL_MODES.has(body.shellMode)) {
      return NextResponse.json({ error: `shellMode must be one of ${[...SHELL_MODES].join("|")}` }, { status: 400 });
    }
    if (!body.listenerHost) return NextResponse.json({ error: "listenerHost is required for shell" }, { status: 400 });
    if (!body.listenerPort) return NextResponse.json({ error: "listenerPort is required for shell" }, { status: 400 });
  }

  // Reject duplicate name
  const dupe = await prisma.environmentTarget.findUnique({ where: { name } });
  if (dupe) return NextResponse.json({ error: `environment named "${name}" already exists` }, { status: 409 });

  // Encrypt agent secrets at rest (native-fleet token and/or Caldera API key)
  let agentEnrollmentToken = "";
  let calderaApiKeyEnc = "";
  const agentBackend = kind === "agent" ? String(body.agentBackend || "native-fleet") : "";
  if (kind === "agent") {
    try {
      if (body.agentEnrollmentToken && String(body.agentEnrollmentToken).trim()) agentEnrollmentToken = encrypt(String(body.agentEnrollmentToken).trim());
      if (agentBackend === "caldera" && body.calderaApiKey) calderaApiKeyEnc = encrypt(String(body.calderaApiKey).trim());
    } catch (err: any) {
      return NextResponse.json({ error: `agent secret encryption failed: ${err?.message || err}` }, { status: 500 });
    }
  }

  try {
    const row = await prisma.environmentTarget.create({
      data: {
        name: name.slice(0, 240),
        kind,
        templateRef: String(body.templateRef || "").slice(0, 240),
        cloudProvider: String(body.cloudProvider || "").slice(0, 24),
        shellMode: String(body.shellMode || "").slice(0, 24),
        description: String(body.description || "").slice(0, 1000),
        hostname: String(body.hostname || "").slice(0, 240),
        port: Number.isFinite(body.port) ? Math.max(0, Math.min(65535, Math.round(body.port))) : 0,
        region: String(body.region || "").slice(0, 64),
        credentialId: body.credentialId ? String(body.credentialId) : null,
        sshUser: String(body.sshUser || "").slice(0, 120),
        sshKeyRef: String(body.sshKeyRef || "").slice(0, 1024),
        agentEnrollmentToken,
        agentBackend: agentBackend || undefined,
        calderaUrl: String(body.calderaUrl || "").slice(0, 512),
        calderaApiKeyEnc,
        calderaGroup: String(body.calderaGroup || "").slice(0, 120) || undefined,
        calderaPaw: String(body.calderaPaw || "").slice(0, 120),
        agentPlatform: String(body.agentPlatform || "").slice(0, 24),
        listenerHost: String(body.listenerHost || "").slice(0, 240),
        listenerPort: Number.isFinite(body.listenerPort) ? Math.max(0, Math.min(65535, Math.round(body.listenerPort))) : 0,
        payloadKind: String(body.payloadKind || "").slice(0, 24),
        payloadRef: String(body.payloadRef || "").slice(0, 240),
        goadInstanceId: body.goadInstanceId ? String(body.goadInstanceId) : null,
        splunkAttackRangeRef: body.splunkAttackRangeRef ? String(body.splunkAttackRangeRef) : null,
        ownerId: sessionUser.id,
        enabled: body.enabled !== false,
      },
    });

    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.environment.create",
      actor: sessionUser?.email || "anonymous",
      status: "ok",
      targetType: "EnvironmentTarget",
      targetId: row.id,
      message: `${name} · kind=${kind}`,
      details: { name, kind, templateRef: row.templateRef, cloudProvider: row.cloudProvider, shellMode: row.shellMode },
    });

    return NextResponse.json({
      id: row.id, name: row.name, kind: row.kind, enabled: row.enabled, createdAt: row.createdAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
