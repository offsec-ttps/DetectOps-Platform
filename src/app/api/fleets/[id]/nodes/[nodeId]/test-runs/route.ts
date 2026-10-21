/**
 * GET /api/fleets/[id]/nodes/[nodeId]/test-runs   (dashboard-facing)
 *
 * Recent FleetTestRun rows for a node + any in-flight operation, for the
 * results panel.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFleetAccess } from "@/lib/bas/fleet";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await ctx.params;
  // Session + fleet ownership (was unguarded: any caller could read another
  // tenant's test stdout/stderr by fleet+node id).
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const node = await prisma.fleetNode.findUnique({ where: { id: nodeId } });
  if (!node || node.fleetId !== id) return NextResponse.json({ error: "node not found" }, { status: 404 });

  const [runs, pending] = await Promise.all([
    prisma.fleetTestRun.findMany({ where: { nodeId }, orderBy: { endedAt: "desc" }, take: 25 }),
    prisma.fleetOperation.findMany({ where: { nodeId, status: { in: ["queued", "running"] } }, orderBy: { createdAt: "desc" } }),
  ]);

  return NextResponse.json({
    currentRunId: node.currentRunId,
    pending: pending.map((p) => ({ id: p.id, status: p.status, createdAt: p.createdAt })),
    runs: runs.map((r) => ({
      id: r.id,
      technique: r.technique,
      testIndex: r.testIndex,
      exitCode: r.exitCode,
      executeStatus: r.executeStatus,
      cleanupStatus: r.cleanupStatus,
      stdout: r.stdoutRef,
      stderr: r.stderrRef,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    })),
  });
}
