/**
 * VPS deploy engine — provision an EXISTING remote host the analyst already owns.
 *
 * No infrastructure is created or destroyed: we SSH in with a vaulted key and run
 * the same provision.sh the local/cloud paths use. Teardown stops the services and
 * drops the registry row but NEVER touches the analyst's host beyond that.
 */

import path from "node:path";
import { getOsImage } from "@/config/os-images";
import { materializeSshKey, vpsCredentialMeta } from "./cloud-creds";
import { provisionOverSsh, sshExec } from "./provision-ssh";
import { updateDeployment, type OsDeployment } from "./registry";

type Logger = (m: string) => void;

export interface VpsDeployOpts {
  host: string;
  sshUser?: string;
  sshKeyCredentialId: string;
  ownerId?: string;
}

export async function deployVps(entryId: string, opts: VpsDeployOpts, ids: { deploymentId: string; vmName: string }, onLog?: Logger): Promise<void> {
  const entry = getOsImage(entryId);
  if (!entry) throw new Error(`unknown OS image "${entryId}"`);
  if (!entry.build.provision) throw new Error(`"${entry.name}" has no provisioning recipe`);
  if (!opts.host) throw new Error("VPS host is required");

  const meta = await vpsCredentialMeta(opts.sshKeyCredentialId, opts.ownerId).catch(() => ({} as any));
  const user = opts.sshUser || meta.defaultUser || "root";
  await updateDeployment(ids.deploymentId, { provider: "vps", publicIp: opts.host, sshUser: user, credentialId: opts.sshKeyCredentialId });

  const { keyPath, cleanup } = await materializeSshKey(opts.sshKeyCredentialId, opts.ownerId);
  try {
    const recipeDir = path.join(process.cwd(), entry.build.provision.recipeDir);
    const localSource = entry.build.provision.localSource ? path.join(process.cwd(), entry.build.provision.localSource) : undefined;
    await provisionOverSsh({ host: opts.host, user, keyPath, recipeDir, localSource }, onLog);
  } finally {
    await cleanup();
  }
}

/** Best-effort service lifecycle on the analyst's host. */
async function withKey<T>(dep: OsDeployment, fn: (keyPath: string, user: string, host: string) => Promise<T>): Promise<T> {
  if (!dep.credentialId) throw new Error("VPS deployment has no stored ssh credential");
  const { keyPath, cleanup } = await materializeSshKey(dep.credentialId, dep.ownerId);
  try { return await fn(keyPath, dep.sshUser || "root", dep.publicIp || ""); }
  finally { await cleanup(); }
}

export async function stopVps(dep: OsDeployment, onLog?: Logger): Promise<void> {
  await withKey(dep, (k, u, h) => sshExec(h, u, k, "sudo systemctl stop hbl ollama 2>/dev/null || true", 60_000, onLog));
}
export async function startVps(dep: OsDeployment, onLog?: Logger): Promise<void> {
  await withKey(dep, (k, u, h) => sshExec(h, u, k, "sudo systemctl start hbl ollama 2>/dev/null || true", 60_000, onLog));
}
export async function teardownVps(dep: OsDeployment, onLog?: Logger): Promise<void> {
  // Never destroy the analyst's host — just stop our services (best-effort).
  await stopVps(dep, onLog).catch(() => {});
}
