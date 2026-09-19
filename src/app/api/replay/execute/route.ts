/**
 * POST /api/replay/execute — Replay Now: send dataset file to Splunk HEC.
 *   Body: { rowId?, dataFilePath?, datasetName?, datasetId?, index?, source?, sourcetype?, hostOverride?, planId?, dryRun? }
 *
 * If rowId is provided, the dataset is resolved from the catalog.
 * Otherwise the explicit fields must be provided (used by Build Replay execution).
 *
 * dryRun=true returns the curl command preview without executing.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRowById, REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";
import { replayToHec, buildReplayCommand, getHecStatus } from "@/lib/attack-data/replay-hec";

export async function POST(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED) {
    return NextResponse.json({ enabled: false, error: "Replay feature disabled" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const { rowId, dryRun, planId } = body;

  // Resolve dataset
  let dataFilePath = body.dataFilePath as string | undefined;
  let datasetId = body.datasetId as string | undefined;
  let datasetName = body.datasetName as string | undefined;
  let index = body.index as string | undefined;
  let source = body.source as string | undefined;
  let sourcetype = body.sourcetype as string | undefined;

  if (rowId) {
    const row = getRowById(rowId);
    if (!row) return NextResponse.json({ error: `Row not found: ${rowId}` }, { status: 404 });
    dataFilePath = row.data_file_path;
    datasetId = row.dataset_id;
    datasetName = row.dataset_name;
    index = index || row.index;
    source = source || row.source;
    sourcetype = sourcetype || row.sourcetype;
  }

  if (!dataFilePath || !datasetId) {
    return NextResponse.json({ error: "rowId or (dataFilePath + datasetId) required" }, { status: 400 });
  }

  index = index || "attack_data";
  source = source || "attack_data";
  sourcetype = sourcetype || "_json";

  // Dry run — just return the preview command
  if (dryRun) {
    const hec = getHecStatus();
    const cmd = buildReplayCommand({
      dataFilePath, index, source, sourcetype,
      hostOverride: body.hostOverride,
    }, hec.splunkHost || undefined);
    return NextResponse.json({ dryRun: true, command: cmd, hec });
  }

  // Pre-flight HEC config check
  const hec = getHecStatus();
  if (!hec.ready) {
    return NextResponse.json({
      success: false,
      error: "SPLUNK_HOST and SPLUNK_HEC_TOKEN must be configured in environment",
      hec,
    }, { status: 400 });
  }

  // Create execution record (pending)
  const exec = await prisma.replayExecution.create({
    data: {
      planId: planId || null,
      datasetId, datasetName: datasetName || datasetId,
      dataFilePath, splunkHost: hec.splunkHost,
      index, source, sourcetype, status: "running",
    },
  });

  const result = await replayToHec({
    dataFilePath, index, source, sourcetype,
    hostOverride: body.hostOverride,
  });

  // Update execution record
  const updated = await prisma.replayExecution.update({
    where: { id: exec.id },
    data: {
      status: result.success ? "success" : "failed",
      bytesSent: result.bytesSent,
      durationMs: result.durationMs,
      hecChannel: result.hecChannel,
      errorMessage: result.error || null,
      completedAt: new Date(),
    },
  });

  // Update plan lastExecutedAt if linked
  if (planId && result.success) {
    await prisma.replayPlan.update({
      where: { id: planId },
      data: { lastExecutedAt: new Date(), status: "executed" },
    }).catch(() => {});
  }

  return NextResponse.json({
    success: result.success,
    execution: updated,
    result,
  }, { status: result.success ? 200 : 502 });
}
