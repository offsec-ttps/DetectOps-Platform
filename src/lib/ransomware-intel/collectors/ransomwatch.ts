/**
 * Ransomwatch collector — ingests the open, clearnet-published aggregation of
 * ransomware leak-site groups + victim posts (GitHub-raw JSON). Same kind of
 * data RansomLook aggregates, no Tor required. Normalizes defensively.
 */

import { fetchJson } from "./_http";
import type { Collector, CollectResult, NormalizedGang, NormalizedVictim } from "./types";

const BASE = process.env.RANSOMWATCH_RAW_BASE || "https://raw.githubusercontent.com/joshhighet/ransomwatch/main";
const SHOTS = process.env.RANSOMWATCH_SCREENSHOT_BASE || "https://raw.githubusercontent.com/joshhighet/ransomwatch/main/docs/_screenshots";

function asArr(v: any): any[] { return Array.isArray(v) ? v : []; }
function safeIso(s: any): string | undefined {
  if (!s) return undefined;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export const ransomwatchCollector: Collector = {
  id: "ransomwatch",
  meta: () => ({ id: "ransomwatch", name: "Ransomwatch (open dataset)", active: true }),
  async collect(): Promise<CollectResult> {
    const errors: string[] = [];
    const groups: NormalizedGang[] = [];
    const victims: NormalizedVictim[] = [];

    try {
      const raw = await fetchJson<any[]>(`${BASE}/groups.json`);
      for (const g of asArr(raw)) {
        const locations = asArr(g.locations);
        const screen = locations.map((l: any) => l?.screen).find(Boolean);
        groups.push({
          name: String(g.name || "").trim(),
          status: locations.some((l: any) => l?.available) ? "active" : "unknown",
          leakSiteUrls: locations.map((l: any) => l?.fqdn || l?.slug).filter(Boolean),
          screenshotRef: screen ? `${SHOTS}/${screen}` : "",
          profile: { meta: g.meta ?? null, profile: g.profile ?? null },
          references: asArr(g.profile).map((u: any) => ({ title: "profile", url: String(u) })).filter((r) => r.url),
        });
      }
    } catch (e: any) { errors.push(`groups.json: ${e?.message || e}`); }

    try {
      const posts = await fetchJson<any[]>(`${BASE}/posts.json`);
      // 16k+ posts — keep the most recent for a snappy collect; older history is
      // still reachable on demand. Sort by discovered desc, cap.
      const CAP = Number(process.env.RANSOMWATCH_POST_CAP) || 4000;
      const sorted = asArr(posts).sort((a, b) => String(b.discovered || "").localeCompare(String(a.discovered || ""))).slice(0, CAP);
      for (const p of sorted) {
        const victim = String(p.post_title || p.title || "").trim();
        const gangName = String(p.group_name || p.group || "").trim();
        if (!victim || !gangName) continue;
        victims.push({
          gangName, victim,
          postUrl: String(p.link || p.url || ""),
          discoveredAt: safeIso(p.discovered),
        });
      }
    } catch (e: any) { errors.push(`posts.json: ${e?.message || e}`); }

    return { groups: groups.filter((g) => g.name), victims, errors };
  },
};
