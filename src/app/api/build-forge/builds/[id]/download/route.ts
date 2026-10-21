import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { confinedFile, attachmentDisposition, BUILD_FORGE_BASE } from "../../../../_shared/safe-file";

/**
 * GET /api/build-forge/builds/[id]/download
 * Streams the built binary as a file download.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const build = await prisma.buildRecord.findUnique({ where: { id } });
  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  if (build.status !== "success" || !build.artifactPath) {
    return NextResponse.json({ error: "No artifact available for this build" }, { status: 404 });
  }

  // Only serve a regular file whose real path is inside the Build Forge tree
  // (a build could plant a symlink in its artifact dir pointing elsewhere).
  const artifact = confinedFile(build.artifactPath, [BUILD_FORGE_BASE]);
  if (!artifact || !existsSync(artifact)) {
    return NextResponse.json({ error: "Artifact file not found on disk" }, { status: 404 });
  }

  const fileBuffer = readFileSync(artifact);
  const fileName = build.artifactName || basename(build.artifactPath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(fileName, "artifact.bin"),
      "Content-Length": String(fileBuffer.length),
      "X-Artifact-SHA256": build.artifactHash || "",
    },
  });
}
