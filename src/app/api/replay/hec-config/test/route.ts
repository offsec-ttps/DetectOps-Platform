/**
 * POST /api/replay/hec-config/test
 *   Sends one synthetic test event to the currently configured HEC endpoint.
 *   Returns the upstream HTTP status + body so the user can verify their
 *   config works BEFORE running a real replay.
 *
 * Uses node's `https.request` directly (not fetch/undici) so it can skip
 * TLS verification against Splunk's self-signed cert.
 */

import { NextResponse } from "next/server";
import https from "https";
import { randomUUID } from "crypto";
import { getEffectiveHecConfig } from "@/lib/hec-config";
import { safeLookup, labOutboundPolicy, syncUrlBlockReason } from "@/lib/net/ssrf";

function hecRequest(host: string, port: number, token: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const channel = randomUUID();
    const body = JSON.stringify({
      event: { msg: "detection-platform HEC connectivity test", ts: new Date().toISOString() },
      index: "main",
      source: "detection-platform",
      sourcetype: "detection-platform:hec-test",
    });
    const req = https.request({
      method: "POST",
      hostname: host,
      port,
      path: "/services/collector/event",
      headers: {
        "Authorization": `Splunk ${token}`,
        "X-Splunk-Request-Channel": channel,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      rejectUnauthorized: false,
      timeout: 15000,
      lookup: safeLookup(labOutboundPolicy("SIEM_ALLOW_LOOPBACK")) as any,
    }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n <= 64 * 1024) chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("timeout", () => { req.destroy(new Error("request timed out")); });
    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

export async function POST() {
  const eff = getEffectiveHecConfig();
  if (!eff.host || !eff.token) {
    return NextResponse.json({
      status: "error",
      message: "HEC is not configured. Click 'Auto-configure from cloud range' or fill in the manual form.",
    }, { status: 400 });
  }

  const blocked = syncUrlBlockReason(`https://${eff.host.includes(":") && !eff.host.startsWith("[") ? `[${eff.host}]` : eff.host}:${eff.port}/`, labOutboundPolicy("SIEM_ALLOW_LOOPBACK"));
  if (blocked) return NextResponse.json({ status: "error", message: `HEC host blocked: ${blocked}` }, { status: 400 });

  try {
    const r = await hecRequest(eff.host, eff.port, eff.token);
    const ok = r.status === 200;
    return NextResponse.json({
      status: ok ? "ok" : "error",
      httpStatus: r.status,
      upstreamBody: r.text.slice(0, 400),
      message: ok
        ? `HEC responded 200 OK. Verify in Splunk: search sourcetype="detection-platform:hec-test"`
        : `HEC returned HTTP ${r.status}. ${r.text.slice(0, 200)}`,
    }, { status: ok ? 200 : 502 });
  } catch (e: any) {
    return NextResponse.json({
      status: "error",
      message: `Cannot reach https://${eff.host}:${eff.port}: ${e?.message || e}. Check tunnel + firewall.`,
    }, { status: 502 });
  }
}
