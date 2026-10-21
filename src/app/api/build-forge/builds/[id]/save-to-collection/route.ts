import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { confinedFile, BUILD_FORGE_BASE, BINARY_COLLECTION_DIR as COLLECTION_DIR } from "../../../../_shared/safe-file";

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
  const artifact = confinedFile(build.artifactPath, [BUILD_FORGE_BASE]);
  if (!artifact || !existsSync(artifact)) {
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
  const fileName = basename(build.artifactName || build.artifactPath).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 150) || "artifact";
  const destPath = join(COLLECTION_DIR, `${build.id}-${fileName}`);
  copyFileSync(artifact, destPath);

  // Create collection entry
  const displayName = (typeof body.name === "string" && body.name.slice(0, 300)) || `${build.repo?.repoName || "binary"}-${build.target}-${build.architecture}`;

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
      description: String(body.description || build.repo?.description || "").slice(0, 5000),
      tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.map(String).slice(0, 50) : []),
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
