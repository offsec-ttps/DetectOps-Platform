import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { confinedFile, attachmentDisposition, BINARY_COLLECTION_DIR } from "../../../_shared/safe-file";

/**
 * GET    /api/build-forge/binary-collection/[id]          — get details
 * GET    /api/build-forge/binary-collection/[id]?download  — download binary
 * DELETE /api/build-forge/binary-collection/[id]           — remove from collection
 * PATCH  /api/build-forge/binary-collection/[id]           — update tags/name
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const download = req.nextUrl.searchParams.has("download");

  const item = await prisma.binaryCollection.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Binary not found" }, { status: 404 });
  }

  if (download) {
    const file = confinedFile(item.filePath, [BINARY_COLLECTION_DIR]);
    if (!file || !existsSync(file)) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }
    const fileBuffer = readFileSync(file);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": attachmentDisposition(item.binaryName, "binary.bin"),
        "Content-Length": String(fileBuffer.length),
        "X-Artifact-SHA256": item.sha256,
      },
    });
  }

  return NextResponse.json({ ...item, tags: JSON.parse(item.tags) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const item = await prisma.binaryCollection.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Binary not found" }, { status: 404 });
  }

  // Remove file from disk — only if it really lives in the collection dir.
  const file = confinedFile(item.filePath, [BINARY_COLLECTION_DIR]);
  if (file) {
    try { unlinkSync(file); } catch { /* already gone */ }
  }

  // Unmark the build record
  if (item.buildRecordId) {
    await prisma.buildRecord.update({
      where: { id: item.buildRecordId },
      data: { savedToCollection: false },
    }).catch(() => {});
  }

  await prisma.binaryCollection.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: any = {};
  if (body.name !== undefined) data.name = String(body.name).slice(0, 300);
  if (body.description !== undefined) data.description = String(body.description).slice(0, 5000);
  if (body.tags !== undefined) data.tags = JSON.stringify(Array.isArray(body.tags) ? body.tags.map(String).slice(0, 50) : []);

  const updated = await prisma.binaryCollection.update({ where: { id }, data });
  return NextResponse.json({ ...updated, tags: JSON.parse(updated.tags) });
}
