/**
 * Splunk HEC replay client.
 *
 * Mirrors the behavior of attack_data/bin/replay.py:
 *   POST https://{SPLUNK_HOST}:8088/services/collector/raw
 *     Authorization: Splunk {SPLUNK_HEC_TOKEN}
 *     X-Splunk-Request-Channel: {uuid}
 *     params: index, source, sourcetype, host
 *     body: file contents
 *
 * Server-side only — never exposes HEC token to the client.
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { ATTACK_DATA_ROOT, resolveRepoRoot } from "./scanner";
import { getEffectiveHecConfig } from "@/lib/hec-config";

export interface ReplayInput {
  dataFilePath: string;
  index: string;
  source: string;
  sourcetype: string;
  hostOverride?: string;
  splunkHostOverride?: string;
  splunkHecPortOverride?: number;
  hecTokenOverride?: string;
}

export interface ReplayResult {
  success: boolean;
  bytesSent: number;
  durationMs: number;
  hecChannel: string;
  splunkUrl: string;
  status?: number;
  error?: string;
  hint?: string;
}

const DEFAULT_HEC_PORT = parseInt(process.env.SPLUNK_HEC_PORT || "8088", 10);

function getHecConfig(opts: ReplayInput) {
  // Precedence: per-call override → stored config (labs/.hec-config.json) → env vars.
  // The stored config is set via the Replay Catalog's HEC panel (auto-discover
  // from a running SAR range or manual entry).
  const eff = getEffectiveHecConfig();
  const splunkHost = opts.splunkHostOverride || eff.host || "";
  const hecToken = opts.hecTokenOverride || eff.token || "";
  const port = opts.splunkHecPortOverride || eff.port || DEFAULT_HEC_PORT;
  return { splunkHost, hecToken, port };
}

/** Returns a sanitized config status — never exposes the actual token. */
export function getHecStatus() {
  const eff = getEffectiveHecConfig();
  return {
    splunkHost: eff.host,
    hecPort: eff.port,
    tokenConfigured: eff.token.length > 0,
    tokenLength: eff.token.length, // useful for debugging without leaking
    ready: eff.host.length > 0 && eff.token.length > 0,
    configSource: eff.source, // "stored" | "env" | "none"
    label: eff.label,
  };
}

/** Validate that the file path is under the configured attack_data root. */
export function isPathSafe(dataFilePath: string): boolean {
  if (!dataFilePath) return false;
  const { root } = resolveRepoRoot(ATTACK_DATA_ROOT);
  if (!root) return false;
  const resolved = path.resolve(dataFilePath);
  const safeRoot = path.resolve(root);
  return resolved.startsWith(safeRoot + path.sep) || resolved === safeRoot;
}

/** Build the dry-run command preview (no execution). */
export function buildReplayCommand(input: ReplayInput, splunkHostHint?: string): string {
  const host = splunkHostHint || input.splunkHostOverride || "${SPLUNK_HOST}";
  const port = input.splunkHecPortOverride || DEFAULT_HEC_PORT;
  const eventHost = input.hostOverride || "${EVENT_HOST_UUID}";
  return [
    `# Equivalent to attack_data/bin/replay.py`,
    `curl -k -X POST "https://${host}:${port}/services/collector/raw" \\`,
    `  -H "Authorization: Splunk \${SPLUNK_HEC_TOKEN}" \\`,
    `  -H "X-Splunk-Request-Channel: $(uuidgen)" \\`,
    `  -G \\`,
    `  --data-urlencode "index=${input.index}" \\`,
    `  --data-urlencode "source=${input.source}" \\`,
    `  --data-urlencode "sourcetype=${input.sourcetype}" \\`,
    `  --data-urlencode "host=${eventHost}" \\`,
    `  --data-binary "@${input.dataFilePath}"`,
  ].join("\n");
}

/** Execute a replay against Splunk HEC. Returns structured result. */
export async function replayToHec(input: ReplayInput): Promise<ReplayResult> {
  const startTime = Date.now();
  const hecChannel = randomUUID();
  const eventHostUuid = input.hostOverride || randomUUID();
  const { splunkHost, hecToken, port } = getHecConfig(input);

  // Pre-flight checks
  if (!splunkHost) {
    return { success: false, bytesSent: 0, durationMs: 0, hecChannel, splunkUrl: "", error: "SPLUNK_HOST not configured" };
  }
  if (!hecToken) {
    return { success: false, bytesSent: 0, durationMs: 0, hecChannel, splunkUrl: "", error: "SPLUNK_HEC_TOKEN not configured" };
  }
  if (!isPathSafe(input.dataFilePath)) {
    return { success: false, bytesSent: 0, durationMs: 0, hecChannel, splunkUrl: "", error: `Path outside attack_data root: ${input.dataFilePath}` };
  }
  if (!fs.existsSync(input.dataFilePath)) {
    return { success: false, bytesSent: 0, durationMs: 0, hecChannel, splunkUrl: "", error: `Data file not found: ${input.dataFilePath}` };
  }

  let body: Buffer;
  try {
    body = fs.readFileSync(input.dataFilePath);
  } catch (err: any) {
    return { success: false, bytesSent: 0, durationMs: 0, hecChannel, splunkUrl: "", error: `Read failed: ${err.message}` };
  }

  const params = new URLSearchParams({
    index: input.index || "attack_data",
    source: input.source || "attack_data",
    sourcetype: input.sourcetype || "_json",
    host: eventHostUuid,
  });
  const splunkUrl = `https://${splunkHost}:${port}/services/collector/raw?${params.toString()}`;

  // Bypass TLS validation for self-signed Splunk
  const origTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    const res = await fetch(splunkUrl, {
      method: "POST",
      headers: {
        Authorization: `Splunk ${hecToken}`,
        "X-Splunk-Request-Channel": hecChannel,
      },
      body,
      redirect: "follow",
    });

    const durationMs = Date.now() - startTime;

    if (res.ok) {
      return {
        success: true, bytesSent: body.length, durationMs, hecChannel,
        splunkUrl: splunkUrl.replace(/Splunk [^&]+/g, "Splunk ***"),
        status: res.status,
      };
    }

    let respBody: any = null;
    try { respBody = await res.json(); } catch { try { respBody = await res.text(); } catch { /* ignore */ } }
    const code = typeof respBody === "object" ? respBody?.code : null;
    const text = typeof respBody === "object" ? respBody?.text : String(respBody || "");

    let hint: string | undefined;
    if (code === 7) hint = "Incorrect index. Create the index in Splunk or use a different one.";
    else if (code === 4) hint = "Invalid HEC token. Verify SPLUNK_HEC_TOKEN.";
    else if (code === 6) hint = "Invalid data format. Check sourcetype and file content.";
    else if (code === 10) hint = "Data channel issue. Check HEC indexer acknowledgment settings.";

    return {
      success: false, bytesSent: 0, durationMs, hecChannel,
      splunkUrl: splunkUrl.replace(/token/gi, "***"),
      status: res.status, error: `HTTP ${res.status}: ${text || "no response body"}`, hint,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    return {
      success: false, bytesSent: 0, durationMs, hecChannel,
      splunkUrl: "", error: `Network error: ${err.message}`,
    };
  } finally {
    if (origTLS === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = origTLS;
  }
}
