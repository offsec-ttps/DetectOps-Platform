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
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getOsImage } from "@/config/os-images";

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

function vagrantfile(boxRef: string, hostname: string, vmName: string, cpus: number, memoryMB: number): string {
  return [
    'Vagrant.configure("2") do |config|',
    `  config.vm.box = "${boxRef}"`,
    `  config.vm.hostname = "${hostname}"`,
    '  config.vm.provider "virtualbox" do |vb|',
    `    vb.name = "${vmName}"`,
    `    vb.cpus = ${cpus}`,
    `    vb.memory = ${memoryMB}`,
    "    vb.gui = true",
    "  end",
    "end",
    "",
  ].join("\n");
}

function assertDeployable(entryId: string) {
  const entry = getOsImage(entryId);
  if (!entry) throw new Error(`unknown OS image "${entryId}"`);
  if (entry.build.method !== "vagrant-box" || !entry.build.boxRef || !entry.build.available) {
    throw new Error(`"${entry.name}" has no automated local deploy yet — follow its guided setup steps.`);
  }
  return entry;
}

/** DEPLOY: write the Vagrantfile and `vagrant up`. */
export async function deployOsImage(entryId: string, onLog?: Logger): Promise<OsDeployResult> {
  const entry = assertDeployable(entryId);
  if (!(await has("vagrant", ["--version"]))) throw new Error("`vagrant` not found — install Vagrant + VirtualBox, then retry.");
  if (!(await has("VBoxManage", ["--version"]))) throw new Error("`VBoxManage` not found — install VirtualBox, then retry.");

  const deploymentId = `osvm-${entryId}-${Date.now().toString(36)}`;
  const vmName = `${deploymentId}-${randomBytes(2).toString("hex")}`;
  const workdir = workdirFor(deploymentId);
  await mkdir(workdir, { recursive: true });
  await writeFile(path.join(workdir, "Vagrantfile"),
    vagrantfile(entry.build.boxRef!, entryId, vmName, entry.resources.cpus, entry.resources.memoryMB), "utf-8");
  await writeFile(path.join(workdir, "deployment.json"), JSON.stringify({
    kind: "os-image", entryId, deploymentId, vmName, box: entry.build.boxRef, createdAt: new Date().toISOString(),
  }, null, 2), "utf-8").catch(() => {});

  log(onLog, `Deploying ${entry.name} (vagrant up — box "${entry.build.boxRef}" downloads on first run)…`);
  await run("vagrant", ["up", "--provider", "virtualbox"], workdir, 3_600_000, onLog);
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
