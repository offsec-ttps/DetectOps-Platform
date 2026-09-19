/**
 * Microsoft Defender for Endpoint (MDE) SIEM provider.
 *
 * Auth: Azure AD app registration (tenantId + clientId + clientSecret) via the
 * OAuth2 client-credentials grant. Detection: Microsoft Graph Advanced Hunting
 * (POST /security/runHuntingQuery with a KQL query). A non-empty result set =
 * detected. Graph uses valid TLS, so plain global fetch is fine here.
 *
 * The app registration needs the Graph application permission
 * `ThreatHunting.Read.All` (admin-consented) for runHuntingQuery.
 */

import type { SiemConfig, MdeConfig, DetectionQuery, SiemDetectionResult, SiemTestResult, SiemProvider } from "../types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getGraphToken(cfg: MdeConfig): Promise<string> {
  if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret) throw new Error("MDE tenantId/clientId/clientSecret not set");
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`AAD token failed (HTTP ${res.status}): ${j.error_description || j.error || "no token"}`.slice(0, 300));
  tokenCache.set(key, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

async function runHuntingQuery(token: string, kql: string): Promise<{ results: any[]; error?: string; status: number }> {
  const res = await fetch(`${GRAPH}/security/runHuntingQuery`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ Query: kql }), signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) return { results: [], status: res.status, error: `Graph runHuntingQuery HTTP ${res.status}: ${(j?.error?.message || text || "").slice(0, 300)}` };
  return { results: Array.isArray(j?.results) ? j.results : [], status: res.status };
}

export async function testMde(cfg: MdeConfig): Promise<SiemTestResult> {
  try {
    const token = await getGraphToken(cfg);
    // Trivial hunting query proves both the token AND ThreatHunting permission.
    const r = await runHuntingQuery(token, "DeviceInfo | take 1");
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, detail: `MDE reachable (tenant ${cfg.tenantId.slice(0, 8)}…) — Advanced Hunting OK` };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Ensure the KQL constrains time; MDE runHuntingQuery has no timespan param. */
function withTimeWindow(kql: string, windowMinutes?: number): string {
  const w = Math.max(1, windowMinutes || 30);
  if (/\bago\s*\(/i.test(kql)) return kql;           // already time-bounded
  // Prepend a bounded base table only when the query starts with a known table.
  const m = kql.match(/^\s*([A-Za-z][A-Za-z0-9]*)\b/);
  if (m && /^(Device|Alert|Email|Identity|Cloud|Url)/.test(m[1])) {
    return kql.replace(/^\s*([A-Za-z][A-Za-z0-9]*)\b/, `$1 | where Timestamp > ago(${w}m)`);
  }
  return kql;
}

export async function runMdeDetection(cfg: MdeConfig, opts: DetectionQuery): Promise<SiemDetectionResult> {
  const { query, detectionName = "", techniqueId = "" } = opts;
  const diagnostics: string[] = [];
  if (!query || !query.trim()) {
    return { detected: false, resultCount: 0, strategies: [{ strategy: "kql", found: false, resultCount: 0, details: "No KQL query provided" }], diagnostics: ["Provide a KQL hunting query for this detection."], summary: `No KQL for "${detectionName}"` };
  }
  try {
    const token = await getGraphToken(cfg);
    const kql = withTimeWindow(query.trim(), opts.windowMinutes);
    const r = await runHuntingQuery(token, kql);
    if (r.error) {
      return { detected: false, resultCount: 0, strategies: [{ strategy: "advanced_hunting", found: false, resultCount: 0, details: r.error }], diagnostics: ["Check the KQL syntax and that the app has ThreatHunting.Read.All (admin-consented)."], summary: `MDE query error for "${detectionName}"` };
    }
    const count = r.results.length;
    const detected = count > 0;
    if (!detected) diagnostics.push(`No matching events in MDE for ${techniqueId || detectionName} — telemetry may still be ingesting (retry), or the KQL/time window doesn't match. MDE Advanced Hunting typically lags a few minutes.`);
    return {
      detected, resultCount: count,
      strategies: [{ strategy: "advanced_hunting", found: detected, resultCount: count, details: detected ? `Advanced Hunting returned ${count} row(s)` : "No rows returned", results: r.results.slice(0, 5) }],
      diagnostics,
      summary: detected ? `Detection "${detectionName}" validated — ${count} row(s) in MDE` : `Detection "${detectionName}" not triggered in MDE`,
    };
  } catch (e: any) {
    return { detected: false, resultCount: 0, strategies: [{ strategy: "advanced_hunting", found: false, resultCount: 0, details: e?.message || String(e) }], diagnostics: ["MDE auth/connectivity failed — verify tenant/client/secret and permissions."], summary: `MDE error for "${detectionName}"` };
  }
}

export const mdeProvider: SiemProvider = {
  kind: "mde",
  displayName: "Microsoft Defender for Endpoint",
  language: "kql",
  test: (cfg: SiemConfig) => testMde(cfg as MdeConfig),
  runDetection: (cfg: SiemConfig, opts) => runMdeDetection(cfg as MdeConfig, opts),
};
