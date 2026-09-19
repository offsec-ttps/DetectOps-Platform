import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const COLLECTION_DIR = resolve(process.cwd(), "..", "MCP-DetecOps", "tmp", "binary-collection");

/**
 * POST /api/build-forge/builds/[id]/save-to-collection
 * Copies the build artifact into the Binary Collection.
 *
 * Body: { name?: string, tags?: string[], description?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const build = await prisma.buildRecord.findUnique({
    where: { id },
    include: { repo: { select: { name: true, owner: true, repoName: true, language: true, description: true } } },
  });

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }
  if (build.status !== "success" || !build.artifactPath) {
    return NextResponse.json({ error: "No successful artifact to save" }, { status: 400 });
  }
  if (!existsSync(build.artifactPath)) {
    return NextResponse.json({ error: "Artifact file not found on disk" }, { status: 404 });
  }

  // Check if already saved
  const existing = await prisma.binaryCollection.findFirst({
    where: { buildRecordId: build.id },
  });
  if (existing) {
    return NextResponse.json({ error: "Already saved to collection", item: existing }, { status: 409 });
  }

  // Copy artifact to collection directory
  mkdirSync(COLLECTION_DIR, { recursive: true });
  const fileName = build.artifactName || basename(build.artifactPath);
  const destPath = join(COLLECTION_DIR, `${build.id}-${fileName}`);
  copyFileSync(build.artifactPath, destPath);

  // Create collection entry
  const displayName = body.name || `${build.repo?.repoName || "binary"}-${build.target}-${build.architecture}`;

  const item = await prisma.binaryCollection.create({
    data: {
      name: displayName,
      binaryName: fileName,
      repoName: build.repo?.name || "",
      repoOwner: build.repo?.owner || "",
      language: build.repo?.language || "",
      target: build.target,
      environment: build.environment,
      architecture: build.architecture,
      framework: build.framework,
      branch: build.branch,
      commitSha: build.commitSha,
      buildProfile: build.buildProfile,
      filePath: destPath,
      fileSize: build.artifactSize,
      sha256: build.artifactHash,
      description: body.description || build.repo?.description || "",
      tags: JSON.stringify(body.tags || []),
      buildRecordId: build.id,
    },
  });

  // Mark build as saved
  await prisma.buildRecord.update({
    where: { id: build.id },
    data: { savedToCollection: true },
  });

  return NextResponse.json(item, { status: 201 });
}
