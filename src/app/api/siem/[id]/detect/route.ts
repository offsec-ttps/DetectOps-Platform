/**
 * POST /api/siem/[id]/detect  { query, detectionName?, techniqueId?, windowMinutes? }
 *
 * Run ONE detection against this SIEM connection (SPL for Splunk, KQL for MDE)
 * and return a normalized verdict. This is the unified endpoint the Campaign
 * Designer's detection loop calls, per selected environment.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSiemProvider, resolveSiemConfig } from "@/lib/siem/registry";
import { logEvent } from "@/lib/event-log";
import { loadOwnedSiem } from "@/lib/siem/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedSiem(id);
  if (!r.ok) return r.response;
  const prov = getSiemProvider(r.server.kind);
  if (!prov) return NextResponse.json({ error: "unknown SIEM kind" }, { status: 400 });

  const cfg = resolveSiemConfig(r.server);
  if (!cfg.ok) return NextResponse.json({ error: cfg.reason, detected: false, resultCount: 0 }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const result = await prov.runDetection(cfg.cfg, {
    query: String(body.query || ""),
    detectionName: body.detectionName ? String(body.detectionName) : undefined,
    techniqueId: body.techniqueId ? String(body.techniqueId) : undefined,
    windowMinutes: Number.isFinite(body.windowMinutes) ? Number(body.windowMinutes) : undefined,
  });

  void logEvent({
    category: "detection", action: "detection.validate", actor: r.auth.user.email,
    status: result.detected ? "ok" : "warn", targetType: "detection", targetId: String(body.detectionName || body.techniqueId || ""),
    message: `${r.server.kind} ${result.detected ? "DETECTED" : "not detected"} · ${result.resultCount} match(es)`,
    details: { siem: r.server.kind, connection: r.server.name, detectionName: body.detectionName, techniqueId: body.techniqueId },
  });
  return NextResponse.json(result);
}
