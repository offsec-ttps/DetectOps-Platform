/**
 * GET /api/fleets/[id]/campaigns/[campaignId] — campaign detail: per-node ×
 * per-test operation matrix + their test-run results + rolled-up progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reconcile, campaignProgress } from "@/lib/bas/reconcile";
import { requireFleetAccess } from "@/lib/bas/fleet";

function safeArr<T = any>(s: string): T[] { try { return JSON.parse(s) || []; } catch { return []; } }
function safeObj(s: string): any { try { return JSON.parse(s) || {}; } catch { return {}; } }

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; campaignId: string }> }) {
  const { id, campaignId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  await reconcile(id).catch(() => {});

  const campaign = await prisma.fleetCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.fleetId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [ops, nodes, prog] = await Promise.all([
    prisma.fleetOperation.findMany({ where: { campaignId }, orderBy: { createdAt: "asc" } }),
    prisma.fleetNode.findMany({ where: { fleetId: id } }),
    campaignProgress(campaignId),
  ]);
  const nodeName = new Map(nodes.map((n) => [n.id, n.hostname || n.name || n.id.slice(0, 8)]));

  // Pull the test-run results for these ops (for exit/cleanup/stdout).
  const runs = await prisma.fleetTestRun.findMany({ where: { operationId: { in: ops.map((o) => o.id) } } });
  const runByOp = new Map(runs.map((r) => [r.operationId, r]));

  return NextResponse.json({
    id: campaign.id,
    status: campaign.status,
    opsExpected: campaign.opsExpected,
    testSelection: safeArr(campaign.testSelection),
    execution: safeObj(campaign.execution),
    progress: prog,
    createdBy: campaign.createdBy,
    createdAt: campaign.createdAt,
    operations: ops.map((o) => {
      const d = safeObj(o.data);
      const r = runByOp.get(o.id);
      return {
        id: o.id,
        nodeId: o.nodeId,
        nodeName: nodeName.get(o.nodeId) || o.nodeId.slice(0, 8),
        technique: d.technique,
        testIndex: d.testIndex,
        status: o.status,
        bundleHash: d.bundleHash,
        result: r ? {
          executeStatus: r.executeStatus, cleanupStatus: r.cleanupStatus, exitCode: r.exitCode,
          stdout: r.stdoutRef, stderr: r.stderrRef,
          cleanupStdout: r.cleanupStdoutRef, cleanupStderr: r.cleanupStderrRef,
          durationMs: r.durationMs, bundleHash: r.bundleHash,
          startedAt: r.startedAt, endedAt: r.endedAt,
        } : null,
      };
    }),
  });
}
