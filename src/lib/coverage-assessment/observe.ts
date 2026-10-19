import type { SiemConnection } from "@/generated/prisma/client";
import { getSiemProvider, resolveSiemConfig } from "@/lib/siem/registry";
import { distinctiveTokens } from "./tokens";

// Telemetry-visibility observation: search the SIEM over the recent window for a
// distinctive indicator of the just-detonated atomic. "visible" = the indicator
// reached the SIEM (the prerequisite for detection); "generic-only" = the atomic
// has no distinctive indicator (only a generic shell) so attribution is
// indeterminate; "absent" = a distinctive indicator ran but produced no log (a
// telemetry blind spot). This measures VISIBILITY, not a firing detection.

export type VisBucket = "visible" | "generic-only" | "absent";
export interface ObserveResult {
  bucket: VisBucket;
  count: number;
  indicators: string[];
  eventCodes?: string[];   // distinct Windows Event IDs that carried the indicator (e.g. "1","4688","4104")
  sources?: string[];      // distinct SIEM sourcetypes/log channels the hits came from
  error?: string;
}

// Pull the distinct Event IDs and sourcetypes out of the raw events a "direct"
// search strategy returned, so the report can state WHICH log (and which EID)
// gives visibility — and, by their absence, where the blind spot is.
function extractEventMeta(results: unknown[] | undefined): { eventCodes: string[]; sources: string[] } {
  const codes = new Set<string>();
  const sources = new Set<string>();
  for (const r of results || []) {
    const row = r as Record<string, any>;
    if (!row || typeof row !== "object") continue;
    const ec = row.EventCode ?? row.EventID ?? row.event_id ?? row.winlog?.event_id;
    if (ec !== undefined && ec !== null && String(ec).trim()) codes.add(String(ec).trim());
    const st = row.sourcetype ?? row.source ?? row._sourcetype;
    if (st !== undefined && st !== null && String(st).trim()) sources.add(String(st).trim());
  }
  return { eventCodes: [...codes].slice(0, 8), sources: [...sources].slice(0, 6) };
}

function buildQuery(language: "spl" | "kql", tokens: string[]): string {
  const safe = tokens.map((t) => t.replace(/["\\]/g, ""));
  if (language === "kql") {
    const list = safe.map((t) => `"${t}"`).join(", ");
    return `union withsource=_tbl DeviceProcessEvents, DeviceEvents, DeviceRegistryEvents, DeviceNetworkEvents | where * has_any (${list})`;
  }
  const kw = safe.map((t) => `"${t}"`).join(" OR ");
  return `search index=* (sourcetype=xmlwineventlog OR sourcetype=WinEventLog OR sourcetype=wineventlog) (${kw})`;
}

export async function observeAtomic(conn: SiemConnection, command: string, windowMinutes = 15): Promise<ObserveResult> {
  const { distinctive, genericOnly } = distinctiveTokens(command);
  if (genericOnly) return { bucket: "generic-only", count: 0, indicators: [] };

  const resolved = resolveSiemConfig(conn);
  if (!resolved.ok) return { bucket: "absent", count: 0, indicators: distinctive, error: resolved.reason };
  const prov = getSiemProvider(conn.kind);
  if (!prov) return { bucket: "absent", count: 0, indicators: distinctive, error: `no provider for ${conn.kind}` };

  const query = buildQuery(prov.language, distinctive);
  try {
    const res = await prov.runDetection(resolved.cfg, { query, windowMinutes });
    // Prefer the raw-search strategy count (telemetry presence), not alert hits.
    const direct = (res.strategies || []).find((s) => s.strategy === "direct_spl" || s.strategy === "direct_kql");
    const count = direct ? direct.resultCount : res.resultCount;
    const { eventCodes, sources } = extractEventMeta(direct?.results);
    return { bucket: count > 0 ? "visible" : "absent", count, indicators: distinctive, eventCodes, sources };
  } catch (e: any) {
    return { bucket: "absent", count: 0, indicators: distinctive, error: e?.message || String(e) };
  }
}
