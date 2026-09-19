/**
 * Persistent HEC (Splunk HTTP Event Collector) configuration.
 *
 * Stored as a JSON file under ./labs/.hec-config.json alongside the existing
 * deployment registry. Kept server-side only — the UI never sees the token.
 *
 * Read precedence for the replay flow:
 *   1. Explicit override in the replay request body (per-call)
 *   2. Saved config in this file (set via Settings UI or auto-discover)
 *   3. Env vars SPLUNK_HOST / SPLUNK_HEC_TOKEN / SPLUNK_HEC_PORT (legacy fallback)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "labs", ".hec-config.json");

export interface HecConfig {
  /** Hostname or IP of the Splunk instance running HEC (e.g. 10.0.2.10 or splunk.example.com) */
  host: string;
  /** TCP port for HEC listener. Default 8088. */
  port: number;
  /** HEC token (GUID) */
  token: string;
  /** Human label — e.g. "Cloud range splunk_windows_aws (0f9b981b)" */
  label?: string;
  /** Optional reference to the SAR attack_range_id this config was discovered from */
  rangeId?: string;
  /** Optional reference to the server within the range (e.g. "splunk") */
  rangeServer?: string;
  /** ISO timestamp of last write */
  updatedAt?: string;
}

export function loadHecConfig(): HecConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as HecConfig;
    if (!parsed?.host || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveHecConfig(cfg: Omit<HecConfig, "updatedAt">): HecConfig {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const full: HecConfig = { ...cfg, updatedAt: new Date().toISOString() };
  writeFileSync(CONFIG_PATH, JSON.stringify(full, null, 2), "utf-8");
  return full;
}

export function clearHecConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      writeFileSync(CONFIG_PATH, "", "utf-8");
    }
  } catch { /* ignore */ }
}

/**
 * Effective HEC settings after applying precedence. Returns null host/token
 * fields (not undefined) so callers can inline render them.
 */
export function getEffectiveHecConfig(): { host: string; port: number; token: string; source: "stored" | "env" | "none"; label?: string } {
  const stored = loadHecConfig();
  if (stored) {
    return {
      host: stored.host,
      port: stored.port || 8088,
      token: stored.token,
      source: "stored",
      label: stored.label,
    };
  }
  const envHost = process.env.SPLUNK_HOST || "";
  const envToken = process.env.SPLUNK_HEC_TOKEN || "";
  if (envHost || envToken) {
    return {
      host: envHost,
      port: parseInt(process.env.SPLUNK_HEC_PORT || "8088", 10),
      token: envToken,
      source: "env",
    };
  }
  return { host: "", port: 8088, token: "", source: "none" };
}
