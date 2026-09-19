/**
 * Heuristic format sniffer for uploaded detection rule files.
 *
 * Order of checks is important — Sigma YAML and Elastic TOML share `.yml`
 * extensions sometimes, so content takes precedence over filename.
 */

export type UploadedFormat =
  | "sigma"
  | "spl"
  | "elastic-toml"
  | "kql"
  | "yaml-unknown"
  | "unknown";

interface SnifferResult {
  format: UploadedFormat;
  confidence: number;                                 // 0..1
  reason: string;
}

const SIGMA_MARKERS = [/^\s*title\s*:/m, /^\s*detection\s*:/m, /^\s*logsource\s*:/m];
const ELASTIC_TOML_MARKERS = [/^\[metadata\]/m, /^\[rule\]/m, /\brule_id\s*=/m];
const SPL_MARKERS = [/\bindex\s*=\s*/i, /\b(?:eventtype|sourcetype)\s*=/i, /\|\s*(?:stats|tstats|where|eval|search)\b/i, /\|\s*tstats\b/i];
const KQL_MARKERS = [
  /\b(?:SecurityEvent|DeviceProcessEvents|DeviceFileEvents|DeviceNetworkEvents|SigninLogs|AzureActivity|CloudAppEvents|OfficeActivity|AuditLogs|EmailEvents)\b/,
  /\|\s*(?:where|project|summarize|extend|join|render)\b/,
];

function score(markers: RegExp[], body: string): number {
  let n = 0;
  for (const m of markers) if (m.test(body)) n++;
  return n / markers.length;
}

export function sniffFormat(filename: string, body: string): SnifferResult {
  const lower = (filename || "").toLowerCase();
  const ext = lower.split(".").pop() || "";

  const sigmaScore   = score(SIGMA_MARKERS, body);
  const elasticScore = score(ELASTIC_TOML_MARKERS, body);
  const splScore     = score(SPL_MARKERS, body);
  const kqlScore     = score(KQL_MARKERS, body);

  // Hard heuristic: TOML must have section headers AND rule_id
  if (elasticScore >= 0.66) {
    return { format: "elastic-toml", confidence: elasticScore, reason: "TOML headers + rule_id found" };
  }
  if (sigmaScore >= 0.66) {
    return { format: "sigma", confidence: sigmaScore, reason: "Sigma keys (title/detection/logsource) found" };
  }
  if (kqlScore >= 0.5) {
    return { format: "kql", confidence: kqlScore, reason: "KQL tables + pipe operators found" };
  }
  if (splScore >= 0.4) {
    return { format: "spl", confidence: splScore, reason: "SPL field= pairs + pipe operators found" };
  }

  // Filename fallback
  if (ext === "yml" || ext === "yaml") {
    return { format: "yaml-unknown", confidence: 0.2, reason: "YAML extension; no Sigma markers detected" };
  }
  if (ext === "toml") {
    return { format: "elastic-toml", confidence: 0.3, reason: "TOML extension" };
  }
  if (ext === "spl") {
    return { format: "spl", confidence: 0.3, reason: "SPL extension" };
  }
  if (ext === "kql") {
    return { format: "kql", confidence: 0.3, reason: "KQL extension" };
  }

  return { format: "unknown", confidence: 0, reason: "No reliable markers" };
}
