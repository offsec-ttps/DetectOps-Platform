/**
 * POST /api/fleets/[id]/detect   (dashboard-facing)
 *
 * Detection-validation step for the fleet Simulation & Detection wizard. For a
 * set of ATT&CK techniques just simulated on the fleet's endpoints, find the
 * matching community Splunk detections and run them against the configured SIEM
 * over the run window — returning a detected / missed verdict per technique
 * (the real-time "did the SIEM catch it" scoreboard).
 *
 * Body: { techniques: string[], minutes?: number (default 30) }
 * Returns: { siem, results: [{ technique, detected, detections: [{name, fired, eventCount, error?}] }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFleetAccess } from "@/lib/bas/fleet";

function safeArr(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

/** Run one SPL search against Splunk's export endpoint; count returned events. */
async function runSplunkSearch(apiUrl: string, token: string, spl: string, earliest: string, latest: string): Promise<{ eventCount: number; error?: string }> {
  try {
    const url = `${apiUrl.replace(/\/$/, "")}/services/search/jobs/export`;
    const body = new URLSearchParams({
      search: spl.trim().startsWith("search") || spl.trim().startsWith("|") ? spl : `search ${spl}`,
      output_mode: "json", earliest_time: earliest, latest_time: latest, preview: "false",
    });
    // NOTE: for a self-signed lab Splunk, add its CA to the trust store (or set
    // NODE_TLS_REJECT_UNAUTHORIZED=0 at the operator's discretion) — we do NOT
    // disable TLS verification per-request.
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { eventCount: 0, error: `Splunk HTTP ${res.status}` };
    const text = await res.text();
    // export returns newline-delimited JSON results; count non-empty lines with a "result".
    const count = text.split("\n").filter((l) => l.includes('"result"')).length;
    return { eventCount: count };
  } catch (e: any) {
    return { eventCount: 0, error: e?.name === "TimeoutError" ? "Splunk search timed out" : (e?.message || String(e)) };
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireFleetAccess(id);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));
  const techniques: string[] = Array.isArray(body.techniques) ? body.techniques.map(String).slice(0, 40) : [];
  if (techniques.length === 0) return NextResponse.json({ error: "no techniques" }, { status: 400 });
  const minutes = Math.min(1440, Math.max(1, Number(body.minutes) || 30));

  // SIEM integration (Splunk).
  const siem = await prisma.integration.findFirst({ where: { type: "siem", enabled: true } });
  if (!siem || !siem.apiUrl || !(siem.apiKey || siem.password)) {
    return NextResponse.json({
      siem: siem ? { name: siem.name, connected: false } : null,
      error: "No connected SIEM integration. Configure Splunk under Integrations to enable detection validation.",
      results: techniques.map((t) => ({ technique: t, detected: false, detections: [], siemUnavailable: true })),
    });
  }
  const token = siem.apiKey || siem.password || "";
  const earliest = `-${minutes}m`;
  const latest = "now";

  const results = await Promise.all(techniques.map(async (technique) => {
    // Match community Splunk detections by technique.
    const rules = await prisma.splunkDetection.findMany({
      where: { mitreTechniques: { contains: `"${technique}"` } },
      take: 4,
    });
    const detections = await Promise.all(rules.map(async (r) => {
      const techs = safeArr(r.mitreTechniques);
      if (!techs.includes(technique)) return null;
      const run = await runSplunkSearch(siem.apiUrl, token, r.search, earliest, latest);
      return { name: r.name, detectionId: r.detectionId, fired: run.eventCount > 0, eventCount: run.eventCount, error: run.error };
    }));
    const real = detections.filter(Boolean) as Array<{ fired: boolean }>;
    return { technique, detected: real.some((d) => d.fired), detectionCount: real.length, detections: real };
  }));

  return NextResponse.json({ siem: { name: siem.name, connected: true }, windowMinutes: minutes, results });
}
