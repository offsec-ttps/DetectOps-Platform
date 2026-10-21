/**
 * GET  /api/replay/hec-config  — returns current effective config (token NEVER exposed)
 * POST /api/replay/hec-config  — manually set host/port/token. Saves to labs/.hec-config.json.
 * DELETE /api/replay/hec-config — clears the stored config (falls back to env vars).
 */

import { NextRequest, NextResponse } from "next/server";
import { clearHecConfig, getEffectiveHecConfig, saveHecConfig } from "@/lib/hec-config";
import { requireRole } from "@/lib/auth-guard";
import { syncUrlBlockReason, labOutboundPolicy } from "@/lib/net/ssrf";

export async function GET() {
  const eff = getEffectiveHecConfig();
  return NextResponse.json({
    host: eff.host,
    port: eff.port,
    tokenConfigured: !!eff.token,
    tokenLength: eff.token.length,
    source: eff.source, // "stored" | "env" | "none"
    label: eff.label,
    ready: !!eff.host && !!eff.token,
  });
}

export async function POST(req: NextRequest) {
  // Global replay sink (every replay posts events + the HEC token here) → admin.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const host = typeof body.host === "string" ? body.host.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const port = Number.isInteger(body.port) ? body.port : 8088;
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : undefined;

  if (!host) return NextResponse.json({ status: "error", message: "host required" }, { status: 400 });
  if (!token) return NextResponse.json({ status: "error", message: "token required" }, { status: 400 });
  if (port < 1 || port > 65535) return NextResponse.json({ status: "error", message: "invalid port" }, { status: 400 });
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) return NextResponse.json({ status: "error", message: "host must be a hostname or IP" }, { status: 400 });
  const blocked = syncUrlBlockReason(`https://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}/`, labOutboundPolicy("SIEM_ALLOW_LOOPBACK"));
  if (blocked) return NextResponse.json({ status: "error", message: blocked }, { status: 400 });

  const saved = saveHecConfig({ host, token, port, label });
  return NextResponse.json({
    status: "ok",
    host: saved.host,
    port: saved.port,
    tokenConfigured: true,
    tokenLength: saved.token.length,
    label: saved.label,
    updatedAt: saved.updatedAt,
  });
}

export async function DELETE() {
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  clearHecConfig();
  return NextResponse.json({ status: "ok" });
}
