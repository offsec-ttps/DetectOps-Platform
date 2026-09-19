/**
 * ransomware.live collector — open clearnet API for ransomware groups + recent
 * victims. Optional API key via RANSOMWARE_LIVE_API_KEY (newer API versions).
 * Best-effort + defensive: a source outage returns errors, never throws.
 */

import { fetchJson } from "./_http";
import type { Collector, CollectResult, NormalizedGang, NormalizedVictim } from "./types";

const BASE = process.env.RANSOMWARE_LIVE_BASE || "https://api.ransomware.live";
function authHeaders(): Record<string, string> {
  const k = process.env.RANSOMWARE_LIVE_API_KEY;
  return k ? { "X-Api-Key": k } : {};
}
function asArr(v: any): any[] { return Array.isArray(v) ? v : []; }
function safeIso(s: any): string | undefined {
  if (!s) return undefined;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export const ransomwareLiveCollector: Collector = {
  id: "ransomware-live",
  meta: () => ({ id: "ransomware-live", name: "ransomware.live (open API)", active: true }),
  async collect(): Promise<CollectResult> {
    const errors: string[] = [];
    const groups: NormalizedGang[] = [];
    const victims: NormalizedVictim[] = [];
    const headers = authHeaders();

    try {
      const raw = await fetchJson<any[]>(`${BASE}/groups`, { headers });
      for (const g of asArr(raw)) {
        groups.push({
          name: String(g.name || g.group_name || "").trim(),
          description: String(g.description || g.meta || ""),
          leakSiteUrls: asArr(g.locations).map((l: any) => l?.fqdn || l?.url || l).filter(Boolean),
          profile: { raw: g },
          references: asArr(g.profile).map((u: any) => ({ title: "profile", url: String(u) })).filter((r) => r.url),
        });
      }
    } catch (e: any) { errors.push(`groups: ${e?.message || e}`); }

    try {
      const recent = await fetchJson<any[]>(`${BASE}/recentvictims`, { headers });
      for (const v of asArr(recent)) {
        const victim = String(v.victim || v.post_title || "").trim();
        const gangName = String(v.group || v.group_name || "").trim();
        if (!victim || !gangName) continue;
        victims.push({
          gangName, victim,
          sector: String(v.activity || v.sector || ""),
          country: String(v.country || ""),
          postUrl: String(v.url || v.link || ""),
          screenshotRef: String(v.screenshot || ""),
          discoveredAt: safeIso(v.discovered),
        });
      }
    } catch (e: any) { errors.push(`recentvictims: ${e?.message || e}`); }

    return { groups: groups.filter((g) => g.name), victims, errors };
  },
};
