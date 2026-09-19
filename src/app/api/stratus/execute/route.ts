/**
 * POST /api/stratus/execute
 *
 * Body: {
 *   useCaseId?: string,
 *   stepId?: string,
 *   attackId: string,
 *   phase: "warmup" | "detonate" | "cleanup" | "dry-run",
 *   credentialId?: string,
 *   confirmDetonate?: boolean         // required when phase === "detonate"
 * }
 *
 * Returns the StratusExecution row once the spawn finishes (synchronous so
 * callers can show a status banner). For long-running cases the client can
 * separately GET /api/stratus/executions?attackId=... to poll history.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runStratus } from "@/lib/stratus/runner";
import { detectStratusCli } from "@/lib/stratus/binary";
import { logEvent } from "@/lib/event-log";
import { requireUser } from "@/lib/auth-guard";

const VALID_PHASES = ["warmup", "detonate", "cleanup", "dry-run"] as const;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const attackId = String(body.attackId || "");
  const phase = String(body.phase || "") as typeof VALID_PHASES[number];
  const credentialId = body.credentialId ? String(body.credentialId) : undefined;
  const useCaseId = body.useCaseId ? String(body.useCaseId) : undefined;
  const stepId = body.stepId ? String(body.stepId) : undefined;
  const confirmDetonate = !!body.confirmDetonate;

  if (!attackId) {
    return NextResponse.json({ error: "attackId is required" }, { status: 400 });
  }
  if (!VALID_PHASES.includes(phase)) {
    return NextResponse.json({ error: `phase must be one of ${VALID_PHASES.join("|")}` }, { status: 400 });
  }
  // Safety: detonate is the only destructive phase. Require explicit confirm.
  if (phase === "detonate" && !confirmDetonate) {
    return NextResponse.json({
      error: "Detonation requires confirmDetonate=true. Add it to the body to acknowledge that this will execute against your live cloud account.",
    }, { status: 400 });
  }

  // Up-front existence check on the attack id so we error early
  const attack = await prisma.stratusAttack.findUnique({ where: { attackId } });
  if (!attack) {
    return NextResponse.json({ error: `unknown attackId: ${attackId}` }, { status: 404 });
  }

  // When enforcing, the caller must own the cloud credential being detonated against.
  if (credentialId) {
    const cred = await prisma.cloudCredential.findUnique({ where: { id: credentialId } });
    if (!cred) return NextResponse.json({ error: "unknown credentialId" }, { status: 404 });
    if (auth.enforced && cred.ownerId !== auth.user.id) {
      return NextResponse.json({ error: "not authorized for this credential" }, { status: 403 });
    }
  }

  const exec = await prisma.stratusExecution.create({
    data: {
      useCaseId: useCaseId || null,
      stepId: stepId || null,
      attackId,
      credentialId: credentialId || null,
      phase,
      status: "queued",
      actor: auth.user.email,
    },
  });

  void logEvent({
    category: "usecase", action: "usecase.stratus.execute",
    actor: auth.user.email, status: "info",
    targetType: "StratusExecution", targetId: exec.id,
    message: `${phase} ${attackId}`,
    details: { useCaseId, stepId, credentialId, phase, attackId },
  });

  // Run synchronously so the client gets the final state.
  const result = await runStratus({
    executionId: exec.id,
    attackId, phase, credentialId,
  });

  void logEvent({
    category: "usecase", action: "usecase.stratus.execute",
    actor: auth.user.email,
    status: result.status === "success" ? "ok" : "error",
    targetType: "StratusExecution", targetId: exec.id,
    durationMs: result.durationMs,
    message: `${phase} ${attackId} → ${result.status} (exit ${result.exitCode})`,
    details: { exitCode: result.exitCode, status: result.status },
  });

  const fresh = await prisma.stratusExecution.findUnique({ where: { id: exec.id } });
  return NextResponse.json({ execution: fresh, result });
}

export async function GET() {
  // Tiny status surface for the UI to read.
  const info = await detectStratusCli();
  return NextResponse.json({
    binary: info.binary,
    version: info.version,
    found: info.found,
    installHint: info.found ? null : info.installHint,
    searchedPaths: info.searchedPaths,
  });
}
