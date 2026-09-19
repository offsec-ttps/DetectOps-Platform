/**
 * GET /api/sar/credentials
 *
 * Returns the REAL lab service credentials (Splunk / Windows DC / Caldera / SSH)
 * parsed from the active SAR deployment's attack_range_local.conf, so the
 * operator can actually reach the services from the Campaign Designer's Active
 * Environments panel.
 *
 * Unlike /api/sar/status (which masks every secret as "••••••••" for general
 * display), this endpoint returns plaintext — so it is session-gated when auth
 * is enforced. These are the operator's own local lab credentials.
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getActiveLab } from "@/lib/active-lab";
import { getSessionUser } from "@/lib/auth";

function parseConf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sec = t.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; continue; }
    const kv = t.match(/^([\w.]+)\s*=\s*(.*)$/);
    if (kv) out[`${section}.${kv[1]}`] = kv[2].trim();
  }
  return out;
}

export async function GET(req: Request) {
  // Gate plaintext behind a session when auth is enforced.
  if (process.env.AUTH_ENFORCED === "true") {
    const user = await getSessionUser().catch(() => null);
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // An explicit ?deployPath= targets a specific deployed lab, so the Campaign
  // Designer can show credentials for the lab that's actually running (local vs
  // fleet). Without it, fall back to the single active lab.
  const dp = new URL(req.url).searchParams.get("deployPath");
  const sarPath = dp
    ? (existsSync(path.join(dp, "sar", "attack_range_local.conf")) ? path.join(dp, "sar") : dp)
    : getActiveLab().sarPath;
  const confPath = `${sarPath}/attack_range_local.conf`;

  let config: Record<string, string> = {};
  try {
    config = parseConf(await readFile(confPath, "utf-8"));
  } catch {
    return NextResponse.json({ available: false, reason: `SAR config not found at ${confPath}` });
  }

  const splunkIp = config["splunk_server.splunk_server_private_ip"] || "10.0.1.12";
  const splunkPw = config["splunk_settings.splunk_admin_password"] || "";
  const dcIp = config["windows_domain_controller.windows_domain_controller_private_ip"] || "10.0.1.14";
  const winUser = config["windows_settings.win_username"] || "Administrator";
  const winPw = config["windows_settings.win_password"] || "";
  const calderaIp = config["caldera_server.caldera_server_private_ip"] || splunkIp;
  const calderaPw = config["caldera.caldera_password"] || "";

  return NextResponse.json({
    available: true,
    installPath: sarPath,
    splunk: {
      ip: splunkIp,
      // Splunk Web is HTTP on :8000 by default (SAR doesn't enable web SSL);
      // the management REST API on :8089 and HEC on :8088 are HTTPS.
      webUrl: `http://${splunkIp}:8000`,
      apiUrl: `https://${splunkIp}:8089`,
      hecUrl: `https://${splunkIp}:8088`,
      user: "admin",
      password: splunkPw,
    },
    ssh: { user: "ubuntu", host: splunkIp, hint: `ssh ubuntu@${splunkIp}` },
    windows: { ip: dcIp, access: "RDP / WinRM", user: winUser, password: winPw },
    // SAR's bundled Caldera user is "admin" (per attack_range_local.conf).
    caldera: calderaPw
      ? { ip: calderaIp, url: `http://${calderaIp}:8888`, user: "admin", password: calderaPw }
      : null,
  });
}
