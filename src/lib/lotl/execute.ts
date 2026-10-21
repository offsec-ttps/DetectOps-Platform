/**
 * Execute a LOTL technique against a real lab host.
 *
 * This is the piece that was missing: it takes a LotlTechnique, runs it through
 * compileLotl() (placeholder resolution + benign artifact staging), then runs the
 * compiled command over the SAME transports the SAR pipeline proves out —
 *   • Linux  (bash)                → SSH with the deployment's Vagrant key
 *   • Windows (powershell | cmd)   → WinRM/NTLM via the bundled winrm-runner.py
 * macOS/manual steps have no SAR target and are reported n/a (not failed).
 *
 * Node has no native WinRM; rather than add a dependency we shell to Python
 * pywinrm (already used across the platform), passing secrets on stdin only.
 *
 * Safety: compileLotl makes commands benign (inert artifacts, success markers,
 * benign URLs). Genuinely destructive libraries still deserve the caller's
 * simulate-only default + consent gate — this module executes exactly what it is
 * given and reports faithfully; it does not decide policy.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileLotl, type CompiledLotl } from "./compile";

/**
 * Locate winrm-runner.py. Under `tsx`/plain Node, import.meta.url points at this
 * source file; under the Next.js bundler it may not, so prefer the known source
 * path relative to the project cwd and fall back to the module dir.
 */
function resolveWinrmRunner(): string {
  const cwdPath = path.join(process.cwd(), "src", "lib", "lotl", "winrm-runner.py");
  if (existsSync(cwdPath)) return cwdPath;
  try { return path.join(path.dirname(fileURLToPath(import.meta.url)), "winrm-runner.py"); }
  catch { return cwdPath; }
}
const WINRM_RUNNER = resolveWinrmRunner();

export interface LinuxTarget {
  os: "linux";
  host: string;
  user: string;
  keyPath: string;
  /**
   * Path to a known_hosts file to verify the host key against. When set, host-key
   * checking is STRICT. Omitted for ephemeral Vagrant lab VMs, which are destroyed
   * and recreated with a fresh host key on every deploy (pinning would fail every
   * redeploy); provisioning can populate one with `ssh-keyscan` and pass it here.
   */
  knownHostsPath?: string;
}
export interface WindowsTarget {
  os: "windows";
  host: string;
  port?: number;
  user: string;
  password: string;
  /** Python interpreter that has pywinrm (e.g. the GOAD venv). */
  pythonBin: string;
  /** "http" (default; payload still encrypted at the NTLM message layer) | "https". */
  scheme?: "http" | "https";
  /** TLS cert handling when scheme is https: "ignore" (lab self-signed) | "validate". */
  certValidation?: "ignore" | "validate";
}
export type LotlTargets = { linux?: LinuxTarget; windows?: WindowsTarget };

export interface LotlExecInput {
  command: string;
  executor: string;
  cleanupCommand?: string | null;
  platforms: string[];
  name?: string;
  techniqueId?: string | null;
  library?: string;
  sourceRef?: string;
}

export type LotlExecStatus = "ok" | "failure" | "skipped" | "error";

export interface LotlExecResult {
  status: LotlExecStatus;
  transport: "ssh" | "winrm" | "none";
  platform: CompiledLotl["platform"];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  resolved: string[];
  warnings: string[];
  unresolved: string[];
  notes: string;
}

function run(cmd: string, args: string[], opts: { timeoutMs: number; stdin?: string }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); if (stdout.length > 200_000) stdout = stdout.slice(-200_000); });
    child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 64_000) stderr = stderr.slice(-64_000); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr + `\n[spawn-error] ${e.message}`, timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    if (opts.stdin != null) { child.stdin.write(opts.stdin); }
    child.stdin.end();
  });
}

const SSH_BASE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "LogLevel=ERROR"];

/**
 * Host-key options. With a known_hosts file we verify strictly; without one (the
 * default for ephemeral lab VMs whose key rotates every redeploy) we accept the
 * key on first use but keep it out of the user's real ~/.ssh/known_hosts.
 */
function sshHostKeyOpts(t: LinuxTarget): string[] {
  if (t.knownHostsPath) {
    return ["-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${t.knownHostsPath}`];
  }
  return ["-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/dev/null"];
}

interface RawExec {
  transport: "ssh" | "winrm";
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  transportError?: boolean;
}

async function runLinux(t: LinuxTarget, command: string, timeoutMs: number): Promise<RawExec> {
  // The compiled bash runs on the target's /bin/sh via a single SSH invocation.
  // "--" ends ssh option parsing so a host/user value can never be read as an option.
  const r = await run("ssh", ["-i", t.keyPath, ...sshHostKeyOpts(t), ...SSH_BASE, "-l", t.user, "--", t.host, command], { timeoutMs });
  return { transport: "ssh", ...r };
}

async function runWindows(t: WindowsTarget, exec: { executor: string; command: string }, timeoutMs: number): Promise<RawExec> {
  const scheme = t.scheme || "http";
  const job = JSON.stringify({
    host: t.host, port: t.port || (scheme === "https" ? 5986 : 5985), user: t.user, password: t.password,
    scheme, certValidation: t.certValidation || "ignore",
    shell: exec.executor === "cmd" ? "cmd" : "powershell",
    script: exec.command,
    timeoutSec: Math.ceil(timeoutMs / 1000),
  });
  const r = await run(t.pythonBin, [WINRM_RUNNER], { timeoutMs: timeoutMs + 20_000, stdin: job });
  // The helper prints one JSON line; a transport failure is ok:false.
  let parsed: any = null;
  try { parsed = JSON.parse(r.stdout.trim().split("\n").filter(Boolean).pop() || "{}"); } catch { /* keep raw */ }
  if (parsed && parsed.ok === true) {
    return { transport: "winrm" as const, code: parsed.rc, stdout: parsed.stdout || "", stderr: parsed.stderr || "", timedOut: r.timedOut };
  }
  const err = (parsed && parsed.error) || r.stderr || r.stdout || "winrm runner returned no result";
  return { transport: "winrm" as const, code: null, stdout: "", stderr: String(err), timedOut: r.timedOut, transportError: true };
}

export interface LabExecOutcome {
  status: LotlExecStatus;
  transport: "ssh" | "winrm" | "none";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  notes: string;
}

/**
 * Run an ALREADY-RESOLVED command on the lab over the right transport, with no
 * LOTL compile step. Shared by executeLotl (LOTL, after compile) and the APT
 * runner (Atomic Red Team commands, after #{arg} substitution) so both use the
 * one verified SSH/WinRM path and derive the same ok/failure/error/skipped.
 */
export async function runCommandOnLab(
  targets: LotlTargets,
  input: { command: string; executor: string; platform: CompiledLotl["platform"] },
  timeoutMs: number,
): Promise<LabExecOutcome> {
  const t0 = Date.now();
  const none = (notes: string): LabExecOutcome => ({ status: "skipped", transport: "none", exitCode: null, stdout: "", stderr: "", durationMs: Date.now() - t0, notes });
  const { platform, executor, command } = input;
  let raw: RawExec;
  if (platform === "windows") {
    if (!targets.windows) return none("no Windows target in this lab");
    raw = await runWindows(targets.windows, { executor, command }, timeoutMs);
  } else if (platform === "linux") {
    if (!targets.linux) return none("no Linux target in this lab");
    raw = await runLinux(targets.linux, command, timeoutMs);
  } else if (platform === "multi") {
    if (executor === "bash" && targets.linux) raw = await runLinux(targets.linux, command, timeoutMs);
    else if (targets.windows) raw = await runWindows(targets.windows, { executor, command }, timeoutMs);
    else if (targets.linux) raw = await runLinux(targets.linux, command, timeoutMs);
    else return none("no matching target");
  } else {
    return none(`no SAR target for platform ${platform}`);
  }
  const durationMs = Date.now() - t0;
  if (raw.transportError) return { status: "error", transport: raw.transport, exitCode: null, stdout: raw.stdout, stderr: raw.stderr, durationMs, notes: "transport/connection error" };
  if (raw.timedOut) return { status: "failure", transport: raw.transport, exitCode: raw.code, stdout: raw.stdout, stderr: raw.stderr, durationMs, notes: `timed out after ${Math.round(timeoutMs / 1000)}s` };
  const status: LotlExecStatus = raw.code === 0 ? "ok" : "failure";
  return { status, transport: raw.transport, exitCode: raw.code, stdout: raw.stdout, stderr: raw.stderr, durationMs, notes: status === "ok" ? "" : `non-zero exit (${raw.code})` };
}

/**
 * Compile + execute one LOTL technique. Pure w.r.t. inputs except the remote
 * side effect; returns a faithful result the caller records + scores.
 */
export async function executeLotl(input: LotlExecInput, targets: LotlTargets, opts: { timeoutMs?: number } = {}): Promise<LotlExecResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const t0 = Date.now();
  const compiled = compileLotl({
    command: input.command, executor: input.executor, cleanupCommand: input.cleanupCommand,
    platforms: input.platforms, name: input.name,
  });

  const base = {
    platform: compiled.platform, resolved: compiled.resolved, warnings: compiled.warnings, unresolved: compiled.unresolved,
  };

  // Never run a command that still contains template placeholders the compiler
  // could not resolve (e.g. {PATH_SMB}, {DOMAIN}) — it needs operator-supplied
  // infrastructure and would execute a literal "{...}" on the target. Skip it.
  if (compiled.unresolved.length > 0) {
    return { status: "skipped", transport: "none", exitCode: null, stdout: "", stderr: "", durationMs: Date.now() - t0, notes: `unresolved placeholders: ${compiled.unresolved.join(", ")}`, ...base };
  }

  if (compiled.executor === "manual") {
    return { status: "skipped", transport: "none", exitCode: null, stdout: "", stderr: "", durationMs: Date.now() - t0, notes: "manual technique — no automated execution", ...base };
  }

  // Pick the transport for the technique's platform (shared helper, no re-compile).
  const outcome = await runCommandOnLab(targets, { command: compiled.command, executor: compiled.executor, platform: compiled.platform }, timeoutMs);
  return { ...outcome, durationMs: Date.now() - t0, ...base };
}
