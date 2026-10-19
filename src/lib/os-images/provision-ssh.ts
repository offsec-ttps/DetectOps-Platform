/**
 * Shared SSH provisioner for the cloud + VPS OS-image deploy paths.
 *
 * Packages the provisioning recipe (build-recipes/os-images/<id>/) and the
 * optional local pipeline source into a tarball, scp's it to the target host,
 * and runs provision.sh there with HBL_SRC_DIR pointing at the uploaded source
 * — so the SAME provision.sh serves local (Vagrant synced folder) and remote.
 *
 * Uses the system `ssh`/`scp` binaries with the same host-key policy as
 * src/lib/lotl/execute.ts (accept-new, keys kept out of ~/.ssh/known_hosts).
 * No secrets are logged; the private key is a path the caller supplies.
 */

import { spawn } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type Logger = (m: string) => void;
const log = (onLog: Logger | undefined, m: string) => { onLog?.(m); console.log(`[os-image:ssh] ${m}`); };

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"];

// A host/user that could be read as an ssh/scp FLAG (e.g. "-oProxyCommand=…") is an
// argument-injection → RCE vector. Validate strictly, and additionally pass the user
// via `-l`/`-o User=` and never start an operand with "-".
const HOST_RE = /^(?!-)[A-Za-z0-9._-]{1,253}$/;        // IPv4 or hostname, no leading dash, no ':'
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/i;

export function validateHostUser(host: string, user: string): void {
  if (!HOST_RE.test(host)) throw new Error(`invalid host "${host}" (expected a hostname or IPv4 with no leading '-')`);
  if (!USER_RE.test(user)) throw new Error(`invalid ssh user "${user}"`);
}

function sh(cmd: string, args: string[], timeoutMs: number, onLog?: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    const onData = (d: Buffer) => { for (const l of d.toString().split("\n")) { const t = l.trimEnd(); if (t) { tail.push(t); if (tail.length > 80) tail.shift(); log(onLog, t); } } };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`\`${cmd}\` timed out`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args[0]}\` exited ${code}: ${tail.slice(-6).join(" | ")}`)); });
  });
}

export interface ProvisionOpts {
  host: string;
  user: string;
  keyPath: string;          // private key (0600)
  recipeDir: string;        // absolute path to build-recipes/os-images/<id>
  localSource?: string;     // absolute path to the pipeline repo (optional)
  env?: Record<string, string>;  // extra env exported before provision.sh
  timeoutMs?: number;
}

/** Wait until the host accepts SSH (cloud instances boot a little after apply). */
async function waitForSsh(o: ProvisionOpts, onLog?: Logger): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    try {
      await sh("ssh", ["-i", o.keyPath, ...SSH_OPTS, "-o", "ConnectTimeout=10", "-l", o.user, o.host, "true"], 20_000);
      return;
    } catch {
      attempt++;
      log(onLog, `waiting for SSH on ${o.host} (attempt ${attempt})…`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  throw new Error(`SSH to ${o.host} never came up`);
}

/**
 * Provision a remote host: stage recipe (+ source) locally, scp up, run
 * provision.sh. Returns when provisioning completes (long — CAPE/Ollama install).
 */
export async function provisionOverSsh(o: ProvisionOpts, onLog?: Logger): Promise<void> {
  validateHostUser(o.host, o.user);
  const timeoutMs = o.timeoutMs ?? 7_200_000; // 2h: heavy installs
  const SKIP = /(^|\/)(\.git|data|\.venv|node_modules|__pycache__|dist|\.pytest_cache|\.ruff_cache)(\/|$)|\.egg-info(\/|$)/;

  // Stage a payload dir: provision/ (recipe) [+ provision/hbl-src (source)].
  const stage = await mkdtemp(path.join(tmpdir(), "hbl-prov-"));
  try {
    await cp(o.recipeDir, path.join(stage, "provision"), { recursive: true });
    if (o.localSource) {
      await cp(o.localSource, path.join(stage, "provision", "hbl-src"), {
        recursive: true, filter: (s) => !SKIP.test(s.slice(o.localSource!.length)),
      }).catch((e) => log(onLog, `hbl-src copy warning: ${e?.message || e}`));
    }

    await waitForSsh(o, onLog);

    log(onLog, `uploading provisioning payload to ${o.host}…`);
    await sh("ssh", ["-i", o.keyPath, ...SSH_OPTS, "-l", o.user, o.host, "mkdir -p /tmp/hbl-provision"], 30_000, onLog);
    // scp target uses -o User= (no user@host) and a validated host so neither can be read as a flag.
    await sh("scp", ["-i", o.keyPath, ...SSH_OPTS, "-o", `User=${o.user}`, "-r", `${stage}/provision/.`, `${o.host}:/tmp/hbl-provision/`], 600_000, onLog);

    // Build the remote command: export extra env (no secrets here — just config),
    // point HBL_SRC_DIR at the uploaded source, run provision.sh with sudo.
    const exports = Object.entries(o.env || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    const remote = `sudo env ${exports} HBL_SRC_DIR=/tmp/hbl-provision/hbl-src bash /tmp/hbl-provision/provision.sh`;
    log(onLog, `running provision.sh on ${o.host} (this takes a while)…`);
    await sh("ssh", ["-i", o.keyPath, ...SSH_OPTS, "-o", "ServerAliveInterval=30", "-l", o.user, o.host, remote], timeoutMs, onLog);
    log(onLog, `provisioning complete on ${o.host}`);
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Run a one-off remote command (used by start/stop/teardown for VPS). */
export async function sshExec(host: string, user: string, keyPath: string, command: string, timeoutMs = 120_000, onLog?: Logger): Promise<void> {
  validateHostUser(host, user);
  await sh("ssh", ["-i", keyPath, ...SSH_OPTS, "-o", "ConnectTimeout=15", "-l", user, host, command], timeoutMs, onLog);
}
