/**
 * GET /api/c2/[id]/enroll?os=windows|linux|darwin
 *
 * Returns the beacon-enrollment one-liner for this C2. The beacon is a
 * lightweight in-memory implant pulled from the C2 over the LAN — no bulk
 * tooling install, no AV exclusions, no per-run endpoint internet.
 */

import { NextRequest, NextResponse } from "next/server";
import { getProvider } from "@/lib/c2/registry";
import type { C2Os } from "@/lib/c2/types";
import { loadOwnedC2 } from "@/lib/c2/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await loadOwnedC2(id);
  if (!r.ok) return r.response;
  const prov = getProvider(r.server.provider);
  if (!prov) return NextResponse.json({ error: "unknown provider" }, { status: 400 });

  const osParam = (req.nextUrl.searchParams.get("os") || "windows").toLowerCase();
  const os: C2Os = osParam === "linux" ? "linux" : osParam === "darwin" ? "darwin" : "windows";
  const command = prov.enrollmentCommand(r.server, os);
  return NextResponse.json({ os, command });
}
