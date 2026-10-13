/**
 * Tiny JSON registry for deployed analyst OS-image VMs, mirroring
 * labs/.deployments-registry.json. Avoids a Prisma migration (and the
 * dev-server-restart gotcha) for what is a small, host-local list. Live power
 * state is derived from VirtualBox at read time, not trusted from the file.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);
const REGISTRY = path.join(process.cwd(), "labs", ".os-images-registry.json");

export interface OsDeployment {
  deploymentId: string;
  imageId: string;
  name: string;
  vmName: string;
  ownerId: string;
  status: "installing" | "running" | "stopped" | "error";
  lastError?: string;
  createdAt: string;
}

async function readAll(): Promise<OsDeployment[]> {
  try { return JSON.parse(await readFile(REGISTRY, "utf-8")); } catch { return []; }
}
async function writeAll(rows: OsDeployment[]): Promise<void> {
  await mkdir(path.dirname(REGISTRY), { recursive: true }).catch(() => {});
  await writeFile(REGISTRY, JSON.stringify(rows, null, 2), "utf-8");
}

export async function addDeployment(row: OsDeployment): Promise<void> {
  const rows = await readAll();
  await writeAll([row, ...rows.filter((r) => r.deploymentId !== row.deploymentId)]);
}
export async function setStatus(deploymentId: string, status: OsDeployment["status"], lastError = ""): Promise<void> {
  const rows = await readAll();
  const r = rows.find((x) => x.deploymentId === deploymentId);
  if (r) { r.status = status; r.lastError = lastError; await writeAll(rows); }
}
export async function removeDeployment(deploymentId: string): Promise<void> {
  await writeAll((await readAll()).filter((r) => r.deploymentId !== deploymentId));
}
export async function getDeployment(deploymentId: string): Promise<OsDeployment | undefined> {
  return (await readAll()).find((r) => r.deploymentId === deploymentId);
}

/** Set of VM names VirtualBox currently reports as running. */
async function runningVmNames(): Promise<Set<string>> {
  try {
    const { stdout } = await exec("VBoxManage", ["list", "runningvms"], { timeout: 5000 });
    return new Set(stdout.split("\n").map((l) => (l.match(/"([^"]+)"/) || [])[1]).filter(Boolean) as string[]);
  } catch { return new Set(); }
}

/** Deployments for a user (or all when unscoped), with live power state. */
export async function listDeployments(ownerId: string | null): Promise<OsDeployment[]> {
  const rows = await readAll();
  const running = await runningVmNames();
  return rows
    .filter((r) => !ownerId || !r.ownerId || r.ownerId === ownerId)
    .map((r) => {
      if (r.status === "installing" || r.status === "error") return r; // mid-transition states are authoritative
      return { ...r, status: running.has(r.vmName) ? "running" : "stopped" };
    });
}
