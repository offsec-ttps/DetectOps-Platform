/**
 * Splunk SIEM provider — the multi-strategy detection querying extracted from
 * the original /api/sar/detect route so every environment (local/cloud/fleet)
 * shares one code path. Uses Node https directly to accept self-signed certs
 * (Next fetch ignores NODE_TLS_REJECT_UNAUTHORIZED). Auth: bearer token or
 * basic (admin:password).
 */

import https from "node:https";
import http from "node:http";
import type { SiemConfig, SplunkConfig, DetectionQuery, SiemDetectionResult, SiemTestResult, SiemProvider, DetectionStrategy } from "../types";

function authHeaderOf(cfg: SplunkConfig): string {
  if (cfg.authMode === "token" && cfg.token) return `Bearer ${cfg.token}`;
  const user = cfg.username || "admin";
  return `Basic ${Buffer.from(`${user}:${cfg.password || ""}`).toString("base64")}`;
}

function splunkFetch(url: string, authHeader: string, method: "GET" | "POST" = "GET", body?: string):
  Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === "https:";
  return new Promise((resolve) => {
    const headers: Record<string, string> = { Authorization: authHeader };
    if (body) { headers["Content-Type"] = "application/x-www-form-urlencoded"; headers["Content-Length"] = String(Buffer.byteLength(body)); }
    const transport = isHttps ? https : http;
    const req = transport.request(
      { hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80), path: parsed.pathname + parsed.search, method, headers, rejectUnauthorized: false },
      (res) => { let raw = ""; res.on("data", (c) => (raw += c)); res.on("end", () => { const s = res.statusCode || 500; resolve({ ok: s < 400, status: s, json: async () => JSON.parse(raw), text: async () => raw }); }); },
    );
    req.on("error", () => resolve({ ok: false, status: 0, json: async () => ({}), text: async () => "" }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, status: 0, json: async () => ({}), text: async () => "timeout" }); });
    if (body) req.write(body);
    req.end();
  });
}

function splunkSearch(baseUrl: string, authHeader: string, spl: string, earliest?: string, latest?: string):
  Promise<{ count: number; results: any[]; error?: string }> {
  const normalizedSpl = spl.trimStart().startsWith("search ") || spl.trimStart().startsWith("|") ? spl : `search ${spl}`;
  const params: Record<string, string> = { search: normalizedSpl, output_mode: "json", count: "50" };
  if (earliest) params.earliest_time = earliest;
  if (latest) params.latest_time = latest;
  const body = new URLSearchParams(params).toString();
  const url = new URL(`${baseUrl}/services/search/jobs/export`);
  const isHttps = url.protocol === "https:";
  return new Promise((resolve) => {
    const transport = isHttps ? https : http;
    const req = transport.request(
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname, method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
        rejectUnauthorized: false },
      (res) => {
        let raw = ""; res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) { resolve({ count: 0, results: [], error: `Splunk API ${res.statusCode}: ${raw.slice(0, 300)}` }); return; }
          const out: any[] = [];
          for (const line of raw.split("\n")) { if (!line.trim()) continue; try { const o = JSON.parse(line); if (o.result) out.push(o.result); else if (Array.isArray(o.results)) out.push(...o.results); } catch { /* skip */ } }
          resolve({ count: out.length, results: out });
        });
      },
    );
    req.on("error", (e) => resolve({ count: 0, results: [], error: e.message }));
    req.setTimeout(120000, () => { req.destroy(); resolve({ count: 0, results: [], error: "Search timed out after 120s" }); });
    req.write(body); req.end();
  });
}

/** Connectivity/auth check — GET server/info. */
export async function testSplunk(cfg: SplunkConfig): Promise<SiemTestResult> {
  if (!cfg.url) return { ok: false, error: "Splunk URL not set" };
  const auth = authHeaderOf(cfg);
  const res = await splunkFetch(`${cfg.url.replace(/\/$/, "")}/services/server/info?output_mode=json`, auth);
  if (!res.ok) return { ok: false, error: res.status ? `Splunk returned HTTP ${res.status}` : "unreachable" };
  try { const j = await res.json(); const c = j?.entry?.[0]?.content; return { ok: true, detail: c ? `Splunk ${c.version || "?"} · ${c.serverName || ""}`.trim() : "reachable" }; }
  catch { return { ok: true, detail: "reachable" }; }
}

/** Run one detection over the window, using the 5-strategy approach. */
export async function runSplunkDetection(cfg: SplunkConfig, opts: DetectionQuery): Promise<SiemDetectionResult> {
  const baseUrl = cfg.url.replace(/\/$/, "");
  const auth = authHeaderOf(cfg);
  const { query: searchQuery, detectionName = "", techniqueId = "" } = opts;
  const earliestTime = `-${Math.max(1, opts.windowMinutes || 30)}m`;
  const latestTime = "now";
  const results: DetectionStrategy[] = [];

  // 1. ESCU saved searches (triggered alerts matching the detection name)
  try {
    const ssName = encodeURIComponent(detectionName);
    const r = await splunkFetch(`${baseUrl}/services/saved/searches?output_mode=json&count=30&search=${ssName}`, auth);
    if (r.ok) {
      const data = await r.json();
      const matches = (data.entry || []).filter((e: any) => { const n = (e.name || "").toLowerCase(); const d = detectionName.toLowerCase(); return n === d || n.includes(d.replace(/[^a-z0-9]/g, " ").trim()); });
      for (const ss of matches) { const t = ss.content?.triggered_alert_count || 0; if (t > 0) results.push({ strategy: "escu_saved_search", found: true, resultCount: t, details: `ESCU saved search "${ss.name}" has ${t} triggered alert(s)` }); }
      if (results.length === 0 && matches.length > 0) results.push({ strategy: "escu_saved_search", found: false, resultCount: 0, details: `Found saved search "${matches[0].name}" but no triggered alerts` });
    }
  } catch { /* continue */ }

  // 2. Fired alerts
  try {
    const r = await splunkFetch(`${baseUrl}/services/alerts/fired_alerts?output_mode=json&count=50`, auth);
    if (r.ok) {
      const data = await r.json();
      const matches = (data.entry || []).filter((e: any) => { const n = (e.name || "").toLowerCase(); return n.includes(detectionName.substring(0, 20).toLowerCase()) || (techniqueId && n.includes(techniqueId.toLowerCase())); });
      if (matches.length > 0) { const total = matches.reduce((s: number, a: any) => s + (a.content?.triggered_alerts || 1), 0); results.push({ strategy: "fired_alerts", found: true, resultCount: total, details: `${matches.length} fired alert(s) matching "${detectionName}"` }); }
    }
  } catch { /* continue */ }

  // 3. Notable index (ES correlation)
  try {
    const notable = techniqueId ? `search index=notable mitre_technique_id="${techniqueId}" | head 20`
      : `search index=notable "${detectionName.replace(/"/g, '\\"').substring(0, 60)}" | head 20`;
    const nr = await splunkSearch(baseUrl, auth, notable, earliestTime, latestTime);
    if (nr.count > 0) results.push({ strategy: "notable_index", found: true, resultCount: nr.count, details: `${nr.count} notable event(s) in Splunk ES`, results: nr.results.slice(0, 5) });
  } catch { /* ES may be absent */ }

  // 4. Direct SPL
  if (searchQuery) {
    try {
      const dr = await splunkSearch(baseUrl, auth, `${searchQuery} | head 50`, earliestTime, latestTime);
      results.push({ strategy: "direct_spl", found: dr.count > 0, resultCount: dr.count, details: dr.count > 0 ? `Direct SPL returned ${dr.count} result(s)` : dr.error || "No results from direct SPL", results: dr.results.slice(0, 5) });
    } catch (e) { results.push({ strategy: "direct_spl", found: false, resultCount: 0, details: `SPL error: ${e instanceof Error ? e.message : String(e)}` }); }
  }

  // 5. Raw telemetry check
  if (techniqueId) {
    try {
      const tr = await splunkSearch(baseUrl, auth, `search (index=sysmon OR index=wineventlog OR index=win OR index=main) | head 20 | stats count`, earliestTime, latestTime);
      const raw = tr.results[0]?.count ? Number(tr.results[0].count) : tr.count;
      results.push(raw > 0
        ? { strategy: "telemetry_check", found: true, resultCount: raw, details: `${raw} raw telemetry event(s) — data is flowing to Splunk` }
        : { strategy: "telemetry_check", found: false, resultCount: 0, details: `No telemetry for ${techniqueId} — check Sysmon/WinEventLog forwarding` });
    } catch { /* ignore */ }
  }

  const detected = results.some((r) => r.found && r.strategy !== "telemetry_check");
  const totalMatches = results.filter((r) => r.strategy !== "telemetry_check").reduce((s, r) => s + r.resultCount, 0);
  const hasTelemetry = results.some((r) => r.strategy === "telemetry_check" && r.found);
  const diagnostics: string[] = [];
  let summary: string;
  if (detected) {
    summary = `Detection "${detectionName}" validated — ${totalMatches} match(es)`;
  } else {
    summary = `Detection "${detectionName}" not triggered — ${results.length} strategies checked`;
    if (!searchQuery) diagnostics.push("No SPL query provided — only saved-search/alert checks ran.");
    if (hasTelemetry) diagnostics.push("Raw telemetry IS flowing, but the SPL didn't match — check macros (security_content_summariesonly), data models, or index/sourcetype filters.");
    if (!hasTelemetry && techniqueId) diagnostics.push("No raw telemetry found — logs may still be in transit (wait + retry) or forwarding is misconfigured.");
  }
  return { detected, resultCount: totalMatches, strategies: results, diagnostics, summary };
}

export const splunkProvider: SiemProvider = {
  kind: "splunk",
  displayName: "Splunk",
  language: "spl",
  test: (cfg: SiemConfig) => testSplunk(cfg as SplunkConfig),
  runDetection: (cfg: SiemConfig, opts) => runSplunkDetection(cfg as SplunkConfig, opts),
};
