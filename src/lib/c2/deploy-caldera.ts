/**
 * Managed standalone-Caldera — NATIVE (no Docker) install + start/stop.
 *
 * Everything lives inside the cloned repo on the project's big disk (venv, the
 * built Vue UI, logs) — nothing is written to the (near-full) root disk that
 * Docker would use. Model:
 *   • install (deployCaldera): clone + patch conf/local.yml + create a venv +
 *     pip install + build the magma UI. Leaves the server STOPPED.
 *   • start (startCaldera):    spawn `python server.py` detached; wait for :8888.
 *   • stop  (stopCaldera):     kill the recorded pid (its process group).
 *   • teardown:                stop + remove the deployment dir.
 *
 * Decoupled from the Local Lab; runs on the same host DetectOps runs on, so a
 * beacon on this machine reaches it at http://<advertiseHost>:8888.
 *
 * Prereqs on the host: python>=3.9, go (compiles sandcat beacons), node/npm
 * (builds the web UI). We detect them and fail fast with guidance if missing.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { openSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { C2DeployOpts, C2DeployResult } from "./types";

const exec = promisify(execFile);
const DEPLOY_ROOT = path.join(process.cwd(), "labs", "deployments");
const CALDERA_PORT = 8888;

function log(opts: C2DeployOpts, m: string) { opts.onLog?.(m); console.log(`[c2-caldera] ${m}`); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function workdirFor(id: string) { return path.join(DEPLOY_ROOT, id); }
function repoDirFor(id: string) { return path.join(DEPLOY_ROOT, id, "caldera"); }
function venvPython(repoDir: string) { return path.join(repoDir, ".venv", "bin", "python"); }
function pidFileFor(id: string) { return path.join(workdirFor(id), "server.pid"); }

function detectLanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "127.0.0.1";
}

async function has(cmd: string, args: string[]): Promise<boolean> {
  try { await exec(cmd, args, { timeout: 8000 }); return true; } catch { return false; }
}

/** First python >= 3.9 (Caldera's aiohttp needs it). */
async function pickPython(): Promise<string> {
  for (const p of ["python3.12", "python3.11", "python3.10", "python3.9"]) {
    if (await has(p, ["--version"])) return p;
  }
  // Fall back to python3 only if it is >= 3.9.
  try {
    const { stdout } = await exec("python3", ["--version"], { timeout: 8000 });
    const m = stdout.match(/3\.(\d+)/);
    if (m && Number(m[1]) >= 9) return "python3";
  } catch { /* none */ }
  throw new Error("No Python >= 3.9 found (Caldera needs it). Install python3.11, then retry.");
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  // Interpolated into `bash -c` — only ever accept a literal IPv4 + integer port.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !Number.isInteger(port)) return false;
  try { await exec("bash", ["-c", `echo >/dev/tcp/${ip}/${port}`], { timeout: 5000 }); return true; } catch { return false; }
}

/** Run a command, streaming to the deploy log; reject on non-zero exit. */
function run(cmd: string, args: string[], cwd: string, timeoutMs: number, opts: C2DeployOpts, extraEnv?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    const onData = (d: Buffer) => { for (const l of d.toString().split("\n")) { const t = l.trimEnd(); if (t) { tail.push(t); if (tail.length > 60) tail.shift(); log(opts, t); } } };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${cmd} ${args.slice(0, 3).join(" ")}…\` timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.slice(0, 3).join(" ")}…\` exited ${code}: ${tail.slice(-6).join(" | ")}`)); });
  });
}

/** Patch conf/local.yml from conf/default.yml (see git history for rationale). */
async function writeCalderaConfig(repoDir: string, apiKeyRed: string, apiKeyBlue: string, adminPw: string): Promise<void> {
  const defPath = path.join(repoDir, "conf", "default.yml");
  let text = await readFile(defPath, "utf-8");
  const salt = randomBytes(16).toString("hex");
  const enc = randomBytes(24).toString("hex");
  const repl = (re: RegExp, to: string, label: string) => {
    if (!re.test(text)) throw new Error(`Caldera default.yml missing expected key (${label}) — layout changed`);
    text = text.replace(re, to);
  };
  repl(/^api_key_red:.*$/m, `api_key_red: ${apiKeyRed}`, "api_key_red");
  repl(/^api_key_blue:.*$/m, `api_key_blue: ${apiKeyBlue}`, "api_key_blue");
  repl(/^crypt_salt:.*$/m, `crypt_salt: ${salt}`, "crypt_salt");
  repl(/^encryption_key:.*$/m, `encryption_key: ${enc}`, "encryption_key");
  repl(/^host:.*$/m, "host: 0.0.0.0", "host");
  repl(/^port:.*$/m, `port: ${CALDERA_PORT}`, "port");
  text = text
    .replace(/^(\s+blue:\s+)admin\s*$/m, `$1${adminPw}`)
    .replace(/^(\s+admin:\s+)admin\s*$/m, `$1${adminPw}`)
    .replace(/^(\s+red:\s+)admin\s*$/m, `$1${adminPw}`);
  await writeFile(path.join(repoDir, "conf", "local.yml"), text, "utf-8");
}

/**
 * INSTALL (background): clone + venv + pip install + build UI. Leaves stopped.
 * Reuses an existing clone at the target path if the caller pre-cloned it.
 */
export async function deployCaldera(opts: C2DeployOpts): Promise<C2DeployResult> {
  const deploymentId = `c2-caldera-${Date.now().toString(36)}`;
  const workdir = workdirFor(deploymentId);
  const repoDir = repoDirFor(deploymentId);
  const advertiseHost = (opts.advertiseHost || "").trim() || detectLanIp();

  // Prereqs
  const py = await pickPython();
  if (!(await has("go", ["version"]))) throw new Error("`go` not found — Caldera needs Go to compile beacons. Install golang, then retry.");
  if (!(await has("node", ["--version"]))) throw new Error("`node`/npm not found — Caldera needs Node to build its web UI. Install Node, then retry.");

  await mkdir(workdir, { recursive: true });
  log(opts, `Cloning MITRE Caldera into ${repoDir} (recursive; server-side internet needed, endpoints stay offline)`);
  await exec("git", ["clone", "--recursive", "--depth", "1", "https://github.com/mitre/caldera.git", repoDir], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });

  const apiKeyRed = randomBytes(24).toString("hex");
  const apiKeyBlue = randomBytes(24).toString("hex");
  const adminPw = randomBytes(9).toString("base64url");
  await writeCalderaConfig(repoDir, apiKeyRed, apiKeyBlue, adminPw);
  log(opts, "Wrote conf/local.yml (patched api keys + creds, bound 0.0.0.0)");

  // Keep pip/npm caches OFF the (near-full) root disk — pin them under the
  // deployment dir on the big disk.
  const cacheEnv = { PIP_CACHE_DIR: path.join(workdir, ".pipcache"), npm_config_cache: path.join(workdir, ".npmcache") };

  log(opts, `Creating Python venv (${py}) + installing requirements…`);
  await run(py, ["-m", "venv", ".venv"], repoDir, 120_000, opts);
  await run(venvPython(repoDir), ["-m", "pip", "install", "--upgrade", "pip", "wheel"], repoDir, 300_000, opts, cacheEnv);
  await run(venvPython(repoDir), ["-m", "pip", "install", "-r", "requirements.txt"], repoDir, 1_800_000, opts, cacheEnv);

  const magma = path.join(repoDir, "plugins", "magma");
  if (existsSync(magma)) {
    log(opts, "Building the Caldera web UI (npm install + build)…");
    await run("npm", ["install"], magma, 1_200_000, opts, cacheEnv);
    await run("npm", ["run", "build"], magma, 1_200_000, opts, cacheEnv);
  }

  await writeFile(path.join(workdir, "deployment.json"), JSON.stringify({
    kind: "c2-caldera-native", deploymentId, repoDir, advertiseHost, port: CALDERA_PORT, python: py, createdAt: new Date().toISOString(),
  }, null, 2), "utf-8").catch(() => {});

  log(opts, "Caldera installed (stopped). Start it when you want to run a simulation.");
  return { url: `http://${advertiseHost}:${CALDERA_PORT}`, apiKey: apiKeyRed, group: "red", advertiseHost, deploymentId, adminUser: "red", adminPassword: adminPw };
}

/** START: spawn `python server.py` detached; record pid; wait for :8888. */
export async function startCaldera(deploymentId: string, onLog?: (m: string) => void): Promise<void> {
  const opts: C2DeployOpts = { name: deploymentId, ownerId: "", onLog };
  const repoDir = repoDirFor(deploymentId);
  const py = venvPython(repoDir);
  if (!existsSync(py)) throw new Error("Caldera venv missing — reinstall the server");

  // Already up?
  if (await checkPort("127.0.0.1", CALDERA_PORT)) { log(opts, "Caldera already listening on :8888"); return; }

  const logFd = openSync(path.join(workdirFor(deploymentId), "server.log"), "a");
  log(opts, "Starting Caldera (python server.py)…");
  const child = spawn(py, ["server.py"], {
    cwd: repoDir, env: { ...process.env }, detached: true, stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  if (child.pid) await writeFile(pidFileFor(deploymentId), String(child.pid), "utf-8").catch(() => {});

  const start = Date.now();
  while (Date.now() - start < 180_000) {
    if (await checkPort("127.0.0.1", CALDERA_PORT)) { log(opts, `Caldera live on :${CALDERA_PORT}`); return; }
    await sleep(4000);
  }
  throw new Error(`Caldera did not open port ${CALDERA_PORT} within 3 minutes after start — see labs/deployments/${deploymentId}/server.log`);
}

/** STOP: kill the recorded server process (and its group). */
export async function stopCaldera(deploymentId: string, onLog?: (m: string) => void): Promise<void> {
  const opts: C2DeployOpts = { name: deploymentId, ownerId: "", onLog };
  let pid = 0;
  try { pid = Number((await readFile(pidFileFor(deploymentId), "utf-8")).trim()); } catch { /* no pid */ }
  if (!pid) { log(opts, "No recorded pid — nothing to stop"); return; }
  log(opts, `Stopping Caldera (pid ${pid})…`);
  try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
  await sleep(2000);
  try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
  await rm(pidFileFor(deploymentId)).catch(() => {});
  // Fallback: if something still holds the port (pid drift / a worker outside the
  // group), free it. The managed Caldera is the sole owner of this port.
  if (await checkPort("127.0.0.1", CALDERA_PORT)) {
    log(opts, `Port ${CALDERA_PORT} still held — freeing it`);
    await exec("bash", ["-c", `fuser -k ${CALDERA_PORT}/tcp`], { timeout: 8000 }).catch(() => {});
  }
}

/** TEARDOWN: stop + remove the whole deployment dir (frees the clone + venv). */
export async function teardownCaldera(deploymentId: string): Promise<void> {
  await stopCaldera(deploymentId).catch(() => {});
  await rm(workdirFor(deploymentId), { recursive: true, force: true }).catch(() => {});
}
