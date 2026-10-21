/**
 * GET /api/goad/status
 *
 * Returns comprehensive status of the GOAD Active Directory lab:
 *   1. Instance metadata from workspace/instance.json
 *   2. VM states via VBoxManage
 *   3. Network reachability (ping)
 *   4. Splunk Forwarder installation status
 *   5. SAR Splunk connectivity (for log flow verification)
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const exec = promisify(execFile);

const GOAD_PATH = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";
const GOAD_INSTANCE_ID = process.env.GOAD_INSTANCE_ID || "d86a4c-minilab-virtualbox";
const SPLUNK_IP = process.env.SPLUNK_IP || "10.0.1.12";

interface GOADInstance {
  id: string;
  lab: string;
  provider: string;
  provisioner: string;
  ip_range: string;
  status: string;
  extensions: string[];
  is_default: boolean;
}

// IP assignments per lab type (from GOAD Vagrantfile templates)
const LAB_VM_IPS: Record<string, Record<string, { ip_suffix: string; os: string; role: string }>> = {
  MINILAB: {
    DC01: { ip_suffix: "30", os: "Windows Server 2019", role: "Domain Controller" },
    WS01: { ip_suffix: "31", os: "Windows 10", role: "Workstation" },
  },
  GOAD: {
    DC01: { ip_suffix: "10", os: "Windows Server 2019", role: "Domain Controller (sevenkingdoms.local)" },
    DC02: { ip_suffix: "11", os: "Windows Server 2019", role: "Domain Controller (north.sevenkingdoms.local)" },
    DC03: { ip_suffix: "12", os: "Windows Server 2019", role: "Domain Controller (essos.local)" },
    SRV02: { ip_suffix: "22", os: "Windows Server 2019", role: "Server (north)" },
    SRV03: { ip_suffix: "23", os: "Windows Server 2019", role: "Server (essos)" },
  },
};

async function getVMState(vmName: string): Promise<string> {
  try {
    const { stdout } = await exec("VBoxManage", ["showvminfo", vmName, "--machinereadable"], {
      timeout: 10000,
    });
    const match = stdout.match(/VMState="([^"]+)"/);
    return match ? match[1] : "unknown";
  } catch {
    return "not_found";
  }
}

async function pingHost(ip: string): Promise<boolean> {
  try {
    const { stdout } = await exec("ping", ["-c", "1", "-W", "2", ip], { timeout: 5000 });
    return stdout.includes("1 received");
  } catch {
    return false;
  }
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !Number.isInteger(port)) return false;
  try {
    await exec("bash", ["-c", `echo >/dev/tcp/${ip}/${port}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const startTime = Date.now();
  const instanceDir = `${GOAD_PATH}/workspace/${GOAD_INSTANCE_ID}`;
  const instanceFile = `${instanceDir}/instance.json`;

  // 1. Load instance metadata
  let instance: GOADInstance | null = null;
  let instanceError: string | undefined;

  if (existsSync(instanceFile)) {
    try {
      const raw = await readFile(instanceFile, "utf-8");
      instance = JSON.parse(raw);
    } catch (err: any) {
      instanceError = err.message;
    }
  } else {
    instanceError = `Instance not found: ${GOAD_INSTANCE_ID}`;
  }

  if (!instance) {
    return NextResponse.json({
      connected: false,
      probeTimeMs: Date.now() - startTime,
      error: instanceError,
      goadPath: GOAD_PATH,
      instanceId: GOAD_INSTANCE_ID,
    });
  }

  // 2. Get VM info for this lab type
  const labVMs = LAB_VM_IPS[instance.lab] || LAB_VM_IPS.MINILAB;

  // 3. Probe all VMs in parallel
  const vmEntries = Object.entries(labVMs);
  const vmProbes = await Promise.all(
    vmEntries.map(async ([vmName, vmInfo]) => {
      const ip = `${instance!.ip_range}.${vmInfo.ip_suffix}`;
      const [state, reachable] = await Promise.all([
        getVMState(vmName),
        pingHost(ip),
      ]);
      return {
        name: vmName,
        ip,
        os: vmInfo.os,
        role: vmInfo.role,
        state,
        reachable,
      };
    })
  );

  // 4. Check SAR Splunk connectivity
  const [splunkReachable, splunkRecvPort] = await Promise.all([
    pingHost(SPLUNK_IP),
    checkPort(SPLUNK_IP, 9997),
  ]);

  // 5. Check if Splunk Forwarder extension is installed
  const forwarderInstalled = (instance.extensions || []).includes("splunk_forwarder");
  const extensionExists = existsSync(`${GOAD_PATH}/extensions/splunk_forwarder/extension.json`);

  // 6. Load domain config
  let labConfig: any = null;
  const configPath = `${GOAD_PATH}/ad/${instance.lab}/data/config.json`;
  try {
    if (existsSync(configPath)) {
      const raw = await readFile(configPath, "utf-8");
      labConfig = JSON.parse(raw);
    }
  } catch { /* ignore */ }

  const domain = labConfig?.lab?.domains
    ? Object.values(labConfig.lab.domains as Record<string, any>)[0]
    : null;

  const allRunning = vmProbes.every((v) => v.state === "running");
  const allReachable = vmProbes.every((v) => v.reachable);

  return NextResponse.json({
    connected: allRunning && allReachable,
    probeTimeMs: Date.now() - startTime,
    goadPath: GOAD_PATH,

    instance: {
      id: instance.id,
      lab: instance.lab,
      provider: instance.provider,
      provisioner: instance.provisioner,
      ipRange: instance.ip_range,
      status: instance.status,
      extensions: instance.extensions || [],
    },

    domain: domain
      ? {
          name: domain.dc || "unknown",
          netbios: domain.netbios_name || "unknown",
          path: domain.dc_path || "",
        }
      : null,

    virtualMachines: vmProbes,

    splunkIntegration: {
      splunkIp: SPLUNK_IP,
      splunkReachable,
      receivingPortOpen: splunkRecvPort,
      forwarderExtensionAvailable: extensionExists,
      forwarderInstalled,
      logFlowReady: forwarderInstalled && splunkRecvPort && allReachable,
    },

    network: {
      subnet: `${instance.ip_range}.0/24`,
      sarSplunk: {
        ip: SPLUNK_IP,
        reachable: splunkReachable,
        webUrl: `http://${SPLUNK_IP}:8000`,
        receivingPort: 9997,
      },
    },
  });
}
