import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** POST — Mark a Splunk detection as verified (working) */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { detectionId, techniqueId, verified } = body;

  if (!detectionId) {
    return NextResponse.json({ error: "detectionId is required" }, { status: 400 });
  }

  // Find by database id or by detectionId (YAML UUID)
  let detection = await prisma.splunkDetection.findUnique({ where: { id: detectionId } });
  if (!detection) {
    detection = await prisma.splunkDetection.findUnique({ where: { detectionId } });
  }
  if (!detection) {
    return NextResponse.json({ error: "Detection not found" }, { status: 404 });
  }

  const updated = await prisma.splunkDetection.update({
    where: { id: detection.id },
    data: {
      verified: verified !== false,
      verifiedAt: verified !== false ? new Date() : null,
      verifiedTechnique: techniqueId || detection.verifiedTechnique,
    },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    verified: updated.verified,
    verifiedAt: updated.verifiedAt,
    verifiedTechnique: updated.verifiedTechnique,
  });
}
