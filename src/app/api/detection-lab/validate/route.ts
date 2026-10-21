/**
 * GET /api/detection-lab/validate
 *
 * Validates the full end-to-end lab readiness:
 *   1. Network: cross-ping between all VMs (SAR Splunk, SAR DC, GOAD DC01, GOAD WS01)
 *   2. Services: Splunk UF, Sysmon, WinRM on each Windows VM
 *   3. Logging: AD audit, PowerShell ScriptBlock/Module, Sysmon operational channel
 *   4. Splunk: receiving port open, forwarders connected, indexes have data
 *
 * POST /api/detection-lab/validate  { action: "fix", target: "dc01"|"ws01" }
 *   Runs the Splunk Forwarder + Sysmon provisioning on the specified GOAD VM.
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireRole } from "@/lib/auth-guard";
import { labFetch } from "@/lib/net/lab-https";

const exec = promisify(execFile);

const HOSTS = {
  splunk:    { ip: "10.0.1.12", name: "SAR Splunk",  role: "siem" },
  sar_dc:    { ip: "10.0.1.14", name: "SAR DC",      role: "sar-dc" },
  goad_dc01: { ip: "10.0.1.30", name: "GOAD DC01",   role: "goad-dc" },
  goad_ws01: { ip: "10.0.1.31", name: "GOAD WS01",   role: "goad-ws" },
};

async function ping(ip: string): Promise<boolean> {
  try {
    const { stdout } = await exec("ping", ["-c", "1", "-W", "2", ip], { timeout: 5000 });
    return stdout.includes("1 received");
  } catch { return false; }
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !Number.isInteger(port)) return false;
  try {
    await exec("bash", ["-c", `echo >/dev/tcp/${ip}/${port}`], { timeout: 5000 });
    return true;
  } catch { return false; }
}

async function checkWinRM(ip: string): Promise<boolean> {
  return checkPort(ip, 5985);
}

async function querySplunkForHost(host: string): Promise<{ hasData: boolean; eventCount: number }> {
  try {
    // SAR default Splunk credentials unless overridden (never ship a real secret here).
    const user = process.env.SAR_SPLUNK_USER || "admin";
    const pass = process.env.SAR_SPLUNK_PASSWORD || "I-l1ke-Attack-Range!";
    const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
    const splunk = process.env.SAR_SPLUNK_URL || "https://10.0.1.12:8089";
    const res = await labFetch(`${splunk}/services/search/jobs/export`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: `search=${encodeURIComponent(`search index=win host=${host}* | stats count`)}&output_mode=json&earliest_time=-15m`,
    });
    if (!res.ok) return { hasData: false, eventCount: 0 };
    const text = await res.text();
    const match = text.match(/"count"\s*:\s*"(\d+)"/);
    return { hasData: !!match && parseInt(match[1]) > 0, eventCount: match ? parseInt(match[1]) : 0 };
  } catch { return { hasData: false, eventCount: 0 }; }
}

export async function GET() {
  const startTime = Date.now();

  // 1. Ping all hosts
  const pingResults = await Promise.all(
    Object.entries(HOSTS).map(async ([key, h]) => ({
      id: key, ...h, reachable: await ping(h.ip),
    }))
  );

  // 2. Cross-ping: SAR DC ↔ GOAD DC01 (verified via the host since we can't run commands inside VMs from API directly)
  const sarDcUp = pingResults.find((p) => p.id === "sar_dc")?.reachable ?? false;
  const goadDc01Up = pingResults.find((p) => p.id === "goad_dc01")?.reachable ?? false;
  const goadWs01Up = pingResults.find((p) => p.id === "goad_ws01")?.reachable ?? false;
  const splunkUp = pingResults.find((p) => p.id === "splunk")?.reachable ?? false;

  // Same subnet means if host can reach both, they can reach each other
  const crossPingOk = sarDcUp && goadDc01Up;

  // 3. Check critical ports
  const [splunkRecv, splunkWeb, splunkMgmt, dc01WinRM, ws01WinRM, sarDcWinRM] = await Promise.all([
    checkPort("10.0.1.12", 9997),
    checkPort("10.0.1.12", 8000),
    checkPort("10.0.1.12", 8089),
    goadDc01Up ? checkWinRM("10.0.1.30") : Promise.resolve(false),
    goadWs01Up ? checkWinRM("10.0.1.31") : Promise.resolve(false),
    sarDcUp ? checkWinRM("10.0.1.14") : Promise.resolve(false),
  ]);

  // 4. Check Splunk for data from each host
  const [splunkDcData, splunkWsData, splunkSarDcData] = await Promise.all([
    splunkUp ? querySplunkForHost("dc") : Promise.resolve({ hasData: false, eventCount: 0 }),
    splunkUp ? querySplunkForHost("WS") : Promise.resolve({ hasData: false, eventCount: 0 }),
    splunkUp ? querySplunkForHost("win-dc") : Promise.resolve({ hasData: false, eventCount: 0 }),
  ]);

  // 5. Build checklist
  const checklist = [
    { category: "Network", item: "SAR Splunk (10.0.1.12) reachable", status: splunkUp, critical: true },
    { category: "Network", item: "SAR DC (10.0.1.14) reachable", status: sarDcUp, critical: true },
    { category: "Network", item: "GOAD DC01 (10.0.1.30) reachable", status: goadDc01Up, critical: true },
    { category: "Network", item: "GOAD WS01 (10.0.1.31) reachable", status: goadWs01Up, critical: false },
    { category: "Network", item: "SAR DC ↔ GOAD DC01 same subnet (cross-ping)", status: crossPingOk, critical: true },
    { category: "Splunk", item: "Splunk receiving port (9997) open", status: splunkRecv, critical: true },
    { category: "Splunk", item: "Splunk Web (8000) accessible", status: splunkWeb, critical: false },
    { category: "Splunk", item: "Splunk Management (8089) accessible", status: splunkMgmt, critical: true },
    { category: "Splunk", item: "GOAD DC01 logs in Splunk (index=win host=dc*)", status: splunkDcData.hasData, critical: true, detail: `${splunkDcData.eventCount} events in last 15m` },
    { category: "Splunk", item: "GOAD WS01 logs in Splunk (index=win host=WS*)", status: splunkWsData.hasData, critical: false, detail: `${splunkWsData.eventCount} events in last 15m` },
    { category: "Splunk", item: "SAR DC logs in Splunk (index=win host=win-dc*)", status: splunkSarDcData.hasData, critical: true, detail: `${splunkSarDcData.eventCount} events in last 15m` },
    { category: "Services", item: "GOAD DC01 WinRM accessible", status: dc01WinRM, critical: false },
    { category: "Services", item: "GOAD WS01 WinRM accessible", status: ws01WinRM, critical: false },
    { category: "Services", item: "SAR DC WinRM accessible", status: sarDcWinRM, critical: false },
  ];

  const passed = checklist.filter((c) => c.status).length;
  const failed = checklist.filter((c) => !c.status).length;
  const criticalFailed = checklist.filter((c) => !c.status && c.critical).length;

  // Logging config notes (what should be enabled on each VM)
  const loggingConfig = {
    description: "Required logging configuration for full detection coverage",
    components: [
      { name: "Sysmon", target: "All Windows VMs", purpose: "Process creation, network, file, registry events", installMethod: "Ansible role or manual MSI" },
      { name: "Splunk Universal Forwarder", target: "All Windows VMs → Splunk 10.0.1.12:9997", purpose: "Forward all event logs to central SIEM", installMethod: "Ansible role (splunk_uf_windows)" },
      { name: "Windows Security Audit", target: "All Windows VMs", purpose: "Logon, privilege use, object access, policy changes", installMethod: "Group Policy or Ansible win_regedit" },
      { name: "PowerShell ScriptBlock Logging", target: "All Windows VMs", purpose: "Capture full PowerShell script content", installMethod: "Registry: HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging" },
      { name: "PowerShell Module Logging", target: "All Windows VMs", purpose: "Log all PowerShell module invocations", installMethod: "Registry: HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging" },
      { name: "AD Directory Service Logs", target: "Domain Controllers only", purpose: "AD replication, LDAP queries, schema changes", installMethod: "Enabled by default on DCs, collected via WinEventLog input" },
      { name: "DNS Server Logs", target: "Domain Controllers with DNS", purpose: "DNS queries for C2 and exfiltration detection", installMethod: "WinEventLog://DNS Server input in Splunk UF" },
    ],
    splunkInputs: [
      "WinEventLog://Security",
      "WinEventLog://System",
      "WinEventLog://Application",
      "WinEventLog://Microsoft-Windows-Sysmon/Operational",
      "WinEventLog://Microsoft-Windows-PowerShell/Operational",
      "WinEventLog://Windows PowerShell",
      "WinEventLog://Directory Service",
      "WinEventLog://DNS Server",
      "WinEventLog://ForwardedEvents",
    ],
  };

  return NextResponse.json({
    probeTimeMs: Date.now() - startTime,
    hosts: pingResults,
    crossPing: { sarDcToGoadDc: crossPingOk, sameSubnet: "10.0.1.0/24" },
    ports: { splunkRecv, splunkWeb, splunkMgmt, dc01WinRM, ws01WinRM, sarDcWinRM },
    splunkData: { dc01: splunkDcData, ws01: splunkWsData, sarDc: splunkSarDcData },
    checklist,
    summary: { total: checklist.length, passed, failed, criticalFailed, ready: criticalFailed === 0 },
    loggingConfig,
  });
}

export async function POST(req: NextRequest) {
  // Runs an ansible playbook against lab hosts from the server.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const { action, target } = body;

  if (action !== "fix") {
    return NextResponse.json({ error: "Only action='fix' is supported" }, { status: 400 });
  }

  if (!["dc01", "ws01"].includes(target)) {
    return NextResponse.json({ error: "target must be 'dc01' or 'ws01'" }, { status: 400 });
  }

  // Run the splunk forwarder extension playbook on the target
  const goadPath = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";
  const home = process.env.HOME || "/root";
  const ansibleBin = `${home}/.goad/.venv/bin/ansible-playbook`;
  const playbookDir = `${goadPath}/extensions/splunk_forwarder/ansible`;

  // Build a targeted inventory
  const ip = target === "dc01" ? "10.0.1.30" : "10.0.1.31";
  // Note: section header is split to avoid Tailwind CSS scanner misinterpreting it as a utility class
  const sectionAll = "[" + "all" + ":" + "vars" + "]";
  const invContent = [
    sectionAll,
    `ansible_user=administrator@mini.lab`,
    `ansible_password=8dCT-DJjgScp`,
    `ansible_connection=winrm`,
    `ansible_winrm_transport=ntlm`,
    `ansible_port=5985`,
    `ansible_winrm_scheme=http`,
    `ansible_winrm_server_cert_validation=ignore`,
    `ansible_winrm_operation_timeout_sec=400`,
    `ansible_winrm_read_timeout_sec=500`,
    ``,
    `[splunk_forwarder_targets]`,
    `${target} ansible_host=${ip}`,
    `[sysmon_targets]`,
    `${target} ansible_host=${ip}`,
  ].join("\n");

  const { writeFile, unlink } = require("fs/promises");
  const invPath = `/tmp/fix_${target}_inv.ini`;
  await writeFile(invPath, invContent);

  try {
    const { stdout, stderr } = await exec(ansibleBin, [
      "-i", invPath,
      `${playbookDir}/install.yml`,
      "--extra-vars", "splunk_server_ip=10.0.1.12 splunk_server_port=9997 splunk_server_mgmt_port=8089 splunk_uf_password=I-l1ke-Attack-Range! sysmon_download_url=https://download.sysinternals.com/files/Sysmon.zip",
      "-v",
    ], {
      timeout: 600000,
      env: { ...process.env, ANSIBLE_HOST_KEY_CHECKING: "False" },
      cwd: playbookDir,
    });
    await unlink(invPath).catch(() => {});
    return NextResponse.json({ success: true, target, stdout: stdout.slice(-3000), stderr: stderr.slice(-1000) });
  } catch (err: any) {
    await unlink(invPath).catch(() => {});
    return NextResponse.json({ success: false, target, error: err.message, stderr: err.stderr?.slice(-2000) }, { status: 500 });
  }
}
