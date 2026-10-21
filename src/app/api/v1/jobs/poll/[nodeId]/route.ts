/**
 * GET /api/v1/jobs/poll/[nodeId]   (AGENT-FACING — long-poll for the next job)
 *
 * The agent polls this after each heartbeat. Returns the oldest queued
 * FleetOperation for this node that PASSES POLICY (allowed-scope + consent), as
 * a SIGNED job (ed25519). Policy-violating ops are marked "blocked" with a
 * recorded reason and skipped. Returns 204 when nothing runnable.
 *
 * Auth: X-Node-Key header (per-node api_key).
 *
 * The job carries only addressing + a signature — never the raw command. The
 * agent verifies the signature (binding op+node+bundle+scope+consent+expiry),
 * fetches the bundle separately, and re-checks its hash + scope before running.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authNode } from "@/lib/bas/agent-auth";
import { evaluateDispatchPolicy, normalizeScope } from "@/lib/bas/policy";
import { signMessageB64, jobSigningMessage } from "@/lib/bas/signing";
import { logEvent } from "@/lib/event-log";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const JOB_TTL_S = 300;   // signed jobs are valid for 5 minutes (anti-replay)

export async function GET(req: NextRequest, ctx: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await ctx.params;
  const key = req.headers.get("x-node-key") || "";
  const node = await authNode(nodeId, key);
  if (!node) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (node.status === "revoked") return NextResponse.json({ error: "revoked", directives: { terminate: true } }, { status: 401 });

  // The agent's job-poll is its continuous heartbeat: every successful poll marks
  // the node seen + online, so a polling agent is live even if it never calls the
  // separate /node-status endpoint (older/other agent builds). Liveness is then
  // computed from lastSeen age (see lib/bas/fleet.ts nodeLiveness).
  await prisma.fleetNode.update({
    where: { id: nodeId },
    data: { lastSeen: new Date(), status: node.status === "offline" ? "online" : node.status },
  }).catch(() => {});

  // Operator "pause" hold: keep the agent alive (heartbeat above) but hand out no
  // work. Resuming (status→online) lets queued ops flow again on the next poll.
  if (node.status === "paused") return new NextResponse(null, { status: 204 });

  const fleet = await prisma.fleet.findUnique({ where: { id: node.fleetId } });
  if (!fleet) return NextResponse.json({ error: "fleet missing" }, { status: 409 });

  // Walk queued ops oldest-first; block policy violations, hand out the first
  // runnable one as a signed job.
  const queued = await prisma.fleetOperation.findMany({
    where: { nodeId, status: "queued" },
    orderBy: { createdAt: "asc" },
    take: 25,
  });

  for (const op of queued) {
    const data = safeJson<any>(op.data, {});
    const scope = normalizeScope(data.scope || "unspecified");

    const policy = await evaluateDispatchPolicy({ bundleScope: scope, node, fleet });
    if (!policy.ok) {
      // Record the block + skip. Surfaces in the campaign/results UI.
      await prisma.fleetOperation.update({ where: { id: op.id }, data: { status: "blocked" } });
      await prisma.fleetTestRun.create({
        data: {
          operationId: op.id, nodeId, technique: data.technique || "", testIndex: data.testIndex ?? 0,
          bundleHash: data.bundleHash || "", executeStatus: "blocked", cleanupStatus: "ok",
          stderrRef: `policy: ${policy.reason}`.slice(0, 4000), startedAt: op.createdAt, endedAt: new Date(),
        },
      });
      void logEvent({
        category: "bas", action: "bas.policy.block", actor: "control-plane", status: "warn",
        targetType: "FleetOperation", targetId: op.id,
        message: `${node.hostname} · ${data.technique} #${data.testIndex} blocked: ${policy.reason}`,
      });
      continue;
    }

    // Claim + sign.
    // Atomic claim (queued → running): concurrent polls can't both receive the
    // same op, and an op halted/cancelled meanwhile is never handed out.
    const claimed = await prisma.fleetOperation.updateMany({ where: { id: op.id, nodeId, status: "queued" }, data: { status: "running", claimedBy: nodeId } });
    if (claimed.count !== 1) continue;
    await prisma.fleetNode.update({ where: { id: nodeId }, data: { currentRunId: op.id } });

    const notAfter = Math.floor(Date.now() / 1000) + JOB_TTL_S;
    const consentRef = policy.consentRef || "";
    const signature = signMessageB64(jobSigningMessage({
      operationId: op.id, nodeId, technique: data.technique || "", testIndex: data.testIndex ?? 0,
      bundleHash: data.bundleHash || "", scope, consentRef, notAfter,
    }));

    return NextResponse.json({
      operation_id: op.id,
      technique: data.technique || "",
      test_index: data.testIndex ?? 0,
      bundle_hash: data.bundleHash || "",
      // LOTL addressing key: the agent echoes it to /api/v1/bundles so the
      // control plane fetches the exact source row. Integrity is still enforced
      // by the bundle_hash re-check, so this is addressing only, not trust.
      ...(data.lotlId ? { lotl_id: data.lotlId } : {}),
      max_runtime_ms: data.maxRuntimeMs || 120_000,
      scope,
      consent_ref: consentRef,
      not_after: notAfter,
      signature,
    });
  }

  return new NextResponse(null, { status: 204 });
}
