/**
 * Shared helpers for the native BAS fleet: node liveness + safe serializers.
 *
 * Liveness is computed from `lastSeen` age rather than trusting the persisted
 * `status` alone — so a node whose agent stopped heartbeating shows "stale"
 * then "offline" without needing a reconcile loop to have run yet. The
 * fleet-worker reconcile loop (M3+) persists the offline transition; this is
 * the read-time truth in the meantime.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import type { FleetNode, Fleet } from "@/generated/prisma/client";
import type { SessionUser } from "@/lib/auth";

/**
 * One-call gate for fleet sub-routes: authenticate, load the fleet, and verify
 * ownership (when enforcing). Returns the auth context + fleet, or a ready 401/
 * 404 response. Dev mode passes through (ownership not enforced).
 */
export async function requireFleetAccess(fleetId: string): Promise<
  | { ok: true; auth: { user: SessionUser; enforced: boolean }; fleet: Fleet }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, response: auth.response };
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return { ok: false, response: NextResponse.json({ error: "fleet not found" }, { status: 404 }) };
  const owns = ownsOr404({ user: auth.user, enforced: auth.enforced }, fleet.ownerId);
  if (!owns.ok) return { ok: false, response: owns.response };
  return { ok: true, auth: { user: auth.user, enforced: auth.enforced }, fleet };
}

/** A node is "online" if it heartbeat within this window. */
export const HEARTBEAT_STALE_MS = 15_000;   // >3× the 5s agent heartbeat
export const HEARTBEAT_OFFLINE_MS = 60_000; // hard offline after a minute

export type NodeLiveness = "online" | "stale" | "offline" | "revoked" | "paused";

export function nodeLiveness(node: Pick<FleetNode, "status" | "lastSeen">, now = Date.now()): NodeLiveness {
  if (node.status === "revoked") return "revoked";
  // "paused" is an operator hold: the agent keeps heartbeating, but the control
  // plane withholds jobs. Surface it as its own state so it isn't a live target.
  if (node.status === "paused") return "paused";
  if (!node.lastSeen) return "offline";
  const age = now - new Date(node.lastSeen).getTime();
  if (age <= HEARTBEAT_STALE_MS) return "online";
  if (age <= HEARTBEAT_OFFLINE_MS) return "stale";
  return "offline";
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

/** Public node shape for the dashboard — never includes the encrypted API key. */
export function serializeNode(node: FleetNode, now = Date.now()) {
  return {
    id: node.id,
    fleetId: node.fleetId,
    name: node.name,
    hostname: node.hostname,
    os: node.os,
    osVersion: node.osVersion,
    arch: node.arch,
    agentVersion: node.agentVersion,
    status: node.status,
    liveness: nodeLiveness(node, now),
    enrolledScope: safeJson<string[]>(node.enrolledScope, []),
    lastSeen: node.lastSeen,
    hostStatus: safeJson<Record<string, unknown>>(node.hostStatus, {}),
    currentRunId: node.currentRunId,
    createdAt: node.createdAt,
  };
}
