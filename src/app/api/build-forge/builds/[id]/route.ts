import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/build-forge/builds/[id] — get build status & details
 * DELETE /api/build-forge/builds/[id] — delete a build record
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const build = await prisma.buildRecord.findUnique({
    where: { id },
    include: { repo: { select: { name: true, owner: true, repoName: true, language: true } } },
  });

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  return NextResponse.json(build);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.buildRecord.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ deleted: true });
}
