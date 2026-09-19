import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { basename } from "node:path";

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
    if (!existsSync(item.filePath)) {
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
    }
    const fileBuffer = readFileSync(item.filePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${item.binaryName}"`,
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

  // Remove file from disk
  if (existsSync(item.filePath)) {
    unlinkSync(item.filePath);
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
  const body = await req.json();

  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.tags !== undefined) data.tags = JSON.stringify(body.tags);

  const updated = await prisma.binaryCollection.update({ where: { id }, data });
  return NextResponse.json({ ...updated, tags: JSON.parse(updated.tags) });
}
