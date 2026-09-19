/**
 * POST /api/c2/[id]/run-technique  { techniqueId, refId?, displayName?, timeoutMs? }
 *
 * Runs one ATT&CK technique against the C2's beacons (over the C2 channel) and
 * returns the execution result. This is the Fleet-Simulation "run a test" action
 * for a C2 server — it does NOT touch the Local Lab.
 */

import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/c2/registry";
import { logEvent } from "@/lib/event-log";
import { loadOwnedC2 } from "@/lib/c2/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const prov = getProvider(r.server.provider);
  if (!prov) return NextResponse.json({ error: "unknown provider" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const techniqueId = String(body.techniqueId || "").trim();
  if (!techniqueId) return NextResponse.json({ error: "techniqueId is required" }, { status: 400 });
  const timeoutMs = Math.min(600_000, Math.max(20_000, Number(body.timeoutMs) || 180_000));

  const result = await prov.runTechnique(
    r.server,
    { techniqueId, refId: body.refId ? String(body.refId) : undefined, displayName: body.displayName ? String(body.displayName) : undefined },
    timeoutMs,
  );

  void logEvent({
    category: "bas", action: "c2.run", actor: r.auth.user.email,
    status: result.status === "ok" ? "ok" : result.status === "failure" ? "warn" : "info",
    targetType: "C2Server", targetId: id,
    message: `${r.server.provider} ${techniqueId} → ${result.status} (${result.notes})`,
  });
  return NextResponse.json({ result });
}
