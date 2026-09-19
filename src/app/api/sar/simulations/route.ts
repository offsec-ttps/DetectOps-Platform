/**
 * GET  /api/sar/simulations              — list (paged) / get one (?id=)
 * PATCH /api/sar/simulations?id=<id>     — persist detection-validation results
 *                                          back onto a SimulationRun row so the
 *                                          History tab can re-display the full
 *                                          sim+detection chain after the user
 *                                          navigates away.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";

// Defensive JSON parse — old rows pre-dating the detection-chain columns may
// have empty strings; we never want a SyntaxError to nuke the whole list.
function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Clean up stale "running" simulations older than 6 minutes
  const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
  await prisma.simulationRun.updateMany({
    where: {
      status: "running",
      startedAt: { lt: sixMinutesAgo },
    },
    data: {
      status: "failure",
      errorMessage: "Timed out — process did not report completion",
      completedAt: new Date(),
    },
  }).catch(() => {});

  // Single simulation lookup (for polling)
  const id = searchParams.get("id");
  if (id) {
    const run = await prisma.simulationRun.findUnique({ where: { id } });
    if (!run) {
      return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...run,
      techniqueIds: safeJson<string[]>(run.techniqueIds, []),
      parameters: safeJson<Record<string, unknown>>(run.parameters, {}),
      selectedDetections: safeJson<unknown[]>(run.selectedDetections, []),
      detectionResults: safeJson<unknown[]>(run.detectionResults, []),
    });
  }

  // List with pagination
  const status = searchParams.get("status") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [runs, total] = await Promise.all([
    prisma.simulationRun.findMany({
      where: where as any,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.simulationRun.count({ where: where as any }),
  ]);

  const items = runs.map((r) => ({
    ...r,
    techniqueIds: safeJson<string[]>(r.techniqueIds, []),
    parameters: safeJson<Record<string, unknown>>(r.parameters, {}),
    selectedDetections: safeJson<unknown[]>(r.selectedDetections, []),
    detectionResults: safeJson<unknown[]>(r.detectionResults, []),
  }));

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

// ── PATCH /api/sar/simulations?id=<id> ──
// Body: { executionMode?, selectedDetections?, detectionResults?, splunkUrl?,
//         maxRetries?, validationCompletedAt?: string|null }
// Used by Campaign Designer to write the detection chain back onto the row
// after validation completes (or whenever the user reruns/edits a detection).
// All fields are optional — partial updates are supported.
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const existing = await prisma.simulationRun.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  // Allow the client to mark a run's status (e.g. "stopped" when the user stops
  // a running simulation via the navigation guard). Terminal states stamp
  // completedAt if not already set.
  const STATUSES = ["queued", "running", "success", "failure", "error", "stopped"];
  if (typeof body.status === "string" && STATUSES.includes(body.status)) {
    data.status = body.status;
    if (["success", "failure", "error", "stopped"].includes(body.status) && !existing.completedAt) {
      data.completedAt = new Date();
    }
  }

  if (typeof body.executionMode === "string") {
    data.executionMode = body.executionMode === "simulation_detection"
      ? "simulation_detection" : "simulation";
  }
  if (Array.isArray(body.selectedDetections)) {
    data.selectedDetections = JSON.stringify(body.selectedDetections);
  }
  if (Array.isArray(body.detectionResults)) {
    data.detectionResults = JSON.stringify(body.detectionResults);
  }
  if (typeof body.splunkUrl === "string") {
    data.splunkUrl = body.splunkUrl;
  }
  if (typeof body.maxRetries === "number" && body.maxRetries > 0) {
    data.maxRetries = Math.min(200, Math.max(1, Math.floor(body.maxRetries)));
  }
  if (body.validationCompletedAt === null) {
    data.validationCompletedAt = null;
  } else if (typeof body.validationCompletedAt === "string") {
    const d = new Date(body.validationCompletedAt);
    if (!isNaN(d.getTime())) data.validationCompletedAt = d;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no updatable fields in body" }, { status: 400 });
  }

  const updated = await prisma.simulationRun.update({ where: { id }, data: data as any });

  const sessionUser = await getSessionUser().catch(() => null);
  const detResults = (data.detectionResults && typeof data.detectionResults === "string")
    ? (JSON.parse(data.detectionResults) as Array<{ status: string }>) : [];
  void logEvent({
    category: "simulation", action: "simulation.chain_persist",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "simulation", targetId: id,
    message: `detection chain saved (${detResults.length} rules)`,
    details: {
      executionMode: data.executionMode,
      maxRetries: data.maxRetries,
      detected: detResults.filter((r) => r?.status === "detected").length,
      notDetected: detResults.filter((r) => r?.status === "not_detected").length,
    },
  });

  return NextResponse.json({
    ...updated,
    techniqueIds: safeJson<string[]>(updated.techniqueIds, []),
    parameters: safeJson<Record<string, unknown>>(updated.parameters, {}),
    selectedDetections: safeJson<unknown[]>(updated.selectedDetections, []),
    detectionResults: safeJson<unknown[]>(updated.detectionResults, []),
  });
}

// ── POST /api/sar/simulations ──
// Create a SimulationRun history row for a run the CLIENT orchestrated
// (Remote Fleet / Cloud Lab / C2), which — unlike the local SAR path — has no
// server-side record. Body:
//   { techniqueIds: string[], targetServer, source: "cloud"|"fleet"|"c2"|"local",
//     status, logs?, executionMode?, durationMs?, targetIp?,
//     selectedDetections?, detectionResults? }
// So every simulation, regardless of environment, appears in Simulation History.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const techniqueIds = Array.isArray(body.techniqueIds) ? body.techniqueIds.map(String) : [];
  const targetServer = String(body.targetServer || "").slice(0, 240);
  if (!techniqueIds.length) return NextResponse.json({ error: "techniqueIds[] required" }, { status: 400 });
  if (!targetServer) return NextResponse.json({ error: "targetServer required" }, { status: 400 });

  const SOURCES = ["local", "cloud", "fleet", "c2"];
  const source = SOURCES.includes(body.source) ? body.source : "local";
  const STATUSES = ["queued", "running", "success", "failure", "error", "stopped", "timeout"];
  const status = STATUSES.includes(body.status) ? body.status : "success";
  const executionMode = body.executionMode === "simulation_detection" ? "simulation_detection" : "simulation";
  const terminal = ["success", "failure", "error", "stopped", "timeout"].includes(status);

  const run = await prisma.simulationRun.create({
    data: {
      techniqueIds: JSON.stringify(techniqueIds),
      targetServer,
      targetIp: String(body.targetIp || "").slice(0, 64),
      source,
      executor: source === "c2" ? "caldera" : "art",
      parameters: JSON.stringify(body.parameters || {}),
      status,
      logs: String(body.logs || "").slice(0, 200_000),
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      completedAt: terminal ? new Date() : null,
      durationMs: Number.isFinite(body.durationMs) ? Math.max(0, Math.round(body.durationMs)) : 0,
      executionMode,
      selectedDetections: JSON.stringify(Array.isArray(body.selectedDetections) ? body.selectedDetections : []),
      detectionResults: JSON.stringify(Array.isArray(body.detectionResults) ? body.detectionResults : []),
      validationCompletedAt: executionMode === "simulation_detection" && terminal ? new Date() : null,
    },
  });

  const sessionUser = await getSessionUser().catch(() => null);
  void logEvent({
    category: "simulation", action: "simulation.record",
    actor: sessionUser?.email || "anonymous", status: "ok",
    targetType: "simulation", targetId: run.id,
    message: `${source} ${techniqueIds.join(",")} → ${targetServer} (${status})`,
    details: { source, techniqueIds, targetServer, status, executionMode },
  });

  return NextResponse.json({ id: run.id, source: run.source, status: run.status });
}
