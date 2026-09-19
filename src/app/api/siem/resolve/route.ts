/**
 * GET /api/siem/resolve?source=local|cloud|fleet|c2&targetRef=<optional>
 *
 * Returns the SIEM connection the Campaign Designer should validate against for
 * a given simulation environment (auto-provisioning the local SAR Splunk), plus
 * the provider's query language. `connection: null` means the user must connect
 * one (surface a "Connect a SIEM" prompt — expected for fleet/cloud).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { resolveEnvSiemConnection } from "@/lib/siem/resolve-env";
import { getSiemProvider } from "@/lib/siem/registry";
import { serializeSiem } from "@/lib/siem/http";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const source = (req.nextUrl.searchParams.get("source") || "local").toLowerCase();
  const targetRef = req.nextUrl.searchParams.get("targetRef") || undefined;

  const conn = await resolveEnvSiemConnection(source, auth.user.id, targetRef).catch(() => null);
  if (!conn) return NextResponse.json({ connection: null, language: null });
  const prov = getSiemProvider(conn.kind);
  return NextResponse.json({ connection: serializeSiem(conn), language: prov?.language || "spl" });
}
