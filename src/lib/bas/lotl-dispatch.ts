/**
 * Server-side helper: dispatch one or more curated LOTL (living-off-the-land)
 * techniques to a native BAS fleet as a single campaign.
 *
 * This is the programmatic twin of POST /api/fleets/[id]/campaigns, specialized
 * for LotlTechnique selections. It preserves the exact hash-pinned model: each
 * LotlTechnique is rebuilt into a version-pinned BundleContent by buildDispatch
 * ({lotlId}) and addressed by sha256 — the fanned-out FleetOperation rows carry
 * only addressing + hash + scope, never a raw command. The agent later fetches
 * the bundle, which the control plane rebuilds from the same DB row and
 * re-hashes before serving.
 *
 * Fanout matches the campaigns route: one FleetOperation per (usable node ×
 * selected LOTL technique), under one FleetCampaign.
 */

import { prisma } from "@/lib/prisma";
import { buildDispatch } from "@/lib/bas/bundle-catalog";
import { nodeLiveness } from "@/lib/bas/fleet";
import { logEvent } from "@/lib/event-log";

export interface DispatchLotlOptions {
  fleetId: string;
  nodeIds: string[];
  lotlIds: string[];
  actor: string;
  consentId?: string;
  /** Optional per-op runtime cap (clamped 5s..600s by buildDispatch). */
  maxRuntimeMs?: number;
}

export interface DispatchLotlResult {
  campaignId: string;
  operations: number;
}

/**
 * Validate the fleet + target nodes, resolve each LotlTechnique to a pinned
 * bundle, create ONE FleetCampaign, and fan out FleetOperation rows per
 * (node × lotlId). Throws on any validation failure (missing fleet, no usable
 * nodes, empty/unresolvable selection) so callers can surface a 4xx.
 */
export async function dispatchLotlToFleet(opts: DispatchLotlOptions): Promise<DispatchLotlResult> {
  const lotlIds = Array.from(new Set((opts.lotlIds || []).map(String).filter(Boolean))).slice(0, 200);
  const targetIds = Array.from(new Set((opts.nodeIds || []).map(String).filter(Boolean)));
  if (lotlIds.length === 0) throw new Error("lotlIds is empty");
  if (targetIds.length === 0) throw new Error("no target nodes");

  const fleet = await prisma.fleet.findUnique({ where: { id: opts.fleetId } });
  if (!fleet) throw new Error("fleet not found");

  // Validate target nodes belong to this fleet + aren't revoked. Offline nodes
  // are allowed (their ops queue until they beacon) but counted for reporting.
  const nodes = await prisma.fleetNode.findMany({ where: { id: { in: targetIds }, fleetId: opts.fleetId } });
  const usable = nodes.filter((n) => n.status !== "revoked");
  if (usable.length === 0) throw new Error("no usable target nodes (all revoked or not in fleet)");
  const offline = usable.filter((n) => nodeLiveness(n) === "offline").length;

  // Resolve each LOTL technique to a pinned bundle once (shared across nodes).
  const dispatches = [];
  for (const lotlId of lotlIds) {
    const d = await buildDispatch({ lotlId, maxRuntimeMs: opts.maxRuntimeMs });
    if (!d.ok) throw new Error(`lotl ${lotlId}: ${d.error}`);
    dispatches.push(d);
  }

  const opsExpected = usable.length * dispatches.length;

  const campaign = await prisma.fleetCampaign.create({
    data: {
      fleetId: opts.fleetId,
      createdBy: opts.actor,
      testSelection: JSON.stringify(dispatches.map((d) => ({
        technique: d.data.technique,
        testIndex: d.data.testIndex,
        bundleHash: d.data.bundleHash,
        testName: d.bundle.testName,
        ...(d.data.lotlId ? { lotlId: d.data.lotlId } : {}),
      }))),
      targetNodeIds: JSON.stringify(usable.map((n) => n.id)),
      schedule: JSON.stringify({ type: "now" }),
      execution: JSON.stringify({ interTestDelayMs: 0, stopOnBlock: false, requireCleanup: true }),
      consentId: opts.consentId ?? fleet.consentId,
      status: "running",
      opsExpected,
    },
  });

  // Fan out: one op per (node × LOTL technique). The op `data` is the dispatch
  // payload (addressing + hash + scope + lotlId) — never an executable command.
  const opRows = [];
  for (const n of usable) {
    for (const d of dispatches) {
      opRows.push({ campaignId: campaign.id, nodeId: n.id, data: JSON.stringify(d.data), status: "queued" });
    }
  }
  await prisma.fleetOperation.createMany({ data: opRows });

  void logEvent({
    category: "bas", action: "bas.campaign.create",
    actor: opts.actor, status: "ok",
    targetType: "FleetCampaign", targetId: campaign.id,
    message: `${fleet.name} · ${dispatches.length} LOTL technique(s) × ${usable.length} node(s) = ${opsExpected} ops${offline ? ` (${offline} node(s) offline — queued)` : ""}`,
    details: { fleetId: opts.fleetId, opsExpected, tests: dispatches.length, nodes: usable.length, offline, kind: "lotl" },
  });

  return { campaignId: campaign.id, operations: opsExpected };
}
