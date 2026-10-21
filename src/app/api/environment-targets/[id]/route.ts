/**
 * GET    /api/environment-targets/[id] — detail (never returns agentEnrollmentToken plaintext)
 * PATCH  /api/environment-targets/[id] — update; re-encrypts agentEnrollmentToken if supplied
 * DELETE /api/environment-targets/[id] — hard delete (no FK cascades since runs hold a string)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto/credential-vault";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { payloadMeta } from "@/lib/enterprise-use-cases/payload-store";
import { isSafeHost, isSafeSshUser } from "@/lib/c2/url-guard";

const PATCHABLE = new Set([
  "name", "description", "templateRef", "cloudProvider", "shellMode",
  "hostname", "port", "region", "credentialId", "sshUser", "sshKeyRef",
  "agentEnrollmentToken",
  "listenerHost", "listenerPort", "payloadKind",
  "goadInstanceId", "splunkAttackRangeRef",
  "enabled",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const row = await prisma.environmentTarget.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, row.ownerId);
  if (!owns.ok) return owns.response;

  // Surface payload metadata (sha + size + filename) when there's a stored ref
  let payload = null as null | { sha256: string; sizeBytes: number; ext: string; storedAt: string; filename: string };
  if (row.payloadRef) payload = await payloadMeta(row.payloadRef);

  return NextResponse.json({
    id: row.id,
    name: row.name,
    kind: row.kind,
    templateRef: row.templateRef,
    cloudProvider: row.cloudProvider,
    shellMode: row.shellMode,
    description: row.description,
    hostname: row.hostname,
    port: row.port,
    region: row.region,
    credentialId: row.credentialId,
    sshUser: row.sshUser,
    sshKeyRef: row.sshKeyRef,
    hasAgentToken: row.agentEnrollmentToken.length > 0,
    listenerHost: row.listenerHost,
    listenerPort: row.listenerPort,
    payloadKind: row.payloadKind,
    payloadRef: row.payloadRef,
    payload,
    goadInstanceId: row.goadInstanceId,
    splunkAttackRangeRef: row.splunkAttackRangeRef,
    enabled: row.enabled,
    lastSeenAt: row.lastSeenAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.environmentTarget.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.ownerId);
  if (!owns.ok) return owns.response;

  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue;
    if (k === "agentEnrollmentToken") {
      if (typeof v !== "string") continue;   // never persist a non-string token unencrypted
      if (v.length === 0) { data[k] = ""; continue; }   // explicit clear
      try { data[k] = encrypt(v); } catch (err: any) {
        return NextResponse.json({ error: `agent token encryption failed: ${err?.message || err}` }, { status: 500 });
      }
      continue;
    }
    if (k === "port" || k === "listenerPort") {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      data[k] = Number.isFinite(n) ? Math.max(0, Math.min(65535, Math.round(n))) : 0;
      continue;
    }
    if (k === "enabled") { data[k] = v === true; continue; }
    if (k === "credentialId" && v) {
      // Only attach a cloud credential the caller owns (no borrowing another tenant's keys).
      const cred = await prisma.cloudCredential.findUnique({ where: { id: String(v) }, select: { ownerId: true } });
      if (!cred || !ownsOr404({ user: auth.user, enforced: auth.enforced }, cred.ownerId).ok) {
        return NextResponse.json({ error: "credentialId points at a missing CloudCredential" }, { status: 400 });
      }
    }
    if (k === "credentialId" || k === "goadInstanceId" || k === "splunkAttackRangeRef") {
      data[k] = v ? String(v) : null;
      continue;
    }
    // Everything else is a string column — never let a non-string (object →
    // Prisma operator / relation payload) through.
    const s = typeof v === "string" ? v : v == null ? "" : String(v);
    if (k === "hostname" && s && !isSafeHost(s)) return NextResponse.json({ error: "hostname must be a plain hostname or IP address" }, { status: 400 });
    if (k === "sshUser" && s && !isSafeSshUser(s)) return NextResponse.json({ error: "sshUser contains disallowed characters" }, { status: 400 });
    if (k === "sshKeyRef" && s.startsWith("-")) return NextResponse.json({ error: "sshKeyRef must be a file path" }, { status: 400 });
    data[k] = s.slice(0, k === "description" ? 1000 : k === "sshKeyRef" ? 1024 : 240);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no patchable fields supplied" }, { status: 400 });
  }

  try {
    const updated = await prisma.environmentTarget.update({ where: { id }, data: data as any });
    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.environment.update",
      actor: auth.user.email,
      status: "ok",
      targetType: "EnvironmentTarget",
      targetId: id,
      message: `Updated ${Object.keys(data).filter((k) => k !== "agentEnrollmentToken").join(", ") || "encrypted fields"}`,
      details: { fields: Object.keys(data) },
    });
    return NextResponse.json({ id: updated.id, updated: Object.keys(data) });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (err?.code === "P2002") return NextResponse.json({ error: "environment with that name already exists" }, { status: 409 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.environmentTarget.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, existing.ownerId);
  if (!owns.ok) return owns.response;

  // Guard: refuse if any runs reference this env
  const refCount = await prisma.enterpriseUseCaseRun.count({ where: { environmentId: id } });
  if (refCount > 0) {
    return NextResponse.json({
      error: `cannot delete — ${refCount} run(s) reference this environment. Disable instead.`,
      runCount: refCount,
    }, { status: 409 });
  }
  try {
    await prisma.environmentTarget.delete({ where: { id } });
    void logEvent({
      category: "enterprise-uc",
      action: "enterprise-uc.environment.delete",
      actor: auth.user.email,
      status: "ok",
      targetType: "EnvironmentTarget",
      targetId: id,
      message: "deleted",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "P2025") return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
