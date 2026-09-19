/**
 * POST /api/environment-targets/[id]/test
 *
 * Kind-aware reachability probe:
 *   our-template-deployed → SSH `echo` probe (timeout 8s)
 *   user-cloud            → verifies the credentialId resolves to a CloudCredential row
 *   agent                 → reports whether enrollment token is present (stub)
 *   shell                 → reports whether listener host/port + payload are configured (stub)
 *
 * Persists lastSeenAt / lastError on the env row.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { probeEnvironment } from "@/lib/enterprise-use-cases/runner";
import { logEvent } from "@/lib/event-log";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const env = await prisma.environmentTarget.findUnique({ where: { id } });
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, env.ownerId);
  if (!owns.ok) return owns.response;

  const r = await probeEnvironment(env);
  await prisma.environmentTarget.update({
    where: { id },
    data: {
      lastSeenAt: r.ok ? new Date() : env.lastSeenAt,
      lastError: r.ok ? null : r.message.slice(0, 500),
    },
  });

  void logEvent({
    category: "enterprise-uc",
    action: "enterprise-uc.environment.test",
    actor: auth.user.email,
    status: r.ok ? "ok" : "error",
    targetType: "EnvironmentTarget",
    targetId: id,
    durationMs: r.latencyMs,
    message: r.message,
    details: { kind: env.kind, ok: r.ok, latencyMs: r.latencyMs },
  });

  return NextResponse.json({
    ok: r.ok,
    latencyMs: r.latencyMs,
    message: r.message,
    kind: env.kind,
  });
}
