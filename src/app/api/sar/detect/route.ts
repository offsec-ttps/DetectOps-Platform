import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { logEvent } from "@/lib/event-log";
import { getSessionUser } from "@/lib/auth";
import { runSplunkDetection } from "@/lib/siem/providers/splunk";
import type { SplunkConfig } from "@/lib/siem/types";

const SAR_PATH = "/media/nested/SamsungEvo/Simulation/attack_range_local";
const CONF_PATH = `${SAR_PATH}/attack_range_local.conf`;

async function readSarConfig(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(CONF_PATH, "utf-8");
    const result: Record<string, string> = {};
    let section = "";
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const secMatch = trimmed.match(/^\[(.+)\]$/);
      if (secMatch) { section = secMatch[1]; continue; }
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
      if (kvMatch) result[`${section}.${kvMatch[1]}`] = kvMatch[2].trim();
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * POST /api/sar/detect
 *
 * Validates whether a Splunk detection fired after simulation. Backward-compatible
 * thin wrapper: the multi-strategy Splunk querying now lives in the shared SIEM
 * provider (src/lib/siem/providers/splunk.ts). Credentials come from the request
 * body, falling back to the active local SAR config. New per-environment /
 * MDE detection goes through /api/siem/[id]/detect instead.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { splunkUrl, splunkPassword, splunkToken, searchQuery, detectionName, techniqueId, earliestTime = "-30m" } = body;

  if (!detectionName && !searchQuery) {
    return NextResponse.json({ error: "detectionName or searchQuery is required" }, { status: 400 });
  }

  // Defaults from the active local SAR lab.
  const sarConfig = await readSarConfig();
  const sarSplunkIp = sarConfig["splunk_server.splunk_server_private_ip"] || "10.0.1.12";
  const sarSplunkPassword = sarConfig["splunk_settings.splunk_admin_password"] || "";

  const baseUrl = (splunkUrl || `https://${sarSplunkIp}:8089`).replace(/\/$/, "");
  const password = splunkPassword || sarSplunkPassword;

  if (!password && !splunkToken) {
    return NextResponse.json({ error: "No Splunk credentials provided and none found in SAR config", resultCount: 0, detected: false }, { status: 400 });
  }

  // Parse "-30m" → minutes for the shared provider's window.
  const windowMinutes = (() => { const m = String(earliestTime).match(/-(\d+)m/); return m ? Number(m[1]) : 30; })();

  const cfg: SplunkConfig = splunkToken
    ? { kind: "splunk", url: baseUrl, authMode: "token", token: splunkToken }
    : { kind: "splunk", url: baseUrl, authMode: "basic", username: "admin", password };

  try {
    const r = await runSplunkDetection(cfg, { query: searchQuery, detectionName, techniqueId, windowMinutes });
    const sessionUser = await getSessionUser().catch(() => null);
    void logEvent({
      category: "detection", action: "detection.validate",
      actor: sessionUser?.email || "anonymous", status: r.detected ? "ok" : "warn",
      targetType: "detection", targetId: detectionName || techniqueId || "",
      message: `${r.detected ? "DETECTED" : "not detected"} · ${r.resultCount} match(es)`,
      details: { detectionName, techniqueId, detected: r.detected, resultCount: r.resultCount, splunkUrl: baseUrl },
    });
    return NextResponse.json({ detectionName, detected: r.detected, resultCount: r.resultCount, strategies: r.strategies, diagnostics: r.diagnostics, splunkUrl: baseUrl, earliestTime, summary: r.summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sessionUser = await getSessionUser().catch(() => null);
    void logEvent({
      category: "detection", action: "detection.validate",
      actor: sessionUser?.email || "anonymous", status: "error",
      targetType: "detection", targetId: detectionName || techniqueId || "",
      message: "Splunk reach failed", errorMessage: msg,
    });
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
      return NextResponse.json({ error: "Cannot reach Splunk instance. Ensure the Attack Range Splunk server is running.", detail: msg, resultCount: 0, detected: false }, { status: 502 });
    }
    return NextResponse.json({ error: msg, resultCount: 0, detected: false }, { status: 500 });
  }
}
