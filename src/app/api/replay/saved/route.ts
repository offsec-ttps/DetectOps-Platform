/**
 * GET  /api/replay/saved — list saved datasets, optionally filter by collection.
 * POST /api/replay/saved — save a dataset for later.
 *   Body: { rowId } or full dataset object
 * DELETE /api/replay/saved?id=... — remove saved item.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRowById, REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";

const SAVE_ENABLED = (process.env.ENABLE_REPLAY_SAVE_FOR_LATER ?? "true").toLowerCase() !== "false";

export async function GET(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !SAVE_ENABLED) return NextResponse.json({ enabled: false, items: [] });
  const { searchParams } = new URL(req.url);
  const collection = searchParams.get("collection") || undefined;
  const items = await prisma.savedReplayDataset.findMany({
    where: collection ? { collection } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ enabled: true, items, count: items.length });
}

export async function POST(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !SAVE_ENABLED) {
    return NextResponse.json({ error: "Save-for-later disabled" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const { rowId, collection = "default", notes } = body;

  if (!rowId) return NextResponse.json({ error: "rowId required" }, { status: 400 });

  const row = getRowById(rowId);
  if (!row) return NextResponse.json({ error: `Row not found: ${rowId}` }, { status: 404 });

  // Upsert (idempotent save)
  const saved = await prisma.savedReplayDataset.upsert({
    where: {
      datasetId_dataFilePath_createdBy: {
        datasetId: row.dataset_id,
        dataFilePath: row.data_file_path,
        createdBy: "analyst",
      },
    },
    update: { collection, notes: notes || null },
    create: {
      datasetId: row.dataset_id,
      datasetName: row.dataset_name,
      metadataPath: row.metadata_file_path,
      dataFilePath: row.data_file_path,
      platform: row.platform,
      mitreAttackIds: JSON.stringify(row.mitre_attack_ids),
      environment: row.environment,
      source: row.source,
      sourcetype: row.sourcetype,
      index: row.index,
      description: row.description,
      collection,
      notes: notes || null,
    },
  });

  return NextResponse.json({ success: true, saved });
}

export async function DELETE(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED || !SAVE_ENABLED) {
    return NextResponse.json({ error: "Disabled" }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.savedReplayDataset.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ success: true });
}
