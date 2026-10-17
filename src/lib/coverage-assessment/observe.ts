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
export interface ObserveResult { bucket: VisBucket; count: number; indicators: string[]; error?: string }

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
    return { bucket: count > 0 ? "visible" : "absent", count, indicators: distinctive };
  } catch (e: any) {
    return { bucket: "absent", count: 0, indicators: distinctive, error: e?.message || String(e) };
  }
}
