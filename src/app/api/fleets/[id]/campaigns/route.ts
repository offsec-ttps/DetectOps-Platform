/**
 * POST /api/fleets/[id]/campaigns — create a campaign + fan out operations
 * GET  /api/fleets/[id]/campaigns — list campaigns with rolled-up progress
 *
 * Fanout = one FleetOperation per (target node × selected test). The agents
 * already drain their queued ops over HTTP-poll, so no push transport is
 * needed; NATS replaces this delivery path in a later slice.
 *
 * POST body:
 *   {
 *     name?,
 *     testSelection: [ { useSmoke:true } | { technique, testIndex } ],
 *     targetNodeIds: [nodeId, ...],
 *     execution?: { interTestDelayMs?, stopOnBlock?, maxRuntimeMs? }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDispatch } from "@/lib/bas/bundle-catalog";
import { nodeLiveness } from "@/lib/bas/fleet";
import { reconcile, campaignProgress } from "@/lib/bas/reconcile";
import { requireFleetAccess } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";

function safeArr<T = any>(s: string): T[] { try { return JSON.parse(s) || []; } catch { return []; } }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  await reconcile(id).catch(() => {});   // reflect current truth on read

  const campaigns = await prisma.fleetCampaign.findMany({ where: { fleetId: id }, orderBy: { createdAt: "desc" }, take: 50 });
  const items = await Promise.all(campaigns.map(async (c) => {
    const prog = await campaignProgress(c.id);
    return {
      id: c.id,
      status: c.status,
      opsExpected: c.opsExpected,
      testSelection: safeArr(c.testSelection),
      targetNodeIds: safeArr<string>(c.targetNodeIds),
      progress: prog,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
    };
  }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const { auth, fleet } = access;

  const body = await req.json().catch(() => ({}));

  const selection: any[] = Array.isArray(body.testSelection) ? body.testSelection.slice(0, 200) : [];
  const targetIds: string[] = Array.isArray(body.targetNodeIds) ? body.targetNodeIds.map(String) : [];
  if (selection.length === 0) return NextResponse.json({ error: "testSelection is empty" }, { status: 400 });
  if (targetIds.length === 0) return NextResponse.json({ error: "no target nodes" }, { status: 400 });

  // Validate target nodes belong to this fleet + aren't revoked. Offline nodes
  // are allowed (their ops queue until they beacon) but reported back.
  const nodes = await prisma.fleetNode.findMany({ where: { id: { in: targetIds }, fleetId: id } });
  const usable = nodes.filter((n) => n.status !== "revoked");
  if (usable.length === 0) return NextResponse.json({ error: "no usable target nodes (all revoked or not in fleet)" }, { status: 409 });
  const offline = usable.filter((n) => nodeLiveness(n) === "offline").length;

  // Resolve each test to a pinned bundle once (shared across nodes).
  const dispatches = [];
  for (const t of selection) {
    const d = await buildDispatch({
      useSmoke: t.useSmoke === true,
      technique: t.technique ? String(t.technique) : undefined,
      testIndex: t.testIndex != null ? Number(t.testIndex) : undefined,
      lotlId: t.lotlId ? String(t.lotlId) : undefined,
      maxRuntimeMs: body.execution?.maxRuntimeMs != null ? Number(body.execution.maxRuntimeMs) : undefined,
    });
    if (!d.ok) return NextResponse.json({ error: `test ${JSON.stringify(t)}: ${d.error}` }, { status: 400 });
    dispatches.push(d);
  }

  const opsExpected = usable.length * dispatches.length;

  const campaign = await prisma.fleetCampaign.create({
    data: {
      fleetId: id,
      createdBy: auth.user.email,
      testSelection: JSON.stringify(dispatches.map((d) => ({ technique: d.data.technique, testIndex: d.data.testIndex, bundleHash: d.data.bundleHash, testName: d.bundle.testName, ...(d.data.lotlId ? { lotlId: d.data.lotlId } : {}) }))),
      targetNodeIds: JSON.stringify(usable.map((n) => n.id)),
      schedule: JSON.stringify({ type: "now" }),
      execution: JSON.stringify({
        interTestDelayMs: Number(body.execution?.interTestDelayMs) || 0,
        stopOnBlock: body.execution?.stopOnBlock === true,
        requireCleanup: true,
      }),
      consentId: fleet.consentId,
      status: "running",
      opsExpected,
    },
  });

  // Fan out: one op per (node × test).
  const opRows = [];
  for (const n of usable) {
    for (const d of dispatches) {
      opRows.push({ campaignId: campaign.id, nodeId: n.id, data: JSON.stringify(d.data), status: "queued" });
    }
  }
  await prisma.fleetOperation.createMany({ data: opRows });

  void logEvent({
    category: "bas", action: "bas.campaign.create",
    actor: auth.user.email, status: "ok",
    targetType: "FleetCampaign", targetId: campaign.id,
    message: `${fleet.name} · ${dispatches.length} test(s) × ${usable.length} node(s) = ${opsExpected} ops${offline ? ` (${offline} node(s) offline — queued)` : ""}`,
    details: { fleetId: id, opsExpected, tests: dispatches.length, nodes: usable.length, offline },
  });

  return NextResponse.json({
    campaignId: campaign.id,
    opsExpected,
    nodes: usable.length,
    tests: dispatches.length,
    offlineNodes: offline,
  });
}
