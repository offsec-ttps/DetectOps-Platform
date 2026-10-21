/**
 * Generic Docker-based C2 deploy engine (first automated wave).
 *
 * Mirrors deploy-caldera.ts but drives a per-framework DockerAdapter instead of
 * a hardcoded flow. Model, per framework:
 *   • install (deployGeneric): shallow-clone the repo + run the adapter's build
 *     steps into labs/deployments/<id>. Leaves the server INSTALLED (stopped).
 *   • start (startGeneric):    run the adapter's start steps; wait for its port.
 *   • stop  (stopGeneric):     run the adapter's stop steps.
 *   • teardown:                stop + remove the deployment dir.
 *
 * Everything lives on the project's big disk (labs/deployments), never the
 * near-full root disk. Server-side internet is needed to pull images/clone;
 * endpoints stay offline. All output is streamed to the deploy log.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { C2DeployOpts, C2DeployResult } from "./types";
import { getC2CatalogEntry } from "@/config/c2-catalog";
import { getDockerAdapter, type AdapterCtx, type AdapterStep } from "./adapters";

const exec = promisify(execFile);
const DEPLOY_ROOT = path.join(process.cwd(), "labs", "deployments");

function log(opts: C2DeployOpts, m: string) { opts.onLog?.(m); console.log(`[c2-generic] ${m}`); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function workdirFor(id: string) { return path.join(DEPLOY_ROOT, id); }
function repoDirFor(id: string) { return path.join(DEPLOY_ROOT, id, "repo"); }

function detectLanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "127.0.0.1";
}

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await exec(cmd, args, { timeout: 8000 }); return true; } catch { return false; }
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  // Interpolated into `bash -c` — only ever accept a literal IPv4 + integer port.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !Number.isInteger(port)) return false;
  try { await exec("bash", ["-c", `echo >/dev/tcp/${ip}/${port}`], { timeout: 5000 }); return true; } catch { return false; }
}

/** Run one streamed step; reject on non-zero exit. */
function runStep(step: AdapterStep, opts: C2DeployOpts): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.cmd, step.args, { cwd: step.cwd, env: { ...process.env, ...step.env }, stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    const onData = (d: Buffer) => { for (const l of d.toString().split("\n")) { const t = l.trimEnd(); if (t) { tail.push(t); if (tail.length > 60) tail.shift(); log(opts, t); } } };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${step.cmd} ${step.args.slice(0, 2).join(" ")}…\` timed out`)); }, step.timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`\`${step.cmd} ${step.args.slice(0, 2).join(" ")}…\` exited ${code}: ${tail.slice(-6).join(" | ")}`)); });
  });
}

function ctxFor(entryId: string, deploymentId: string, advertiseHost: string, apiKey: string, adminPassword: string): AdapterCtx {
  return {
    workdir: workdirFor(deploymentId),
    repoDir: repoDirFor(deploymentId),
    advertiseHost,
    adminUser: `${entryId}_admin`,
    adminPassword,
    apiKey,
  };
}

/** Resolve the adapter for a catalog id, or throw a clear error. */
function adapterFor(entryId: string) {
  const entry = getC2CatalogEntry(entryId);
  if (!entry || entry.deploy.method !== "docker" || !entry.deploy.composeRef) {
    throw new Error(`"${entryId}" is not a Docker-deployable C2 framework`);
  }
  const adapter = getDockerAdapter(entry.deploy.composeRef);
  if (!adapter) throw new Error(`no Docker adapter registered for "${entryId}"`);
  return adapter;
}

/** INSTALL (background): clone + adapter build steps. Leaves stopped. */
export async function deployGeneric(entryId: string, opts: C2DeployOpts): Promise<C2DeployResult> {
  const adapter = adapterFor(entryId);
  const deploymentId = `c2-${entryId}-${Date.now().toString(36)}`;
  const workdir = workdirFor(deploymentId);
  const repoDir = repoDirFor(deploymentId);
  const advertiseHost = (opts.advertiseHost || "").trim() || detectLanIp();

  if (!(await has("docker", ["--version"]))) throw new Error("`docker` not found — this framework deploys via Docker. Install Docker + Compose, then retry.");
  if (!(await has("docker", ["compose", "version"]))) throw new Error("`docker compose` not found — install the Docker Compose plugin, then retry.");

  const apiKey = randomBytes(24).toString("hex");
  const adminPassword = randomBytes(9).toString("base64url");
  const ctx = ctxFor(entryId, deploymentId, advertiseHost, apiKey, adminPassword);

  await mkdir(workdir, { recursive: true });
  if (adapter.repo) {
    log(opts, `Cloning ${entryId} into ${repoDir} (server-side internet needed; endpoints stay offline)`);
    await exec("git", ["clone", "--recursive", "--depth", "1", adapter.repo, repoDir], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
  } else {
    await mkdir(repoDir, { recursive: true });
  }

  log(opts, `Installing ${entryId} (Docker build/pull)…`);
  for (const step of adapter.install(ctx)) await runStep(step, opts);

  await writeFile(path.join(workdir, "deployment.json"), JSON.stringify({
    kind: `c2-${entryId}-docker`, entryId, deploymentId, repoDir, advertiseHost,
    healthPort: adapter.healthPort, createdAt: new Date().toISOString(),
  }, null, 2), "utf-8").catch(() => {});

  const creds = adapter.creds(ctx);
  log(opts, `${entryId} installed (stopped). Start it when you want to run a simulation.`);
  return {
    url: adapter.consoleUrl(ctx),
    apiKey: creds.apiKey || apiKey,
    group: "red",
    advertiseHost,
    deploymentId,
    adminUser: creds.adminUser || ctx.adminUser,
    adminPassword: creds.adminPassword || adminPassword,
  };
}

/** START: run the adapter's start steps; wait for its health port. */
export async function startGeneric(entryId: string, deploymentId: string, advertiseHost: string, onLog?: (m: string) => void): Promise<void> {
  const adapter = adapterFor(entryId);
  const opts: C2DeployOpts = { name: deploymentId, ownerId: "", onLog };
  const ctx = ctxFor(entryId, deploymentId, advertiseHost || detectLanIp(), "", "");
  if (!existsSync(repoDirFor(deploymentId))) throw new Error(`${entryId} deployment missing — reinstall the server`);

  if (await checkPort("127.0.0.1", adapter.healthPort)) { log(opts, `${entryId} already listening on :${adapter.healthPort}`); return; }

  log(opts, `Starting ${entryId}…`);
  for (const step of adapter.start(ctx)) await runStep(step, opts);

  const start = Date.now();
  while (Date.now() - start < 240_000) {
    if (await checkPort("127.0.0.1", adapter.healthPort)) { log(opts, `${entryId} live on :${adapter.healthPort}`); return; }
    await sleep(5000);
  }
  throw new Error(`${entryId} did not open port ${adapter.healthPort} within 4 minutes — see labs/deployments/${deploymentId}`);
}

/** STOP: run the adapter's stop steps. */
export async function stopGeneric(entryId: string, deploymentId: string, onLog?: (m: string) => void): Promise<void> {
  const adapter = adapterFor(entryId);
  const opts: C2DeployOpts = { name: deploymentId, ownerId: "", onLog };
  const ctx = ctxFor(entryId, deploymentId, detectLanIp(), "", "");
  log(opts, `Stopping ${entryId}…`);
  for (const step of adapter.stop(ctx)) await runStep(step, opts).catch((e) => log(opts, `stop step failed (continuing): ${e?.message || e}`));
}

/** TEARDOWN: stop + remove the whole deployment dir. */
export async function teardownGeneric(entryId: string, deploymentId: string): Promise<void> {
  const adapter = adapterFor(entryId);
  const ctx = ctxFor(entryId, deploymentId, detectLanIp(), "", "");
  for (const step of adapter.teardown(ctx)) await runStep(step, { name: deploymentId, ownerId: "" }).catch(() => {});
  await rm(workdirFor(deploymentId), { recursive: true, force: true }).catch(() => {});
}
