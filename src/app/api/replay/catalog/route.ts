/**
 * GET /api/replay/catalog
 * Searchable, filterable, paginated catalog of attack_data replay datasets.
 *
 * Query params:
 *   q              — full-text search across name, id, description, mitre, etc.
 *   platform       — filter (windows, linux, aws, azure, m365, ...)
 *   category       — top-level subfolder under datasets/
 *   logType        — sysmon, powershell, dns, network, ...
 *   environment
 *   sourcetype
 *   mitreId        — single technique ID, partial match
 *   replayableOnly — "true"/"1" to only return rows with existing data files
 *   page           — default 1
 *   pageSize       — default 50, max 500
 *   sortBy, sortDir
 */

import { NextRequest, NextResponse } from "next/server";
import { queryCatalog, REPLAY_FEATURE_ENABLED } from "@/lib/attack-data/scanner";
import { getHecStatus } from "@/lib/attack-data/replay-hec";

export async function GET(req: NextRequest) {
  if (!REPLAY_FEATURE_ENABLED) {
    return NextResponse.json({ enabled: false, error: "Attack data replay feature is disabled" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const result = queryCatalog({
    q: searchParams.get("q") || undefined,
    platform: searchParams.get("platform") || undefined,
    category: searchParams.get("category") || undefined,
    logType: searchParams.get("logType") || undefined,
    environment: searchParams.get("environment") || undefined,
    sourcetype: searchParams.get("sourcetype") || undefined,
    mitreId: searchParams.get("mitreId") || undefined,
    replayableOnly: ["true", "1"].includes((searchParams.get("replayableOnly") || "").toLowerCase()),
    page: parseInt(searchParams.get("page") || "1", 10),
    pageSize: parseInt(searchParams.get("pageSize") || "50", 10),
    sortBy: (searchParams.get("sortBy") as any) || undefined,
    sortDir: (searchParams.get("sortDir") as any) || undefined,
  });

  return NextResponse.json({
    enabled: true,
    ...result,
    hec: getHecStatus(),
  });
}
