/**
 * PATCH  /api/fleets/[id]/nodes/[nodeId] — pause/resume a node (operator hold).
 * DELETE /api/fleets/[id]/nodes/[nodeId] — revoke a node.
 *
 * PATCH {action:"pause"|"resume"} toggles a soft "paused" hold: the agent keeps
 * heartbeating (stays enrolled + authenticated) but the control plane withholds
 * all jobs while paused. It's fully reversible — resume lets queued ops flow
 * again. This is the honest analog of "stop/start" for a poll-based agent (we
 * can't power a remote host on/off), and never touches its credentials.
 *
 * DELETE sets status="revoked": the agent's next heartbeat gets 401 and the
 * service stops (M2+). History is preserved (no row delete).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { requireFleetAccess } from "@/lib/bas/fleet";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: 'action must be "pause" or "resume"' }, { status: 400 });
  }

  const node = await prisma.fleetNode.findUnique({ where: { id: nodeId } });
  if (!node || node.fleetId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (node.status === "revoked") {
    return NextResponse.json({ error: "node is revoked — re-enroll it to use it again" }, { status: 409 });
  }

  // pause → held; resume → online (a live heartbeat keeps it online; if the agent
  // is actually offline, its next poll/heartbeat sets the real state).
  const status = action === "pause" ? "paused" : "online";
  await prisma.fleetNode.update({ where: { id: nodeId }, data: { status } });
  void logEvent({
    category: "bas", action: `bas.node.${action}`,
    actor: auth.user.email, status: "ok",
    targetType: "FleetNode", targetId: nodeId,
    message: `${action}d ${node.hostname || node.id}`,
  });
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;
  const auth = access.auth;

  const node = await prisma.fleetNode.findUnique({ where: { id: nodeId } });
  if (!node || node.fleetId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.fleetNode.update({ where: { id: nodeId }, data: { status: "revoked" } });
  void logEvent({
    category: "bas", action: "bas.node.revoke",
    actor: auth.user.email, status: "ok",
    targetType: "FleetNode", targetId: nodeId,
    message: `revoked ${node.hostname || node.id}`,
  });
  return NextResponse.json({ ok: true });
}
