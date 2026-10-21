/**
 * GET /api/v1/agent/download?os=&arch=   (AGENT-FACING — installer download)
 *
 * Streams the published agent binary for an OS/arch. Intentionally PUBLIC and
 * UNAUTHENTICATED (no enrollment token is checked here — the binary is not a
 * secret, like Caldera serving Sandcat). Possessing the binary grants nothing:
 * joining a fleet requires a valid enrollment token at /api/v1/enroll-node, and
 * every later call requires the per-node API key. The install one-liner
 * verifies the sha256 from the manifest before running the binary. The file
 * name is built only from normalised os/arch allow-list values (no traversal).
 *
 * 404 when no binary is published for that OS/arch (the caller then falls back
 * to build-from-source).
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { resolveArtifact, normalizeOs } from "@/lib/bas/artifacts";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const os = sp.get("os") || "linux";
  const arch = sp.get("arch") || "x86_64";

  const art = await resolveArtifact(os, arch);
  if (!art.available) {
    return NextResponse.json(
      { error: `no published binary for ${normalizeOs(os)}/${arch}`, hint: "build from source: cargo build --release -p bas-agent" },
      { status: 404 },
    );
  }

  const buf = await fs.readFile(art.absPath);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${art.filename}"`,
      "Content-Length": String(art.sizeBytes),
      "X-Agent-Version": art.version,
      "X-Agent-Sha256": art.sha256,
      "Cache-Control": "no-store",
    },
  });
}
