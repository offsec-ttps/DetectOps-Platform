/**
 * GET  /api/c2 — list the user's C2 servers (+ live provider catalog)
 * POST /api/c2 — register a C2 server: mode="connect" (bring-your-own URL+key)
 *                or mode="managed" (platform-deployed Docker container).
 *
 * Dashboard-facing (session-gated). On a healthy connect / successful managed
 * deploy the server is bridged into the simulation pipeline via a backing
 * EnvironmentTarget (see lib/c2/register.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { encrypt } from "@/lib/crypto/credential-vault";
import { getProvider, listProviders } from "@/lib/c2/registry";
import { registerC2AsEnvironmentTarget } from "@/lib/c2/register";
import { C2_CATALOG, getC2CatalogEntry } from "@/config/c2-catalog";
import { localDeployAvailable } from "@/lib/deploy/mode";
import { logEvent } from "@/lib/event-log";
import { serializeC2 } from "@/lib/c2/http";
import { liveC2Status } from "@/lib/c2/liveness";
import { checkC2Url, isSafeGroup, isSafeHost } from "@/lib/c2/url-guard";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const where = auth.enforced ? { ownerId: auth.user.id } : {};
  const servers = await prisma.c2Server.findMany({ where, orderBy: { createdAt: "desc" } });

  // Reflect REAL liveness (a stopped/dead server must not read "running"). Probe
  // in parallel with a short timeout; persist any status transition.
  const live = await Promise.all(servers.map(async (s) => {
    const effective = await liveC2Status(s).catch(() => null);
    if (effective && effective !== s.status) {
      await prisma.c2Server.update({
        where: { id: s.id },
        data: { status: effective, lastError: effective === "offline" || effective === "stopped" ? (s.lastError || "unreachable") : "" },
      }).catch(() => {});
      return { ...s, status: effective };
    }
    return s;
  }));

  return NextResponse.json({
    providers: listProviders(),
    // Full curated framework catalog (Caldera + open-source + commercial). The
    // `available` flag already reflects per-framework deploy readiness; the UI
    // additionally greys out managed deploy when localDeployAvailable is false.
    catalog: C2_CATALOG,
    localDeployAvailable: localDeployAvailable(),
    items: live.map(serializeC2),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const provider = String(body.provider || "caldera").trim();
  const mode = String(body.mode || "connect").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const prov = getProvider(provider);
  const entry = getC2CatalogEntry(provider);
  if (!prov && !entry) return NextResponse.json({ error: `unknown C2 framework "${provider}"` }, { status: 400 });
  if (mode !== "connect" && mode !== "managed") return NextResponse.json({ error: 'mode must be "connect" or "managed"' }, { status: 400 });

  // Connect (bring-your-own URL+key) needs a wired provider with a health check —
  // only Caldera today. Docker-catalog frameworks are Deploy-only for now.
  if (mode === "connect" && (!prov || !prov.available)) {
    return NextResponse.json({ error: `Connect isn't supported for "${provider}" yet — use Deploy, or connect a Caldera server.` }, { status: 400 });
  }

  const dupe = await prisma.c2Server.findUnique({ where: { name } });
  if (dupe) return NextResponse.json({ error: `a C2 server named "${name}" already exists` }, { status: 409 });

  const group = String(body.group || "red").slice(0, 120) || "red";
  // group is embedded in the beacon one-liner; keep it to a safe token.
  if (!isSafeGroup(group)) return NextResponse.json({ error: "group may contain only letters, digits, . _ -" }, { status: 400 });
  const agentPlatform = String(body.agentPlatform || "").slice(0, 24);
  if (agentPlatform && !["windows", "linux", "darwin"].includes(agentPlatform)) {
    return NextResponse.json({ error: 'agentPlatform must be "windows", "linux" or "darwin"' }, { status: 400 });
  }

  // ── Connect (bring-your-own) ──
  if (mode === "connect") {
    const rawUrl = String(body.url || "").trim().replace(/\/+$/, "");
    const apiKey = String(body.apiKey || "").trim();
    if (!rawUrl) return NextResponse.json({ error: "url is required for connect mode" }, { status: 400 });
    // SSRF guard: http(s) only, no embedded creds, no cloud-metadata hosts.
    const checked = checkC2Url(rawUrl);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const url = checked.url;
    if (!apiKey) return NextResponse.json({ error: "apiKey is required for connect mode" }, { status: 400 });

    let apiKeyEnc: string;
    try { apiKeyEnc = encrypt(apiKey); }
    catch (e: any) { return NextResponse.json({ error: `API key encryption failed: ${e?.message || e}` }, { status: 500 }); }

    let server = await prisma.c2Server.create({
      data: { name, provider, mode, url, apiKeyEnc, group, agentPlatform, ownerId: auth.user.id, status: "unknown" },
    });

    // Immediate health probe so the UI reflects reality; never fatal to creation.
    // prov is guaranteed non-null here (connect mode is guarded above).
    const health = await prov!.health(server).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    const envId = health.ok ? await registerC2AsEnvironmentTarget(server).catch(() => null) : null;
    server = await prisma.c2Server.update({
      where: { id: server.id },
      data: {
        status: health.ok ? "online" : "error",
        lastError: health.ok ? "" : (health.error || "unreachable").slice(0, 500),
        lastSeen: health.ok ? new Date() : null,
        environmentTargetId: envId || server.environmentTargetId,
      },
    });
    void logEvent({
      category: "bas", action: "c2.connect", actor: auth.user.email, status: health.ok ? "ok" : "warn",
      targetType: "C2Server", targetId: server.id, message: `${provider} connect "${name}" → ${health.ok ? "online" : "error"}`,
    });
    return NextResponse.json({ server: serializeC2(server), health });
  }

  // ── Managed (platform-deployed) ──
  // Deploy method comes from the catalog: "provider" → a wired C2Provider
  // (Caldera, full pipeline); "docker" → the generic first-wave engine. Anything
  // else (manual/none) is template-only and not auto-deployable yet.
  const method = entry?.deploy.method ?? (prov?.canDeploy ? "provider" : "none");
  if (method === "provider" && !prov?.canDeploy) {
    return NextResponse.json({ error: `${prov?.displayName || provider} does not support managed deploy` }, { status: 400 });
  }
  if (method !== "provider" && method !== "docker") {
    return NextResponse.json({ error: `"${entry?.name || provider}" is template-only right now — follow its guided deploy steps and the C2 Matrix how-to.` }, { status: 400 });
  }
  if (!localDeployAvailable()) {
    return NextResponse.json({ error: "Managed C2 deploy is available on self-hosted installs only (set PLATFORM_MODE=self-hosted). Use Connect instead." }, { status: 400 });
  }

  const advertiseHost = String(body.advertiseHost || "").trim().slice(0, 120);
  if (advertiseHost && !isSafeHost(advertiseHost)) {
    return NextResponse.json({ error: "advertiseHost must be a hostname or IP address" }, { status: 400 });
  }
  const server = await prisma.c2Server.create({
    data: { name, provider, mode, group, agentPlatform, advertiseHost, ownerId: auth.user.id, status: "installing" },
  });
  void logEvent({
    category: "bas", action: "c2.deploy.start", actor: auth.user.email, status: "ok",
    targetType: "C2Server", targetId: server.id, message: `${provider} managed deploy "${name}" started`,
  });

  // Fire-and-forget install (clone + build/pull, left STOPPED). The client polls
  // GET /api/c2/[id]; status goes installing → installed. The server only goes
  // live when the user clicks Start (see lifecycle route).
  void (async () => {
    try {
      const res = method === "docker"
        ? await (await import("@/lib/c2/deploy-generic")).deployGeneric(provider, { name, advertiseHost, ownerId: auth.user.id })
        : await prov!.deploy!({ name, advertiseHost, ownerId: auth.user.id });
      const apiKeyEnc = encrypt(res.apiKey);
      const updated = await prisma.c2Server.update({
        where: { id: server.id },
        data: {
          url: res.url, apiKeyEnc, group: res.group || group, advertiseHost: res.advertiseHost,
          deploymentId: res.deploymentId, adminUser: res.adminUser || "", adminPassword: res.adminPassword ? encrypt(res.adminPassword) : "",   // encrypted at rest
          status: "installed", lastError: "",
        },
      });
      // Bridge into the simulation pipeline now (url+key known); execution just
      // needs the server started first.
      const envId = await registerC2AsEnvironmentTarget(updated).catch(() => null);
      if (envId) await prisma.c2Server.update({ where: { id: server.id }, data: { environmentTargetId: envId } });
    } catch (e: any) {
      await prisma.c2Server.update({ where: { id: server.id }, data: { status: "error", lastError: String(e?.message || e).slice(0, 500) } }).catch(() => {});
    }
  })();

  return NextResponse.json({ server: serializeC2(server) }, { status: 202 });
}
