/**
 * POST /api/fleets/[id]/nodes/[nodeId]/run-test   (dashboard-facing)
 *
 * Queue a single version-pinned atomic test on one node — the M3 "run one
 * thing end-to-end" path (the full campaign→fanout machinery lands in M4).
 *
 * Body:
 *   { useSmoke?: true }                         // benign connectivity bundle
 *   | { technique: "T1059.001", testIndex: 1 }  // a real atomic
 *   maxRuntimeMs?: number
 *
 * Creates a queued FleetOperation; the node's agent picks it up on its next
 * poll, runs it, always cleans up, and reports a FleetTestRun.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDispatch } from "@/lib/bas/bundle-catalog";
import { nodeLiveness, requireFleetAccess } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  const body = await req.json().catch(() => ({}));

  const node = await prisma.fleetNode.findUnique({ where: { id: nodeId } });
  if (!node || node.fleetId !== id) return NextResponse.json({ error: "node not found" }, { status: 404 });
  if (node.status === "revoked") return NextResponse.json({ error: "node is revoked" }, { status: 409 });
  if (nodeLiveness(node) === "offline") {
    return NextResponse.json({ error: "node is offline — it won't pick up the job until it beacons" }, { status: 409 });
  }

  const dispatch = await buildDispatch({
    useSmoke: body.useSmoke === true,
    technique: body.technique ? String(body.technique) : undefined,
    testIndex: body.testIndex != null ? Number(body.testIndex) : undefined,
    maxRuntimeMs: body.maxRuntimeMs != null ? Number(body.maxRuntimeMs) : undefined,
  });
  if (!dispatch.ok) return NextResponse.json({ error: dispatch.error }, { status: 400 });

  // A standalone M3 op needs a campaign parent for FK shape; create a tiny
  // single-op campaign so the row graph stays consistent with M4.
  const campaign = await prisma.fleetCampaign.create({
    data: {
      fleetId: id,
      createdBy: auth.user.email,
      testSelection: JSON.stringify([{ technique: dispatch.data.technique, testIndex: dispatch.data.testIndex, bundleHash: dispatch.data.bundleHash }]),
      targetNodeIds: JSON.stringify([nodeId]),
      schedule: JSON.stringify({ type: "now" }),
      execution: JSON.stringify({ mode: "single", requireCleanup: true }),
      status: "running",
      opsExpected: 1,
    },
  });

  const op = await prisma.fleetOperation.create({
    data: { campaignId: campaign.id, nodeId, data: JSON.stringify(dispatch.data), status: "queued" },
  });

  void logEvent({
    category: "bas", action: "bas.testrun.dispatch",
    actor: "dashboard", status: "ok",
    targetType: "FleetOperation", targetId: op.id,
    message: `${node.hostname} ← ${dispatch.bundle.testName} (${dispatch.data.technique} #${dispatch.data.testIndex})`,
    details: { nodeId, technique: dispatch.data.technique, testIndex: dispatch.data.testIndex, bundleHash: dispatch.data.bundleHash, useSmoke: body.useSmoke === true },
  });

  return NextResponse.json({
    operationId: op.id,
    campaignId: campaign.id,
    technique: dispatch.data.technique,
    testIndex: dispatch.data.testIndex,
    bundleHash: dispatch.data.bundleHash,
    testName: dispatch.bundle.testName,
  });
}
