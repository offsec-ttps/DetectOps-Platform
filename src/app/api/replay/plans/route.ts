/**
 * GET    /api/replay/plans              — list all replay plans
 * POST   /api/replay/plans              — create a replay plan from a row + overrides (Build replay)
 * PATCH  /api/replay/plans?id=...       — edit a plan
 * DELETE /api/replay/plans?id=...       — delete a plan
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRowById, REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";
import { buildReplayCommand, getHecStatus } from "@/lib/attack-data/replay-hec";

const BUILD_ENABLED = (process.env.ENABLE_REPLAY_BUILD ?? "true").toLowerCase() !== "false";

export async function GET() {
  if (!REPLAY_FEATURE_ENABLED || !BUILD_ENABLED) return NextResponse.json({ enabled: false, plans: [] });
  const plans = await prisma.replayPlan.findMany({
    orderBy: { createdAt: "desc" },
    include: { executions: { orderBy: { startedAt: "desc" }, take: 5 } },
  });
  return NextResponse.json({ enabled: true, plans, count: plans.length });
}

export async function POST(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !BUILD_ENABLED) {
    return NextResponse.json({ error: "Build-replay disabled" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const { rowId, name, notes } = body;

  if (!rowId) return NextResponse.json({ error: "rowId required" }, { status: 400 });
  const row = getRowById(rowId);
  if (!row) return NextResponse.json({ error: `Row not found: ${rowId}` }, { status: 404 });

  const index = body.index || row.index;
  const source = body.source || row.source;
  const sourcetype = body.sourcetype || row.sourcetype;
  const hostOverride = body.hostOverride || null;
  const splunkHost = body.splunkHost || null;

  const hec = getHecStatus();
  const command = buildReplayCommand({
    dataFilePath: row.data_file_path, index, source, sourcetype,
    hostOverride: hostOverride || undefined,
    splunkHostOverride: splunkHost || undefined,
  }, hec.splunkHost || undefined);

  const plan = await prisma.replayPlan.create({
    data: {
      name: name || `${row.dataset_name} replay`,
      datasetId: row.dataset_id,
      datasetName: row.dataset_name,
      metadataPath: row.metadata_file_path,
      dataFilePath: row.data_file_path,
      index, source, sourcetype, hostOverride, splunkHost, notes: notes || null,
      commandPreview: command, status: "ready",
    },
  });

  return NextResponse.json({ success: true, plan });
}

export async function PATCH(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !BUILD_ENABLED) return NextResponse.json({ error: "Disabled" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const allowed = ["name", "index", "source", "sourcetype", "hostOverride", "splunkHost", "notes", "status"];
  const data: any = {};
  for (const k of allowed) if (k in body) data[k] = body[k];

  // Rebuild command preview if relevant fields changed
  if (["index", "source", "sourcetype", "hostOverride", "splunkHost"].some((k) => k in body)) {
    const existing = await prisma.replayPlan.findUnique({ where: { id } });
    if (existing) {
      const merged = { ...existing, ...data };
      const hec = getHecStatus();
      data.commandPreview = buildReplayCommand({
        dataFilePath: existing.dataFilePath,
        index: merged.index, source: merged.source, sourcetype: merged.sourcetype,
        hostOverride: merged.hostOverride || undefined,
        splunkHostOverride: merged.splunkHost || undefined,
      }, hec.splunkHost || undefined);
    }
  }

  const plan = await prisma.replayPlan.update({ where: { id }, data });
  return NextResponse.json({ success: true, plan });
}

export async function DELETE(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !BUILD_ENABLED) return NextResponse.json({ error: "Disabled" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.replayPlan.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ success: true });
}
