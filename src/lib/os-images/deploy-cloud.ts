/**
 * Cloud (Terraform) deploy engine for OS-image appliances.
 *
 * Flow: generate an ephemeral SSH keypair → copy the provider's Terraform module
 * into the deployment workdir → `terraform init/apply` with vault-decrypted cloud
 * creds in the subprocess env → read the public IP → SSH-provision with the same
 * provision.sh the local/VPS paths use → record the running row.
 *
 * Teardown is `terraform destroy`; start/stop use the provider CLI. Credentials
 * live only in the subprocess env; the private key is 0600 under the workdir and
 * removed on teardown. The Terraform SG locks SSH + app ports to the analyst's IP.
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getOsImage, priceFor, type OsImageEntry } from "@/config/os-images";
import { cloudCredentialEnv } from "./cloud-creds";
import { provisionOverSsh } from "./provision-ssh";
import { updateDeployment, type OsDeployment } from "./registry";

type Logger = (m: string) => void;
const log = (onLog: Logger | undefined, m: string) => { onLog?.(m); console.log(`[os-image:cloud] ${m}`); };
const DEPLOY_ROOT = path.join(process.cwd(), "labs", "deployments");

export interface CloudDeployOpts {
  provider: "aws" | "azure" | "gcp";
  region: string;
  instanceType: string;
  credentialId: string;
  allowedCidr: string;          // analyst IP /32 — never 0.0.0.0/0
  ownerId?: string;
  autoStopMinutes?: number;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs: number, onLog?: Logger): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; const tail: string[] = [];
    const onData = (buf: Buffer, keep: boolean) => { const s = buf.toString(); if (keep) out += s; for (const l of s.split("\n")) { const t = l.trimEnd(); if (t) { tail.push(t); if (tail.length > 80) tail.shift(); log(onLog, t); } } };
    child.stdout?.on("data", (d) => onData(d, true));
    child.stderr?.on("data", (d) => onData(d, false));
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${cmd} ${args[0]}\` timed out`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`\`${cmd} ${args[0]}\` exited ${code}: ${tail.slice(-8).join(" | ")}`)); });
  });
}

async function has(cmd: string): Promise<boolean> {
  try { await run(cmd, ["version"], process.cwd(), {}, 8000); return true; } catch { return false; }
}

/** DEPLOY to the cloud. `ids.deploymentId` is the pre-created installing row. */
export async function deployCloud(entryId: string, opts: CloudDeployOpts, ids: { deploymentId: string; vmName: string }, onLog?: Logger): Promise<void> {
  const entry = getOsImage(entryId);
  if (!entry) throw new Error(`unknown OS image "${entryId}"`);
  if (!entry.build.cloud) throw new Error(`"${entry.name}" has no cloud deploy config`);
  if (opts.provider !== "aws") throw new Error(`cloud provider "${opts.provider}" is scaffolded but not wired yet — use AWS or VPS`);
  if (opts.allowedCidr === "0.0.0.0/0") throw new Error("refusing to open the appliance to 0.0.0.0/0 — supply the analyst's IP /32");
  if (!(await has("terraform"))) throw new Error("`terraform` not found on the server — install Terraform to deploy to the cloud.");

  const workdir = path.join(DEPLOY_ROOT, ids.deploymentId, "tf");
  await mkdir(workdir, { recursive: true });
  await updateDeployment(ids.deploymentId, { workdir, provider: opts.provider, region: opts.region, instanceType: opts.instanceType, credentialId: opts.credentialId, estCostUsdPerHr: priceFor(opts.instanceType) });

  // 1. Ephemeral SSH keypair (openssh) under the workdir.
  const keyPath = path.join(workdir, "hbl-key");
  await run("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-q", "-C", `hbl-${ids.deploymentId}`], workdir, {}, 30_000, onLog);
  const publicKey = (await readFile(`${keyPath}.pub`, "utf-8")).trim();

  // 2. Copy the provider's Terraform module into the workdir.
  const moduleSrc = path.join(process.cwd(), entry.build.cloud.terraformDir, opts.provider);
  if (!existsSync(moduleSrc)) throw new Error(`terraform module not found: ${entry.build.cloud.terraformDir}/${opts.provider}`);
  for (const f of ["main.tf", "variables.tf", "network.tf", "compute.tf", "outputs.tf"]) {
    const s = path.join(moduleSrc, f);
    if (existsSync(s)) await cp(s, path.join(workdir, f));
  }

  // 3. tfvars (secrets are NOT here — creds go in the subprocess env).
  const sizing = entry.build.cloud.aws!;
  // Open only the ports this image actually serves (SSH 22 is always allowed by
  // the SG). behavior-lab = CAPE/hbl/ollama; SIFT/REMnux/Kali = none (SSH-only).
  const appPorts = (entry.build.provision?.forwardedPorts || []).map((p) => p.guest);
  await writeFile(path.join(workdir, "terraform.tfvars.json"), JSON.stringify({
    region: opts.region,
    name: ids.vmName,
    instance_type: opts.instanceType,
    disk_gb: sizing.diskGB,
    allowed_cidr: opts.allowedCidr,
    public_key: publicKey,
    app_ports: appPorts,
  }, null, 2), "utf-8");

  const env = await cloudCredentialEnv(opts.credentialId, opts.ownerId);

  // 4. init + apply.
  log(onLog, `terraform init (${opts.provider} ${opts.region})…`);
  await run("terraform", ["init", "-input=false", "-no-color"], workdir, env, 600_000, onLog);
  log(onLog, `terraform apply — launching ${opts.instanceType} (~$${(priceFor(opts.instanceType) ?? 0).toFixed(2)}/hr)…`);
  await run("terraform", ["apply", "-auto-approve", "-input=false", "-no-color"], workdir, env, 1_800_000, onLog);

  // 5. outputs.
  const outJson = await run("terraform", ["output", "-json"], workdir, env, 60_000);
  const outputs = JSON.parse(outJson || "{}");
  const publicIp = outputs.public_ip?.value;
  const instanceId = outputs.instance_id?.value;
  const sshUser = outputs.ssh_user?.value || "ubuntu";
  if (!publicIp) throw new Error("terraform did not return a public_ip");
  await updateDeployment(ids.deploymentId, { publicIp, instanceId, sshUser, sshKeyPath: keyPath });
  log(onLog, `instance up at ${publicIp} — provisioning…`);

  // 6. provision over SSH (same provision.sh as local/VPS).
  const recipeDir = path.join(process.cwd(), entry.build.provision!.recipeDir);
  const localSource = entry.build.provision?.localSource ? path.join(process.cwd(), entry.build.provision.localSource) : undefined;
  await provisionOverSsh({ host: publicIp, user: sshUser, keyPath, recipeDir, localSource }, onLog);

  const autoStopAt = opts.autoStopMinutes && opts.autoStopMinutes > 0
    ? new Date(Date.now() + opts.autoStopMinutes * 60_000).toISOString() : undefined;
  await updateDeployment(ids.deploymentId, { autoStopAt });
  log(onLog, `cloud appliance ready at ${publicIp}`);
}

/** Re-load creds + run a terraform/CLI lifecycle action in an existing workdir. */
async function cloudEnvFor(dep: OsDeployment): Promise<Record<string, string>> {
  if (!dep.credentialId) throw new Error("deployment has no stored credential — cannot manage it");
  return cloudCredentialEnv(dep.credentialId, dep.ownerId);
}

export async function stopCloud(dep: OsDeployment, onLog?: Logger): Promise<void> {
  if (dep.provider !== "aws" || !dep.instanceId) throw new Error("stop unsupported for this deployment");
  const env = await cloudEnvFor(dep);
  await run("aws", ["ec2", "stop-instances", "--instance-ids", dep.instanceId, "--region", dep.region || "us-east-1"], process.cwd(), env, 120_000, onLog);
}
export async function startCloud(dep: OsDeployment, onLog?: Logger): Promise<void> {
  if (dep.provider !== "aws" || !dep.instanceId) throw new Error("start unsupported for this deployment");
  const env = await cloudEnvFor(dep);
  await run("aws", ["ec2", "start-instances", "--instance-ids", dep.instanceId, "--region", dep.region || "us-east-1"], process.cwd(), env, 120_000, onLog);
}
export async function teardownCloud(dep: OsDeployment, onLog?: Logger): Promise<void> {
  const workdir = dep.workdir || path.join(DEPLOY_ROOT, dep.deploymentId, "tf");
  if (existsSync(path.join(workdir, "terraform.tfvars.json"))) {
    const env = await cloudEnvFor(dep);
    await run("terraform", ["destroy", "-auto-approve", "-input=false", "-no-color"], workdir, env, 1_800_000, onLog)
      .catch((e) => log(onLog, `destroy warning: ${e?.message || e}`));
  }
  await rm(path.join(DEPLOY_ROOT, dep.deploymentId), { recursive: true, force: true }).catch(() => {});
}
