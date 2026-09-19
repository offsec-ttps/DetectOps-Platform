/**
 * GET /api/deploy/capabilities — what deploy paths the Deploy hub should offer.
 * Local Lab is gated to self-hosted installs (PLATFORM_MODE).
 */

import { NextResponse } from "next/server";
import { platformMode, localDeployAvailable } from "@/lib/deploy/mode";

export async function GET() {
  return NextResponse.json({
    mode: platformMode(),
    localAvailable: localDeployAvailable(),
  });
}
