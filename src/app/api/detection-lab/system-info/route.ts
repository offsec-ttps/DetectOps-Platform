/**
 * GET /api/detection-lab/system-info
 * Returns host system resources for template feasibility checks.
 */

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { getTemplate } from "@/config/lab-templates";
import { probeReachable } from "@/lib/c2/liveness";

// `exec` is promisified execFile with an ARGUMENT ARRAY — no shell is spawned,
// so VM names cannot be interpreted as shell metacharacters.
const exec = promisify(execFile);

/**
 * vCPU/RAM per VM, memoised across requests. These come from each VM's static
 * VirtualBox config rather than live usage, so they only change when a VM is
 * reconfigured — re-shelling out on every poll was the main cost of this route.
 * Deliberately NOT used for VM power state, which must stay live.
 */
const vmResourceCache = new Map<string, { at: number; value: { cpus: number; memoryMB: number } }>();
const VM_RESOURCE_TTL_MS = 60_000;

interface Prereqs {
  vboxVersion: string | null; vagrantVersion: string | null; ansibleVersion: string | null;
  dockerVersion: string | null; dockerComposeVersion: string | null;
}
let prereqCache: { at: number; value: Prereqs } | null = null;
const PREREQ_TTL_MS = 300_000;   // an installed toolchain doesn't change mid-session

/** Toolchain versions, probed in parallel and cached. */
async function getPrerequisites(): Promise<Prereqs> {
  if (prereqCache && Date.now() - prereqCache.at < PREREQ_TTL_MS) return prereqCache.value;

  const one = async (file: string, args: string[], shape: (s: string) => string) => {
    try {
      const { stdout } = await exec(file, args, { timeout: 5000 });
      return shape(stdout);
    } catch {
      return null;
    }
  };
  const home = process.env.HOME || "/root";

  const [vboxVersion, vagrantVersion, ansibleVersion, dockerVersion, composePlugin] = await Promise.all([
    one("VBoxManage", ["--version"], (s) => s.trim()),
    one("vagrant", ["--version"], (s) => s.trim().replace("Vagrant ", "")),
    one(`${home}/.goad/.venv/bin/ansible`, ["--version"], (s) => (s.match(/ansible \[core ([\d.]+)\]/) || [])[1] || s.split("\n")[0]),
    one("docker", ["--version"], (s) => s.trim()),
    one("docker", ["compose", "version"], (s) => s.trim()),
  ]);
  // Legacy standalone binary only if the plugin form isn't there.
  const dockerComposeVersion = composePlugin ?? (await one("docker-compose", ["--version"], (s) => s.trim()));

  const value: Prereqs = { vboxVersion, vagrantVersion, ansibleVersion, dockerVersion, dockerComposeVersion };
  prereqCache = { at: Date.now(), value };
  return value;
}

async function getSystemInfo() {
  let ramGB = 0;
  let cpuCores = 0;
  let diskGB = 0;
  let cpuModel = "Unknown";
  let os = "Unknown";

  try {
    const memRaw = await readFile("/proc/meminfo", "utf-8");
    const memMatch = memRaw.match(/MemTotal:\s+(\d+)/);
    if (memMatch) ramGB = Math.round(parseInt(memMatch[1]) / 1024 / 1024);
  } catch { /* ignore */ }

  try {
    const cpuRaw = await readFile("/proc/cpuinfo", "utf-8");
    const cores = cpuRaw.match(/^processor\s/gm);
    if (cores) cpuCores = cores.length;
    const modelMatch = cpuRaw.match(/model name\s*:\s*(.+)/);
    if (modelMatch) cpuModel = modelMatch[1].trim();
  } catch { /* ignore */ }

  // All mounted drives
  let drives: { mount: string; device: string; totalGB: number; usedGB: number; availGB: number; usePct: number }[] = [];
  try {
    const { stdout } = await exec("df", ["-BG", "--output=source,target,size,used,avail,pcent"], { timeout: 5000 });
    for (const line of stdout.trim().split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const device = parts[0];
      const mount = parts[1];
      // Skip pseudo/system filesystems
      if (device.startsWith("tmpfs") || device === "udev" || device === "overlay" || mount.startsWith("/snap") || mount.startsWith("/boot/efi") || device === "none") continue;
      const totalGB = parseInt(parts[2].replace("G", "")) || 0;
      const usedGB = parseInt(parts[3].replace("G", "")) || 0;
      const availGB = parseInt(parts[4].replace("G", "")) || 0;
      const usePct = parseInt(parts[5].replace("%", "")) || 0;
      if (totalGB < 1) continue;
      drives.push({ mount, device, totalGB, usedGB, availGB, usePct });
    }
    // Sort: root first, then by available space descending
    drives.sort((a, b) => (a.mount === "/" ? -1 : b.mount === "/" ? 1 : b.availGB - a.availGB));
    // Use root drive as default disk space
    const root = drives.find((d) => d.mount === "/");
    if (root) diskGB = root.availGB;
  } catch { /* ignore */ }

  try {
    const { stdout } = await exec("uname", ["-sr"], { timeout: 3000 });
    os = stdout.trim();
  } catch { /* ignore */ }

  // Toolchain versions. Run CONCURRENTLY and cache: these were five sequential
  // process spawns on a route the UI polls, and an installed toolchain does not
  // change between polls. Each resolves to null when the tool is absent.
  const prereqs = await getPrerequisites();
  const { vboxVersion, vagrantVersion, ansibleVersion, dockerVersion, dockerComposeVersion } = prereqs;

  // Check running VMs
  let runningVMs: string[] = [];
  try {
    const { stdout } = await exec("VBoxManage", ["list", "runningvms"], { timeout: 5000 });
    runningVMs = stdout.split("\n").filter(Boolean).map((l) => {
      const match = l.match(/"([^"]+)"/);
      return match ? match[1] : l;
    });
  } catch { /* ignore */ }

  // Check all registered VMs
  let allVMs: { name: string; state: string }[] = [];
  try {
    const { stdout } = await exec("VBoxManage", ["list", "vms"], { timeout: 5000 });
    const vmNames = stdout.split("\n").filter(Boolean).map((l) => {
      const match = l.match(/"([^"]+)"/);
      return match ? match[1] : "";
    }).filter(Boolean);
    allVMs = vmNames.map((name) => ({
      name,
      state: runningVMs.includes(name) ? "running" : "poweroff",
    }));
  } catch { /* ignore */ }

  // Per-VM resource consumption (vCPUs + RAM) straight from VirtualBox.
  //
  // This used to `await` one `VBoxManage showvminfo` per VM in a sequential
  // loop. At ~145ms a call across 56 registered VMs that alone cost ~8s of the
  // endpoint's ~10s, which is what made "Probing environments…" hang. Three
  // changes, none of which alter the data returned:
  //   1. skip "<inaccessible>" VMs — VirtualBox cannot report on them, so every
  //      one was 145ms spent to reach the catch block;
  //   2. run the rest concurrently with a modest cap (VBoxManage is a process
  //      spawn per call, so unbounded parallelism just thrashes);
  //   3. memoise per VM name — vCPU/RAM come from static VM config, not live
  //      usage, so re-reading them on every poll is wasted work.
  const vmResources = new Map<string, { cpus: number; memoryMB: number }>();
  const probeTargets = allVMs
    .map((vm) => vm.name)
    .filter((name) => name && name !== "<inaccessible>");

  for (const name of probeTargets) {
    const hit = vmResourceCache.get(name);
    if (hit && Date.now() - hit.at < VM_RESOURCE_TTL_MS) vmResources.set(name, hit.value);
  }
  const toProbe = probeTargets.filter((name) => !vmResources.has(name));

  const CONCURRENCY = 8;
  for (let i = 0; i < toProbe.length; i += CONCURRENCY) {
    await Promise.all(
      toProbe.slice(i, i + CONCURRENCY).map(async (name) => {
        try {
          const { stdout } = await exec("VBoxManage", ["showvminfo", name, "--machinereadable"], { timeout: 5000 });
          const cpus = parseInt((stdout.match(/^cpus=(\d+)/m) || [])[1] || "0", 10) || 0;
          const memoryMB = parseInt((stdout.match(/^memory=(\d+)/m) || [])[1] || "0", 10) || 0;
          const value = { cpus, memoryMB };
          vmResources.set(name, value);
          vmResourceCache.set(name, { at: Date.now(), value });
        } catch { /* VM info unavailable — leave unmeasured */ }
      }),
    );
  }
  // Sum live vCPU/RAM for a set of VM names; disk falls back to the template spec.
  const resourcesFor = (names: string[]) => {
    let cpus = 0, memoryMB = 0;
    for (const n of names) {
      const r = vmResources.get(n);
      if (r) { cpus += r.cpus; memoryMB += r.memoryMB; }
    }
    return { cpus, memoryMB };
  };

  // Detect installed environments.
  //
  // Three sources can describe the same physical VMs: the platform deployment
  // registry (authoritative — exact VM names + the template used), and the
  // legacy SAR / GOAD source-tree detectors (heuristic name matching). We walk
  // them in that priority order and let each environment CLAIM the VM names it
  // owns; later sources skip VMs (and whole cards) already claimed, so a VM is
  // never listed under two environments.
  const { existsSync } = require("fs");
  const installedEnvironments: {
    id: string; name: string; templateName?: string; type: string; status: string;
    path: string; vms: string[]; vmNames?: string[]; accessUrl?: string; templateId?: string;
    cpus?: number; memoryMB?: number; diskGB?: number; fleetLab?: boolean;
    networkBase?: string; splunkIp?: string;
  }[] = [];
  const claimed = new Set<string>();

  // The real Splunk IP is whatever the lab's conf was deployed with (the deploy
  // engine rebases 10.0.1.x → the chosen networkBase, e.g. 192.168.56.x). Read it
  // so accessUrl, the reachability probe, and the shown VM IPs all reflect the
  // network the operator actually chose (so Caldera + the lab can reach each other).
  const { readFileSync: rfsConf } = require("fs");
  const splunkIpFromConf = (deployPath: string): string | null => {
    for (const p of [`${deployPath}/sar/attack_range_local.conf`, `${deployPath}/attack_range_local.conf`]) {
      try { if (existsSync(p)) { const m = String(rfsConf(p, "utf-8")).match(/^\s*splunk_server_private_ip\s*=\s*([0-9.]+)/m); if (m) return m[1].trim(); } } catch { /* ignore */ }
    }
    return null;
  };
  const netBase = (ip: string) => ip.split(".").slice(0, 3).join(".");

  const statusFor = (existing: { name: string; state: string }[], declaredCount: number): string => {
    if (existing.length === 0) return "missing"; // VMs removed from VirtualBox outside our control
    const running = existing.filter((v) => v.state === "running").length;
    if (running === declaredCount && declaredCount > 0) return "running";
    if (running > 0) return "partial";
    return "stopped";
  };

  // ── 1. Platform-managed deployments (authoritative) ──
  // The global registry of deployments made through the Detection Lab UI.
  // Persists until explicitly destroyed (removed from registry by the deploy
  // route's destroy action).
  try {
    const { readFileSync } = require("fs");
    const registryPath = `${process.cwd()}/labs/.deployments-registry.json`;
    if (existsSync(registryPath)) {
      const registry: Array<{
        id: string; templateId: string; templateName: string; labType: string;
        prefix: string; deployPath: string; vmNames: Record<string, string>;
        createdAt: string; lastDeployedAt: string;
      }> = JSON.parse(readFileSync(registryPath, "utf-8"));

      for (const dep of registry) {
        const declared = Object.values(dep.vmNames);
        const existing = allVMs.filter((v) => declared.includes(v.name));
        // If every existing VM this registration points at is already shown by
        // an earlier environment, it's a duplicate registration → skip it.
        if (existing.length > 0 && existing.every((v) => claimed.has(v.name))) continue;
        existing.forEach((v) => claimed.add(v.name));

        const tmpl = getTemplate(dep.templateId);
        const templateName = tmpl?.name || dep.templateName || dep.templateId;
        const specDiskGB = tmpl ? tmpl.vms.reduce((s, v) => s + (v.diskGB || 0), 0) : 0;
        const res = resourcesFor(existing.map((v) => v.name));
        const splunkIp = dep.labType === "sar-docker" ? null : splunkIpFromConf(dep.deployPath);

        installedEnvironments.push({
          id: dep.id,
          name: templateName,
          templateName,
          type: dep.labType,
          status: statusFor(existing, declared.length),
          path: dep.deployPath,
          templateId: dep.templateId,
          fleetLab: !!tmpl?.fleetLab,
          vms: existing.length > 0
            ? existing.map((v) => `${v.name} (${v.state})`)
            : declared.map((n) => `${n} (missing)`),
          vmNames: declared,
          accessUrl: dep.labType === "sar-docker" ? "http://localhost:4321" : `http://${splunkIp || "10.0.1.12"}:8000`,
          networkBase: splunkIp ? netBase(splunkIp) : undefined,
          splunkIp: splunkIp || undefined,
          cpus: res.cpus,
          memoryMB: res.memoryMB,
          diskGB: specDiskGB,
        });
      }
    }
  } catch { /* registry read failed, skip */ }

  // ── 2. Legacy SAR source-tree install ──
  const sarPath = process.env.SAR_PATH || "/media/nested/SamsungEvo/Simulation/attack_range_local";
  if (existsSync(`${sarPath}/attack_range_local.conf`)) {
    const sarVMs = allVMs.filter((v) =>
      (v.name.toLowerCase().includes("attack-range") || v.name.toLowerCase().includes("splunk")) &&
      !claimed.has(v.name)
    );
    // Only surface the source install if it owns VMs not already shown by a
    // platform deployment (otherwise it's the same lab, listed twice).
    if (sarVMs.length > 0) {
      sarVMs.forEach((v) => claimed.add(v.name));
      const res = resourcesFor(sarVMs.map((v) => v.name));
      const srcIp = splunkIpFromConf(sarPath);
      installedEnvironments.push({
        id: "sar-local",
        name: "Splunk Attack Range (source install)",
        templateName: "Splunk Attack Range (source)",
        type: "sar",
        status: statusFor(sarVMs, sarVMs.length),
        path: sarPath,
        vms: sarVMs.map((v) => `${v.name} (${v.state})`),
        vmNames: sarVMs.map((v) => v.name),
        accessUrl: `http://${srcIp || "10.0.1.12"}:8000`,
        networkBase: srcIp ? netBase(srcIp) : undefined,
        splunkIp: srcIp || undefined,
        cpus: res.cpus,
        memoryMB: res.memoryMB,
      });
    }
  }

  // ── 3. Legacy GOAD source-tree instances ──
  const goadPath = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";
  const goadWorkspace = `${goadPath}/workspace`;
  if (existsSync(goadWorkspace)) {
    try {
      const { readdirSync, readFileSync } = require("fs");
      const entries = readdirSync(goadWorkspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const instFile = `${goadWorkspace}/${entry.name}/instance.json`;
        if (!existsSync(instFile)) continue;
        try {
          const data = JSON.parse(readFileSync(instFile, "utf-8"));
          // Claim only unclaimed GOAD VMs — the first instance to reach a given
          // DC/WS/SRV owns it; later instances (and platform deploys above) don't
          // re-list the same boxes.
          const goadVMs = allVMs.filter((v) =>
            ["DC01", "DC02", "DC03", "WS01", "SRV02", "SRV03"].includes(v.name) && !claimed.has(v.name)
          );
          if (goadVMs.length === 0) continue; // fully represented elsewhere → skip
          goadVMs.forEach((v) => claimed.add(v.name));
          const res = resourcesFor(goadVMs.map((v) => v.name));
          installedEnvironments.push({
            id: data.id || entry.name,
            name: `GOAD ${data.lab || "?"} (${data.provider || "?"}, source install)`,
            templateName: `GOAD ${data.lab || "?"} (source)`,
            type: "sar-goad",
            status: statusFor(goadVMs, goadVMs.length),
            path: `${goadWorkspace}/${entry.name}`,
            vms: goadVMs.map((v) => `${v.name} (${v.state})`),
            vmNames: goadVMs.map((v) => v.name),
            accessUrl: "http://10.0.1.12:8000",
            cpus: res.cpus,
            memoryMB: res.memoryMB,
          });
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  // Reachability gate: a VM powered on in VirtualBox is NOT the same as the lab
  // actually running. Downgrade a "running" lab to "unreachable" when its Splunk
  // isn't answering (VM hung, Splunk not started, IP conflict, mid-boot, etc.),
  // so the UI only shows a lab as live when it truly is.
  await Promise.all(installedEnvironments.map(async (env) => {
    if (env.status !== "running") return;
    const isDocker = env.type === "sar-docker";
    const tmpl = env.templateId ? getTemplate(env.templateId) : null;
    const splunkVm = tmpl?.vms.find((v) => /splunk/i.test(v.role) || v.name.toLowerCase().startsWith("splunk"));
    const host = isDocker ? "127.0.0.1" : (env.splunkIp || splunkVm?.ip || "10.0.1.12");
    const port = isDocker ? 4321 : 8089;   // Splunk mgmt REST (or SAR-docker web)
    const up = await probeReachable(host, port, 1800).catch(() => false);
    if (!up) env.status = "unreachable";
  }));

  // The same template deployed twice (e.g. "SAR Minimal" under ~/.detectops-labs
  // AND under labs/deployments/) produces rows with identical names. An operator
  // then can't tell the RUNNING lab from a stale one, reads the stopped row as
  // "my local lab is unreachable", and goes looking for a fault that isn't there.
  // Tag the duplicates with the network they're on — that is the difference that
  // actually matters, since it's the address you connect to.
  const nameCounts = new Map<string, number>();
  for (const e of installedEnvironments) nameCounts.set(e.name, (nameCounts.get(e.name) || 0) + 1);
  for (const e of installedEnvironments) {
    if ((nameCounts.get(e.name) || 0) < 2) continue;
    const tag = e.networkBase ? `${e.networkBase}.x` : e.id.replace(/^deploy-/, "").slice(0, 6);
    e.name = `${e.name} · ${tag}`;
  }

  return {
    ramGB,
    cpuCores,
    cpuModel,
    diskGB,
    os,
    drives,
    prerequisites: {
      virtualbox: vboxVersion,
      vagrant: vagrantVersion,
      ansible: ansibleVersion,
      docker: dockerVersion,
      dockerCompose: dockerComposeVersion,
    },
    runningVMs,
    allVMs,
    installedEnvironments,
  };
}

export async function GET() {
  const info = await getSystemInfo();
  return NextResponse.json(info);
}
