/**
 * Fleet reconciliation — the HTTP-poll-era equivalent of the CrossFyre
 * reconcile loop. Heals two kinds of drift so dropped polls / crashed agents
 * don't leave the fleet in a stuck state:
 *
 *   1. STUCK OPERATIONS — an op claimed (running) but never reported back (agent
 *      crashed / lost connectivity) is timed out to "failed" after a grace
 *      window, so its campaign can roll up.
 *   2. CAMPAIGN ROLLUP — a campaign whose operations are all terminal is moved
 *      to "completed" (or stays "halted" if it was halted explicitly).
 *
 * Called on-read from the campaign list/detail routes (so reads reflect current
 * truth) and exposed via POST /api/fleets/[id]/reconcile for a cron tick. When
 * NATS lands, the fleet-worker runs this on a 3s loop instead.
 */

import { prisma } from "@/lib/prisma";

const TERMINAL = new Set(["success", "failed", "blocked", "cleanup_failed", "cancelled"]);
/** An op running longer than this with no result is presumed dead. */
const STUCK_MS = 15 * 60_000;

export interface ReconcileResult {
  timedOutOps: number;
  rolledUpCampaigns: number;
}

export async function reconcile(fleetId?: string): Promise<ReconcileResult> {
  const now = Date.now();
  let timedOutOps = 0;
  let rolledUpCampaigns = 0;

  // Scope to a fleet's campaigns when given.
  const campaignWhere = fleetId ? { fleetId } : {};
  const campaigns = await prisma.fleetCampaign.findMany({
    where: { ...campaignWhere, status: { in: ["created", "populating", "running"] } },
    select: { id: true },
  });
  if (campaigns.length === 0) return { timedOutOps, rolledUpCampaigns };
  const campaignIds = campaigns.map((c) => c.id);

  // 1. Time out stuck running ops within these campaigns.
  const stuck = await prisma.fleetOperation.findMany({
    where: { campaignId: { in: campaignIds }, status: "running", updatedAt: { lt: new Date(now - STUCK_MS) } },
    select: { id: true, nodeId: true },
  });
  for (const op of stuck) {
    await prisma.fleetOperation.update({ where: { id: op.id }, data: { status: "failed" } });
    // Clear the node's currentRunId if it was pinned to this op.
    await prisma.fleetNode.updateMany({ where: { id: op.nodeId, currentRunId: op.id }, data: { currentRunId: null } });
    timedOutOps++;
  }

  // 2. Roll up campaigns whose ops are all terminal.
  for (const cid of campaignIds) {
    const ops = await prisma.fleetOperation.findMany({ where: { campaignId: cid }, select: { status: true } });
    if (ops.length === 0) continue;                       // nothing fanned out yet
    const allTerminal = ops.every((o) => TERMINAL.has(o.status));
    if (allTerminal) {
      await prisma.fleetCampaign.update({ where: { id: cid }, data: { status: "completed" } });
      rolledUpCampaigns++;
    }
  }

  return { timedOutOps, rolledUpCampaigns };
}

/** Status counts for a campaign's operations — drives the progress UI. */
export async function campaignProgress(campaignId: string): Promise<{ total: number; byStatus: Record<string, number>; done: number }> {
  const ops = await prisma.fleetOperation.findMany({ where: { campaignId }, select: { status: true } });
  const byStatus: Record<string, number> = {};
  for (const o of ops) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const done = ops.filter((o) => TERMINAL.has(o.status)).length;
  return { total: ops.length, byStatus, done };
}
