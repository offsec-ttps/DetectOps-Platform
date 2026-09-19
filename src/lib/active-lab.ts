/**
 * Resolves the active lab deployment path and VM names.
 *
 * Priority:
 *  1. Latest deployment at labs/deployments/ or any deployment.json found
 *  2. Fallback to original SAR_PATH
 *
 * This ensures all API routes (simulate, start, status) use the CURRENT
 * deployed lab, not the original hardcoded installation path.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const ORIGINAL_SAR = "/media/nested/SamsungEvo/Simulation/attack_range_local";
const LABS_DIR = path.join(process.cwd(), "labs", "deployments");
const REGISTRY = path.join(process.cwd(), "labs", ".deployments-registry.json");

/**
 * Names of VMs currently powered on in VirtualBox (empty on any failure).
 * Cached for 2s so the parallel API calls a page makes don't each spawn
 * VBoxManage — getActiveLab() is called from many routes.
 */
let _vmCache: { at: number; set: Set<string> } | null = null;
function runningVmNames(): Set<string> {
  if (_vmCache && Date.now() - _vmCache.at < 2000) return _vmCache.set;
  const s = new Set<string>();
  try {
    const out = execSync("VBoxManage list runningvms", { timeout: 4000, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) { const m = line.match(/^"([^"]+)"/); if (m) s.add(m[1]); }
  } catch { /* VBox absent/error → treat as none running */ }
  _vmCache = { at: Date.now(), set: s };
  return s;
}

export interface ActiveLab {
  sarPath: string;
  sarVagrantDir: string;
  sarScript: string;
  pythonBin: string;
  deployPath: string | null;
  prefix: string | null;
  vmNames: Record<string, string>;
  labType: string;
  isDeployed: boolean; // true if using a deploy, false if fallback to original
}

/**
 * Scans for deployment.json files to find the most recent deployment that can
 * actually run an ART simulation. We deliberately skip deployments without a
 * runnable `sar/attack_range_local.py` (e.g. `labType: "sar-docker"`, which
 * uses docker-compose and has no python entrypoint). Otherwise the newest
 * deployment "wins" even when it can't be simulated against, and callers fall
 * back to the legacy ORIGINAL_SAR install — pointing simulations at the wrong
 * lab.
 */
function isSimulatableDeployment(deployDir: string, meta: any): boolean {
  if (meta?.labType === "sar-docker") return false;
  return existsSync(path.join(deployDir, "sar", "attack_range_local.py"));
}

function findLatestDeployment(): { path: string; meta: any } | null {
  // Gather candidate deployments (path → meta). We consider the deployments
  // registry FIRST (it lists every lab, including ones outside the scan dirs
  // such as ~/.detectops-labs) plus the legacy directory scans.
  const candidates = new Map<string, any>();
  const add = (dp: string, meta: any) => {
    if (dp && !candidates.has(dp) && isSimulatableDeployment(dp, meta)) candidates.set(dp, meta);
  };
  const readMeta = (dp: string, fallback: any) => {
    const mf = path.join(dp, "deployment.json");
    if (existsSync(mf)) { try { return JSON.parse(readFileSync(mf, "utf-8")); } catch { /* use fallback */ } }
    return fallback;
  };

  // 1. Registry — authoritative list of all deployments.
  try {
    if (existsSync(REGISTRY)) {
      const reg = JSON.parse(readFileSync(REGISTRY, "utf-8"));
      for (const dep of (Array.isArray(reg) ? reg : [])) {
        const dp: string = dep?.deployPath || "";
        if (dp) add(dp, readMeta(dp, dep));
      }
    }
  } catch { /* ignore malformed registry */ }

  // 2. Directory scans (back-compat with un-registered deploys).
  for (const searchDir of [LABS_DIR, "/media/nested/SamsungEvo/detection-labs"]) {
    if (!existsSync(searchDir)) continue;
    if (existsSync(path.join(searchDir, "deployment.json"))) add(searchDir, readMeta(searchDir, {}));
    try {
      for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(searchDir, entry.name);
        if (existsSync(path.join(sub, "deployment.json"))) add(sub, readMeta(sub, {}));
      }
    } catch { /* ignore */ }
  }

  if (candidates.size === 0) return null;

  // Prefer the lab that is actually RUNNING, so status/SIEM/creds resolve to the
  // live lab — not merely the newest deploy (which may be stopped and on a
  // different network). Among running labs the newest wins; else the newest.
  const running = runningVmNames();
  const ranked = Array.from(candidates.entries())
    .map(([p, meta]) => ({
      path: p, meta,
      date: String(meta?.createdAt || ""),
      isRunning: Object.values(meta?.vmNames || {}).some((n) => running.has(String(n))),
    }))
    .sort((a, b) => (a.isRunning !== b.isRunning ? (a.isRunning ? -1 : 1) : b.date.localeCompare(a.date)));

  return { path: ranked[0].path, meta: ranked[0].meta };
}

export function getActiveLab(): ActiveLab {
  const deployment = findLatestDeployment();

  if (deployment) {
    const dp = deployment.path;
    const meta = deployment.meta;
    const sarDir = path.join(dp, "sar");
    const sarScript = path.join(sarDir, "attack_range_local.py");
    const home = process.env.HOME || "/root";

    // Use GOAD venv python+ansible (system ones are broken)
    const goadVenvBin = `${home}/.goad/.venv/bin`;
    // SAR needs its own venv python if available, otherwise system
    const sarVenv = path.join(sarDir, "venv", "bin", "python3");
    const pythonBin = existsSync(sarVenv) ? sarVenv : "python3";

    return {
      sarPath: sarDir,
      sarVagrantDir: path.join(sarDir, "vagrant"),
      sarScript: existsSync(sarScript) ? sarScript : path.join(ORIGINAL_SAR, "attack_range_local.py"),
      pythonBin,
      deployPath: dp,
      prefix: meta.prefix || null,
      vmNames: meta.vmNames || {},
      labType: meta.labType || "sar",
      isDeployed: true,
    };
  }

  // Fallback to original SAR
  return {
    sarPath: ORIGINAL_SAR,
    sarVagrantDir: path.join(ORIGINAL_SAR, "vagrant"),
    sarScript: path.join(ORIGINAL_SAR, "attack_range_local.py"),
    pythonBin: path.join(ORIGINAL_SAR, "venv", "bin", "python3"),
    deployPath: null,
    prefix: null,
    vmNames: {
      "splunk-server": "attack-range-splunk-server",
      "windows-dc": "attack-range-windows-domain-controller",
    },
    labType: "sar",
    isDeployed: false,
  };
}

/**
 * Get the actual VM name for a role. Handles prefixed names from deployments.
 */
export function getVMName(lab: ActiveLab, role: string): string {
  // Check vmNames map first
  if (lab.vmNames[role]) return lab.vmNames[role];

  // Common role → default name mappings
  const defaults: Record<string, string> = {
    "splunk-server": "attack-range-splunk-server",
    "windows-dc": "attack-range-windows-domain-controller",
    "DC01": "DC01",
    "WS01": "WS01",
  };

  return defaults[role] || role;
}
