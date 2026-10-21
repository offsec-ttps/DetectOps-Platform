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
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getActiveLab } from "@/lib/active-lab";
import { requireRole } from "@/lib/auth-guard";

// Resolved deployPaths the platform actually created (deployments registry).
// A requested deployPath must match one of these — so this plaintext-credential
// endpoint can't be pointed at an arbitrary attack_range_local.conf on the host.
function registeredDeployPaths(): Set<string> {
  try {
    const raw = readFileSync(path.join(process.cwd(), "labs", ".deployments-registry.json"), "utf8");
    const arr = JSON.parse(raw);
    return new Set((Array.isArray(arr) ? arr : []).map((e: any) => e?.deployPath).filter(Boolean).map((p: string) => path.resolve(p)));
  } catch { return new Set(); }
}

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
  // This returns PLAINTEXT lab service credentials, so it is admin-only (the
  // previous `AUTH_ENFORCED==="true"` gate used a non-standard env name the rest
  // of the app never sets, so it effectively never fired — a disclosure hole).
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;

  // An explicit ?deployPath= targets a specific deployed lab, so the Campaign
  // Designer can show credentials for the lab that's actually running (local vs
  // fleet). Without it, fall back to the single active lab.
  const rawDp = new URL(req.url).searchParams.get("deployPath");
  // SECURITY: a requested deployPath must be a lab the platform actually created
  // (present in the deployments registry) AND still carry deployment.json —
  // otherwise an arbitrary `*/attack_range_local.conf` on the host is readable.
  const dp = rawDp ? path.resolve(rawDp.replace(/^~(?=$|\/)/, process.env.HOME || "~")) : "";
  if (rawDp && (!registeredDeployPaths().has(dp) || !existsSync(path.join(dp, "deployment.json")))) {
    return NextResponse.json({ available: false, reason: "deployPath is not a registered platform lab deployment" }, { status: 400 });
  }
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
