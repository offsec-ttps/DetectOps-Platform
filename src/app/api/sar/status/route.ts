/**
 * GET /api/sar/status
 *
 * Probes the local Splunk Attack Range installation:
 *   1. Reads attack_range_local.conf to extract config.
 *   2. Runs `vagrant status` to get VM states.
 *   3. Pings Splunk REST API for server info, indexes, installed apps.
 *   4. Pings Windows DC for WinRM reachability.
 *   5. Reads recent log entries from attack_range.log.
 */

import { labFetch } from "@/lib/net/lab-https";
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

import { getActiveLab } from "@/lib/active-lab";

function resolvePaths() {
  const lab = getActiveLab();
  return {
    SAR_PATH: lab.sarPath,
    CONF_PATH: `${lab.sarPath}/attack_range_local.conf`,
    LOG_PATH: `${lab.sarPath}/attack_range.log`,
    VAGRANT_DIR: lab.sarVagrantDir,
    isDeployed: lab.isDeployed,
    deployPath: lab.deployPath,
    prefix: lab.prefix,
  };
}

// ── Helpers ──

function parseConf(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentSection = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (kvMatch) {
      const key = currentSection ? `${currentSection}.${kvMatch[1]}` : kvMatch[1];
      result[key] = kvMatch[2].trim();
    }
  }
  return result;
}

async function vagrantStatus(vagrantDir: string): Promise<
  { name: string; state: string; provider: string }[]
> {
  try {
    const { stdout } = await exec("vagrant", ["status", "--machine-readable"], {
      cwd: vagrantDir,
      timeout: 15000,
    });
    const machines: { name: string; state: string; provider: string }[] = [];
    const seen = new Set<string>();
    for (const line of stdout.split("\n")) {
      const parts = line.split(",");
      if (parts.length >= 4 && parts[2] === "state") {
        const name = parts[1];
        if (!seen.has(name)) {
          seen.add(name);
          machines.push({ name, state: parts[3], provider: "virtualbox" });
        }
      }
    }
    return machines;
  } catch {
    return [];
  }
}

interface SplunkInfo {
  reachable: boolean;
  serverName?: string;
  version?: string;
  build?: string;
  os?: string;
  cpuArch?: string;
  cores?: number;
  memoryMB?: number;
  licenseGroup?: string;
  licenseState?: string;
  guid?: string;
  uptime?: string;
  indexes?: { name: string; eventCount: number; sizeMB: number }[];
  apps?: { name: string; label: string; version: string; enabled: boolean }[];
  error?: string;
}

async function probeSplunk(ip: string, password: string): Promise<SplunkInfo> {
  const base = `https://${ip}:8089`;
  const auth = "Basic " + Buffer.from(`admin:${password}`).toString("base64");
  const headers = { Authorization: auth };

  // Self-signed Splunk: TLS relaxation is scoped per request (labFetch), never
  // via the process-wide NODE_TLS_REJECT_UNAUTHORIZED.
  try {
    // Server info
    const infoRes = await labFetch(`${base}/services/server/info?output_mode=json`, {
      headers,
    });
    if (!infoRes.ok) throw new Error(`Splunk returned ${infoRes.status}`);
    const infoData = await infoRes.json() as any;
    const content = infoData.entry?.[0]?.content || {};

    // Indexes, apps and status are independent of each other — fetch them in
    // PARALLEL (was sequential: 3 round-trips back-to-back dominated the ~5s
    // probe and made the Campaign Designer environment card slow to settle).
    const [idxRes, appsRes, settingsRes] = await Promise.all([
      labFetch(`${base}/services/data/indexes?output_mode=json&count=50`, { headers }),
      labFetch(`${base}/services/apps/local?output_mode=json&count=100`, { headers }),
      labFetch(`${base}/services/server/status?output_mode=json`, { headers }).catch(() => null),
    ]);

    const idxData = await idxRes.json() as any;
    const indexes = (idxData.entry || [])
      .map((e: any) => ({
        name: e.name,
        eventCount: Number(e.content?.totalEventCount || 0),
        sizeMB: Number(e.content?.currentDBSizeMB || 0),
      }))
      .filter((i: any) => i.eventCount > 0 || ["main", "sysmon", "wineventlog", "win"].includes(i.name));

    const appsData = await appsRes.json() as any;
    const apps = (appsData.entry || []).map((e: any) => ({
      name: e.name,
      label: e.content?.label || e.name,
      version: e.content?.version || "?",
      enabled: !e.content?.disabled,
    }));

    const uptime: string | undefined = settingsRes && settingsRes.ok ? "running" : undefined;

    return {
      reachable: true,
      serverName: content.serverName,
      version: content.version,
      build: content.build,
      os: `${content.os_name || ""} ${content.os_version || ""}`.trim(),
      cpuArch: content.cpu_arch,
      cores: content.numberOfCores,
      memoryMB: content.physicalMemoryMB,
      licenseGroup: content.activeLicenseGroup,
      licenseState: content.licenseState,
      guid: content.guid,
      uptime,
      indexes,
      apps,
    };
  } catch (err: any) {
    return { reachable: false, error: err.message };
  }
}

async function pingHost(ip: string): Promise<boolean> {
  try {
    const { stdout } = await exec("ping", ["-c", "1", "-W", "2", ip], {
      timeout: 5000,
    });
    return stdout.includes("1 received");
  } catch {
    return false;
  }
}

async function readRecentLogs(logPath: string, count: number = 20): Promise<string[]> {
  try {
    const raw = await readFile(logPath, "utf-8");
    const lines = raw
      .split("\n")
      .filter((l) => l.trim().length > 0);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

// ── Route handler ──

// Short-lived cache of the last probe. The Campaign Designer (and other pages)
// call this on every mount; without a cache a quick revisit or a React remount
// re-runs the full SAR/Splunk probe, so the environment card kept "probing"
// over and over. A few seconds of staleness is fine for a status card.
const STATUS_TTL_MS = 8000;
let statusCache: { at: number; body: any } | null = null;

export async function GET() {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) {
    return NextResponse.json({ ...statusCache.body, cached: true });
  }
  const startTime = Date.now();
  const paths = resolvePaths();

  // 1. Read and parse config
  let config: Record<string, string> = {};
  let configError: string | undefined;
  try {
    const raw = await readFile(paths.CONF_PATH, "utf-8");
    config = parseConf(raw);
  } catch (err: any) {
    configError = err.message;
  }

  // Extract key values from config
  const splunkIp = config["splunk_server.splunk_server_private_ip"] || "10.0.1.12";
  const splunkPassword = config["splunk_settings.splunk_admin_password"] || "";
  const dcIp = config["windows_domain_controller.windows_domain_controller_private_ip"] || "10.0.1.14";
  const winPassword = config["windows_settings.win_password"] || "";

  // 2-5. Run probes in parallel
  const [vms, splunkInfo, dcReachable, splunkPing, logs] =
    await Promise.all([
      vagrantStatus(paths.VAGRANT_DIR),
      splunkPassword ? probeSplunk(splunkIp, splunkPassword) : Promise.resolve({ reachable: false, error: "No password in config" } as SplunkInfo),
      pingHost(dcIp),
      pingHost(splunkIp),
      readRecentLogs(paths.LOG_PATH, 25),
    ]);

  // Build environment map from config
  const enabledMachines = {
    splunk_server: config["environment.splunk_server"] === "1",
    phantom_server: config["environment.phantom_server"] === "1",
    windows_domain_controller: config["environment.windows_domain_controller"] === "1",
    windows_server: config["environment.windows_server"] === "1",
    kali_machine: config["environment.kali_machine"] === "1",
    windows_client: config["environment.windows_client"] === "1",
  };

  const response = {
    connected: splunkInfo.reachable && vms.length > 0,
    probeTimeMs: Date.now() - startTime,
    installPath: paths.SAR_PATH,
    isDeployed: paths.isDeployed,
    deployPath: paths.deployPath,

    // Config summary
    config: {
      error: configError,
      splunk: {
        ip: splunkIp,
        adminPassword: splunkPassword ? "••••••••" : "(not set)",
        version: config["splunk_settings.splunk_url"]?.match(/releases\/([\d.]+)\//)?.[1] || "?",
        binaryUrl: config["splunk_settings.splunk_url"] || "",
      },
      windows: {
        dcIp,
        username: config["windows_settings.win_username"] || "Administrator",
        password: winPassword ? "••••••••" : "(not set)",
        sysmonTemplate: config["windows_settings.win_sysmon_template"] || "?",
        timezone: config["windows_settings.win_timezone"] || "?",
      },
      simulation: {
        defaultTechnique: config["simulation.art_run_techniques"] || "?",
        artRepository: config["simulation.art_repository"] || "?",
        artBranch: config["simulation.art_branch"]?.trim() || "?",
      },
      caldera: {
        password: config["caldera.caldera_password"] ? "••••••••" : "(not set)",
        ip: config["caldera_server.caldera_server_private_ip"] || "10.0.1.12",
      },
      enabledMachines,
    },

    // VM status from vagrant
    virtualMachines: vms,

    // Network connectivity
    network: {
      splunkServer: {
        ip: splunkIp,
        pingReachable: splunkPing,
        restApiPort: 8089,
        webUiPort: 8000,
        webUiUrl: `http://${splunkIp}:8000`,
        restApiUrl: `https://${splunkIp}:8089`,
      },
      windowsDC: {
        ip: dcIp,
        pingReachable: dcReachable,
        winrmPort: 5985,
        rdpPort: 3389,
      },
    },

    // Live Splunk data
    splunk: splunkInfo,

    // Recent logs
    recentLogs: logs,
  };

  statusCache = { at: Date.now(), body: response };
  return NextResponse.json(response);
}
