/**
 * GET /api/v1/agent/manifest?os=&arch=&channel=   (AGENT-FACING)
 *
 * The install one-liner + self-update path fetch this to learn the current
 * agent version, its download URL, and the expected sha256 (verified before
 * the binary is run).
 *
 * When a binary is published under bas-agent/dist (via scripts/publish-bas-agent.sh)
 * this returns `available:true` + the real sha256 + a download URL. Otherwise
 * `available:false` and the caller falls back to build-from-source.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveArtifact, normalizeOs, normalizeArch } from "@/lib/bas/artifacts";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const os = normalizeOs(sp.get("os") || "linux");
  const arch = normalizeArch(sp.get("arch") || "x86_64");
  const channel = (sp.get("channel") || "stable").toLowerCase();
  const origin = req.nextUrl.origin;

  const art = await resolveArtifact(os, arch);
  return NextResponse.json({
    version: art.version,
    os, arch, channel,
    available: art.available,
    download_url: `${origin}/api/v1/agent/download?os=${os}&arch=${arch}`,
    sha256: art.sha256,                       // empty when not published
    sizeBytes: art.sizeBytes,
    build_from_source_hint: art.available ? undefined : "cargo build --release -p bas-agent",
  });
}
