/**
 * Resolve the live SAR Minimal deployment into concrete LOTL execution targets +
 * a Splunk config, reusing the same deployment-registry + attack_range_local.conf
 * facts the /api/sar/* pipeline relies on. No secrets are persisted; they are read
 * at call time and handed straight to the executor / Splunk query.
 *
 *   Linux  Splunk host → SSH   (vagrant key from the deployment's .vagrant dir)
 *   Windows DC         → WinRM (Administrator + win_password from the conf)
 *   Splunk REST        → https://<splunk_ip>:8089  (admin + splunk_admin_password)
 */

import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LotlTargets } from "./execute";
import type { SplunkConfig } from "@/lib/siem/types";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

interface SarDeployment {
  deployPath: string;
  sarDir: string;
  conf: string;
  prefix: string | null;
  vmNames: Record<string, string>;
}

/** Find a deployed SAR lab (labType "sar") from the deployments registry. */
export function findSarDeployment(): SarDeployment | null {
  try {
    const registryPath = path.join(process.cwd(), "labs", ".deployments-registry.json");
    if (!existsSync(registryPath)) return null;
    const registry: Array<{ prefix?: string; deployPath: string; labType?: string; vmNames?: Record<string, string> }> =
      JSON.parse(readFileSync(registryPath, "utf-8"));
    for (const dep of registry) {
      if ((dep.labType || "sar") !== "sar") continue;
      const dp = expandHome(dep.deployPath);
      const sarDir = path.join(dp, "sar");
      const conf = path.join(sarDir, "attack_range_local.conf");
      if (!existsSync(conf)) continue;
      return { deployPath: dp, sarDir, conf, prefix: dep.prefix || null, vmNames: dep.vmNames || {} };
    }
  } catch { /* fall through */ }
  return null;
}

function parseConf(confText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of confText.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The python interpreter that has pywinrm (GOAD venv first, else system). */
function winrmPython(): string {
  const venv = path.join(os.homedir(), ".goad", ".venv", "bin", "python3");
  return existsSync(venv) ? venv : "python3";
}

export interface ResolvedLab {
  targets: LotlTargets;
  splunk: SplunkConfig | null;
  splunkIp: string;
  dcIp: string;
  deployPath: string;
}

/**
 * Build execution targets + Splunk config from the running SAR deployment.
 * Returns null when no simulatable SAR lab is deployed.
 */
export function resolveLab(): ResolvedLab | null {
  const dep = findSarDeployment();
  if (!dep) return null;
  const conf = parseConf(readFileSync(dep.conf, "utf-8"));

  const splunkIp = conf.splunk_server_private_ip || "";
  const dcIp = conf.windows_domain_controller_private_ip || conf.windows_server_private_ip || "";

  const targets: LotlTargets = {};

  // Linux (Splunk host) over SSH with the deployment's Vagrant key.
  const splunkVm = dep.vmNames["splunk-server"] || `${dep.prefix || ""}-splunk-server`;
  const keyPath = path.join(dep.sarDir, "vagrant", ".vagrant", "machines", splunkVm, "virtualbox", "private_key");
  if (splunkIp && existsSync(keyPath)) {
    targets.linux = { os: "linux", host: splunkIp, user: "vagrant", keyPath };
  }

  // Windows DC over WinRM (message-encrypted even on http:5985 — see winrm-runner.py).
  if (dcIp && conf.win_password) {
    targets.windows = {
      os: "windows", host: dcIp, port: 5985,
      user: conf.win_username || "Administrator", password: conf.win_password,
      pythonBin: winrmPython(),
    };
  }

  // Splunk REST for the detection verdict (basic auth, admin + conf password).
  let splunk: SplunkConfig | null = null;
  if (splunkIp && conf.splunk_admin_password) {
    splunk = {
      url: `https://${splunkIp}:8089`,
      authMode: "basic",
      username: "admin",
      password: conf.splunk_admin_password,
    } as SplunkConfig;
  }

  return { targets, splunk, splunkIp, dcIp, deployPath: dep.deployPath };
}

/** Libraries whose techniques are genuinely dangerous on a real host. */
export const DANGEROUS_LIBRARIES = new Set(["loldrivers", "lottunnels", "sysinternals"]);
