/**
 * Local (VirtualBox/Vagrant) deploy engine for analyst OS images.
 *
 * Mirrors src/lib/c2/deploy-generic.ts. For a `vagrant-box` entry it writes a
 * minimal Vagrantfile that references the image's PUBLIC upstream box, then
 * `vagrant up` materialises it (box pull happens on Vagrant's side). Lifecycle:
 *   • deploy  → write Vagrantfile + `vagrant up`  (box download can be large)
 *   • stop    → `vagrant halt`
 *   • start   → `vagrant up`
 *   • teardown→ `vagrant destroy -f` + remove the dir
 *
 * Everything lives under labs/deployments/<id> on the big disk. Cloud targets
 * (AWS/Azure/GCP via Packer into the user's own account) are a follow-on and are
 * not handled here — those entries are template-only in the catalog.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getOsImage, type OsImageEntry } from "@/config/os-images";

const exec = promisify(execFile);
const DEPLOY_ROOT = path.join(process.cwd(), "labs", "deployments");

export interface OsDeployResult { deploymentId: string; vmName: string; workdir: string; }
type Logger = (m: string) => void;

function workdirFor(id: string) { return path.join(DEPLOY_ROOT, id); }
function log(onLog: Logger | undefined, m: string) { onLog?.(m); console.log(`[os-image] ${m}`); }

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await exec(cmd, args, { timeout: 8000 }); return true; } catch { return false; }
}

/** Run a streamed command; reject on non-zero exit. */
function run(cmd: string, args: string[], cwd: string, timeoutMs: number, onLog?: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    const onData = (d: Buffer) => { for (const l of d.toString().split("\n")) { const t = l.trimEnd(); if (t) { tail.push(t); if (tail.length > 60) tail.shift(); log(onLog, t); } } };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${cmd} ${args[0]}\` timed out`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args[0]}\` exited ${code}: ${tail.slice(-6).join(" | ")}`)); });
  });
}

function vagrantfile(entry: OsImageEntry, hostname: string, vmName: string): string {
  const { boxRef, provision } = entry.build;
  const { cpus, memoryMB } = entry.resources;
  const lines = [
    'Vagrant.configure("2") do |config|',
    `  config.vm.box = "${boxRef}"`,
    `  config.vm.hostname = "${hostname}"`,
  ];
  // Port forwards (e.g. CAPE web UI, hbl server) for provisioned appliances.
  // Bound to loopback (127.0.0.1) by default so a malware-analysis UI is NOT
  // exposed on all host interfaces; an entry must opt in to a routable hostIp.
  for (const p of provision?.forwardedPorts || []) {
    const guest = Number(p.guest), host = Number(p.host);
    if (!Number.isInteger(guest) || !Number.isInteger(host) || guest < 1 || guest > 65535 || host < 1 || host > 65535) {
      throw new Error(`invalid forwarded port in provision spec: guest=${p.guest} host=${p.host}`);
    }
    const hostIp = typeof p.hostIp === "string" && /^[0-9.]{7,15}$/.test(p.hostIp) ? p.hostIp : "127.0.0.1";
    const idLabel = p.name ? `, id: ${JSON.stringify(p.name)}` : "";
    lines.push(`  config.vm.network "forwarded_port", guest: ${guest}, host: ${host}, host_ip: "${hostIp}", auto_correct: true${idLabel}`);
  }
  lines.push('  config.vm.provider "virtualbox" do |vb|');
  lines.push(`    vb.name = "${vmName}"`);
  lines.push(`    vb.cpus = ${cpus}`);
  lines.push(`    vb.memory = ${memoryMB}`);
  lines.push("    vb.gui = true");
  // Nested virtualization: required for a sandbox that runs its own KVM analysis
  // guest (CAPE). Harmless where the host CPU doesn't support it beyond a warning.
  if (provision?.nestedVirt) {
    lines.push('    vb.customize ["modifyvm", :id, "--nested-hw-virt", "on"]');
  }
  lines.push("  end");
  // Shell provisioner: the recipe dir is copied into the workdir as `provision/`,
  // so reference the entry script by its in-workdir path. Runs privileged.
  if (provision?.script) {
    lines.push(`  config.vm.provision "shell", path: "provision/${provision.script}", privileged: true`);
  }
  lines.push("end", "");
  return lines.join("\n");
}

function assertDeployable(entryId: string) {
  const entry = getOsImage(entryId);
  if (!entry) throw new Error(`unknown OS image "${entryId}"`);
  if (entry.build.method !== "vagrant-box" || !entry.build.boxRef || !entry.build.available) {
    throw new Error(`"${entry.name}" has no automated local deploy yet — follow its guided setup steps.`);
  }
  return entry;
}

/** Pre-generate the ids so the caller can record an "installing" row BEFORE the
 *  (long) `vagrant up`, then pass them here so the VM matches that row. */
export function newOsDeploymentIds(entryId: string): { deploymentId: string; vmName: string } {
  const deploymentId = `osvm-${entryId}-${Date.now().toString(36)}`;
  return { deploymentId, vmName: `${deploymentId}-${randomBytes(2).toString("hex")}` };
}

/** DEPLOY: write the Vagrantfile and `vagrant up`. */
export async function deployOsImage(entryId: string, onLog?: Logger, ids?: { deploymentId: string; vmName: string }): Promise<OsDeployResult> {
  const entry = assertDeployable(entryId);
  if (!(await has("vagrant", ["--version"]))) throw new Error("`vagrant` not found — install Vagrant + VirtualBox, then retry.");
  if (!(await has("VBoxManage", ["--version"]))) throw new Error("`VBoxManage` not found — install VirtualBox, then retry.");

  const { deploymentId, vmName } = ids ?? newOsDeploymentIds(entryId);
  const workdir = workdirFor(deploymentId);
  await mkdir(workdir, { recursive: true });

  // Copy the provisioning recipe into the workdir so the Vagrant shell
  // provisioner can run it. Fail early (before `vagrant up`) if it's missing.
  if (entry.build.provision?.recipeDir) {
    const src = path.join(process.cwd(), entry.build.provision.recipeDir);
    if (!existsSync(src)) throw new Error(`provisioning recipe not found: ${entry.build.provision.recipeDir}`);
    await cp(src, path.join(workdir, "provision"), { recursive: true });
  }
  // Copy the local pipeline source into the synced folder so the provisioner
  // installs it from /vagrant/provision/hbl-src (no external git remote needed).
  // Heavy/ignored dirs are filtered out to keep the copy small + fast.
  if (entry.build.provision?.localSource) {
    const srcRoot = path.join(process.cwd(), entry.build.provision.localSource);
    if (existsSync(srcRoot)) {
      const SKIP = /(^|\/)(\.git|data|\.venv|node_modules|__pycache__|dist|\.pytest_cache|\.ruff_cache)(\/|$)|\.egg-info(\/|$)/;
      await cp(srcRoot, path.join(workdir, "provision", "hbl-src"), {
        recursive: true,
        filter: (s) => !SKIP.test(s.slice(srcRoot.length)),
      }).catch((e) => log(onLog, `hbl-src copy warning: ${e?.message || e}`));
    } else {
      log(onLog, `localSource ${entry.build.provision.localSource} not found — provisioner will fall back to git clone`);
    }
  }

  await writeFile(path.join(workdir, "Vagrantfile"), vagrantfile(entry, entryId, vmName), "utf-8");
  await writeFile(path.join(workdir, "deployment.json"), JSON.stringify({
    kind: "os-image", entryId, deploymentId, vmName, box: entry.build.boxRef,
    provisioned: !!entry.build.provision, createdAt: new Date().toISOString(),
  }, null, 2), "utf-8").catch(() => {});

  // Provisioned appliances (box download + heavy install) get a longer budget.
  const timeoutMs = entry.build.provision ? 7_200_000 : 3_600_000;
  log(onLog, `Deploying ${entry.name} (vagrant up — box "${entry.build.boxRef}" downloads on first run)${entry.build.provision ? "; provisioning will take a while" : ""}…`);
  await run("vagrant", ["up", "--provider", "virtualbox"], workdir, timeoutMs, onLog);
  log(onLog, `${entry.name} is up (VM "${vmName}").`);
  return { deploymentId, vmName, workdir };
}

/** START / STOP an existing deployment. */
export async function startOsImage(deploymentId: string, onLog?: Logger): Promise<void> {
  const workdir = workdirFor(deploymentId);
  if (!existsSync(path.join(workdir, "Vagrantfile"))) throw new Error("deployment missing — redeploy the image");
  await run("vagrant", ["up", "--provider", "virtualbox"], workdir, 1_800_000, onLog);
}
export async function stopOsImage(deploymentId: string, onLog?: Logger): Promise<void> {
  const workdir = workdirFor(deploymentId);
  if (!existsSync(path.join(workdir, "Vagrantfile"))) throw new Error("deployment missing");
  await run("vagrant", ["halt"], workdir, 300_000, onLog);
}

/** TEARDOWN: destroy the VM + remove the deployment dir. */
export async function teardownOsImage(deploymentId: string, onLog?: Logger): Promise<void> {
  const workdir = workdirFor(deploymentId);
  if (existsSync(path.join(workdir, "Vagrantfile"))) {
    await run("vagrant", ["destroy", "-f"], workdir, 300_000, onLog).catch((e) => log(onLog, `destroy warning: ${e?.message || e}`));
  }
  await rm(workdir, { recursive: true, force: true }).catch(() => {});
}
