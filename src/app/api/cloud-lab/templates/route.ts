/**
 * GET /api/cloud-lab/templates
 *
 * Proxies the extracted SAR Cloud Controller's Flask API (`GET /templates`) so the
 * Cloud Lab deploy page can list the cloud lab templates it offers (AWS/Azure/GCP)
 * right below "Pre-deploy readiness". Kept as a same-origin proxy so the browser
 * never talks to the controller directly (it may be on a non-public port) and we
 * degrade gracefully with `available:false` when the controller isn't running.
 *
 * The controller is launched alongside the app by start-server.sh (Astro UI on
 * :4321, Flask API on :4000). Override the API base with CLOUD_LAB_API_URL.
 */

import { NextResponse } from "next/server";

const SAR_API = (process.env.CLOUD_LAB_API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function GET() {
  try {
    const r = await fetch(`${SAR_API}/templates`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return NextResponse.json(
        { available: false, error: `Cloud controller API returned ${r.status}`, templates: [], provider_availability: {} },
      );
    }
    const d = await r.json();
    return NextResponse.json({
      available: true,
      apiUrl: SAR_API,
      appUrl: process.env.CLOUD_LAB_APP_URL || "http://localhost:4321",
      templates: d.templates || [],
      provider_availability: d.provider_availability || {},
    });
  } catch (e: any) {
    // Controller not started yet — the UI shows a "start the cloud controller" hint.
    return NextResponse.json({
      available: false,
      error: e?.name === "TimeoutError" ? "Cloud controller API timed out" : (e?.message || "Cloud controller API unreachable"),
      templates: [],
      provider_availability: {},
    });
  }
}
