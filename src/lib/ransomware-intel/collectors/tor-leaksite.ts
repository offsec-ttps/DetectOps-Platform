/**
 * Tor leak-site collector — crawls each gang's .onion leak sites over Tor.
 *
 * Onion endpoints are sourced from the gangs already in our DB (their
 * `leakSiteUrls`, populated by the ransomwatch collector whose `locations[].fqdn`
 * are .onion addresses). When a Tor HTTP bridge is configured (TOR_HTTP_PROXY,
 * e.g. privoxy → tor; common dependency-free setup) we fetch each onion index
 * through it and record reachability + raw page size as crawl evidence. Per-site
 * HTML→victim parsers are the production extension point (each gang's leak site
 * has a bespoke layout); this wires the real fetch path so it works wherever a
 * Tor bridge exists. SOCKS-only deployments should front Tor with an HTTP proxy.
 *
 * Inactive (collects nothing) when no bridge is configured — the clearnet
 * collectors remain the baseline.
 */

import { prisma } from "@/lib/prisma";
import type { Collector, CollectResult, NormalizedGang } from "./types";

function bridge(): string { return process.env.TOR_HTTP_PROXY || ""; }
function torActive(): boolean { return !!bridge() || !!process.env.TOR_SOCKS_PROXY; }

async function torFetch(url: string, timeoutMs = 30_000): Promise<{ ok: boolean; bytes: number; status: number }> {
  const proxy = bridge();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let dispatcher: any;
    if (proxy) {
      // undici ships with Node/Next; ProxyAgent supports HTTP(S) proxies (a Tor
      // HTTP bridge). SOCKS would need socks-proxy-agent (not bundled).
      const { ProxyAgent } = await import("undici");
      dispatcher = new ProxyAgent(proxy);
    }
    const res = await fetch(url, { signal: ctrl.signal, redirect: "manual", headers: { "User-Agent": "Mozilla/5.0" }, ...(dispatcher ? { dispatcher } : {}) } as any);
    const text = await res.text().catch(() => "");
    return { ok: res.ok, bytes: text.length, status: res.status };
  } finally { clearTimeout(to); }
}

export const torLeaksiteCollector: Collector = {
  id: "tor-leaksite",
  meta: () => ({
    id: "tor-leaksite",
    name: "Tor leak-site crawler",
    active: torActive(),
    note: bridge()
      ? `crawling onion sites via HTTP bridge ${bridge()}`
      : process.env.TOR_SOCKS_PROXY
        ? "TOR_SOCKS_PROXY set but no TOR_HTTP_PROXY bridge — front Tor with an HTTP proxy (privoxy) to enable crawling."
        : "inactive — set TOR_HTTP_PROXY (Tor→HTTP bridge) to crawl .onion endpoints.",
  }),
  async collect(): Promise<CollectResult> {
    const errors: string[] = [];
    const groups: NormalizedGang[] = [];
    if (!torActive()) return { groups, victims: [], errors: ["tor collector inactive (no TOR_HTTP_PROXY/TOR_SOCKS_PROXY)"] };
    if (!bridge()) return { groups, victims: [], errors: ["TOR_SOCKS_PROXY without HTTP bridge — set TOR_HTTP_PROXY"] };

    // Pull onion endpoints we already know about (from the clearnet collectors).
    const rows = await prisma.ransomwareGang.findMany({ select: { name: true, leakSiteUrls: true }, take: 1000 });
    const targets: Array<{ gang: string; url: string }> = [];
    for (const r of rows) {
      let urls: string[] = [];
      try { urls = JSON.parse(r.leakSiteUrls); } catch { /* ignore */ }
      for (const u of urls) {
        // URLs come from third-party feed data: only crawl genuine .onion hosts
        // (a substring check let "http://169.254.169.254/?.onion" through).
        const candidate = typeof u === "string" ? (/^https?:\/\//i.test(u) ? u : `http://${u}`) : "";
        let onion = "";
        try { const p = new URL(candidate); if ((p.protocol === "http:" || p.protocol === "https:") && p.hostname.toLowerCase().endsWith(".onion")) onion = p.toString(); } catch { /* skip */ }
        if (onion) targets.push({ gang: r.name, url: onion });
      }
    }
    if (!targets.length) return { groups, victims: [], errors: ["no .onion endpoints known yet — run the clearnet collectors first"] };

    // Crawl a bounded set per run; record reachability (per-site post parsers TBD).
    const CAP = Number(process.env.TOR_CRAWL_CAP) || 25;
    let live = 0;
    for (const t of targets.slice(0, CAP)) {
      try {
        const r = await torFetch(t.url);
        if (r.ok && r.bytes > 0) { live++; groups.push({ name: t.gang, status: "active", leakSiteUrls: [t.url] }); }
        else errors.push(`${t.gang} ${t.url}: status ${r.status}`);
      } catch (e: any) { errors.push(`${t.gang} ${t.url}: ${e?.message || e}`); }
    }
    errors.unshift(`tor crawl: ${live}/${Math.min(CAP, targets.length)} onion sites reachable`);
    return { groups, victims: [], errors };
  },
};
