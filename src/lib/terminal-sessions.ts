/**
 * In-memory terminal session manager.
 *
 * Spawns processes (usually `docker exec attack-range-api ssh ...`) on behalf of
 * the Cloud tab's terminal UI and fans their stdout/stderr out to SSE
 * subscribers. NOT a real PTY — use for non-interactive tool runners, not vim.
 *
 * Sessions die when the Next.js server restarts (MVP).
 */

import { spawn, spawnSync, ChildProcessWithoutNullStreams } from "child_process";
import { randomBytes } from "crypto";
import { mkdirSync, existsSync, chmodSync } from "fs";
import path from "path";
import os from "os";

export type SessionEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null; signal: string | null }
  | { type: "info"; data: string };

interface Subscriber {
  id: string;
  send: (ev: SessionEvent) => void;
}

export interface Session {
  id: string;
  rangeId: string;
  serverName: string;
  command: string;
  proc: ChildProcessWithoutNullStreams | null;
  buffer: SessionEvent[];            // bounded ring buffer for late subscribers
  subscribers: Map<string, Subscriber>;
  createdAt: string;
  exited: boolean;
  exitCode: number | null;
}

/**
 * Stash the session map on globalThis so it persists across Next.js route
 * handler module boundaries and HMR reloads. Without this the POST /sessions
 * handler and GET /sessions/[id]/stream handler each get their own copy of
 * this module (because Next compiles them separately) and the map never
 * shares state — leading to "session not found" right after create.
 */
type SessionStore = { sessions: Map<string, Session> };
const globalStore = globalThis as unknown as { __sarTerminalStore?: SessionStore };
if (!globalStore.__sarTerminalStore) {
  globalStore.__sarTerminalStore = { sessions: new Map() };
}
const sessions = globalStore.__sarTerminalStore.sessions;
const MAX_BUFFER = 2000;

function newId(prefix = "sess"): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function emit(session: Session, ev: SessionEvent) {
  session.buffer.push(ev);
  if (session.buffer.length > MAX_BUFFER) session.buffer.shift();
  for (const sub of session.subscribers.values()) {
    try { sub.send(ev); } catch { /* ignore */ }
  }
}

/**
 * Create a session by spawning a shell command. Caller provides the full
 * command string; we wrap with `/bin/sh -lc` so pipes/&&/quoting work.
 */
export function createSession(opts: {
  rangeId: string;
  serverName: string;
  command: string;
}): Session {
  const id = newId();
  const session: Session = {
    id,
    rangeId: opts.rangeId,
    serverName: opts.serverName,
    command: opts.command,
    proc: null,
    buffer: [],
    subscribers: new Map(),
    createdAt: new Date().toISOString(),
    exited: false,
    exitCode: null,
  };
  sessions.set(id, session);

  emit(session, { type: "info", data: `$ ${opts.command}\r\n` });

  const proc = spawn("/bin/sh", ["-lc", opts.command], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm-256color" },
  });
  session.proc = proc;

  proc.stdout.on("data", (buf: Buffer) => {
    emit(session, { type: "stdout", data: buf.toString("utf-8") });
  });
  proc.stderr.on("data", (buf: Buffer) => {
    emit(session, { type: "stderr", data: buf.toString("utf-8") });
  });
  proc.on("error", (err) => {
    emit(session, { type: "stderr", data: `[spawn error] ${err.message}\r\n` });
  });
  proc.on("close", (code, signal) => {
    session.exited = true;
    session.exitCode = code;
    emit(session, { type: "exit", code, signal });
  });

  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function subscribe(id: string, sub: Subscriber): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.subscribers.set(sub.id, sub);
  // Replay buffer so the terminal shows history
  for (const ev of s.buffer) {
    try { sub.send(ev); } catch { /* ignore */ }
  }
  return true;
}

export function unsubscribe(id: string, subId: string): void {
  sessions.get(id)?.subscribers.delete(subId);
}

export function sendInput(id: string, data: string): boolean {
  const s = sessions.get(id);
  if (!s || !s.proc || s.exited) return false;
  try { s.proc.stdin.write(data); return true; }
  catch { return false; }
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.proc && !s.exited) {
    try { s.proc.kill("SIGTERM"); } catch { /* ignore */ }
  }
  // give it a beat, then delete
  setTimeout(() => { sessions.delete(id); }, 5000);
  return true;
}

/**
 * Build an SSH command that reaches a cloud lab host through the user's active
 * WireGuard tunnel.
 *
 * Key architectural detail: the tunnel lives on the HOST (the user connected
 * via their WireGuard client). The SAR API container is NOT on the tunnel —
 * `docker exec attack-range-api ssh …` cannot route to 10.0.1.x / 10.0.2.x.
 * So we must spawn `ssh` locally on the Next.js side.
 *
 * SAR stores private keys inside the API container at /app/ssh_keys/{rangeId}.key
 * (0600, root-owned). We cache a host-side copy at $XDG_CACHE_HOME/detection-platform/
 * sar-keys/ on first use per range, chmod 0600, then use it directly.
 *
 * ssh flags:
 *   StrictHostKeyChecking=no          first-connect trust-on-first-use
 *   UserKnownHostsFile=/dev/null      don't pollute the host's known_hosts
 *   ConnectTimeout=8                  fail fast if the tunnel is down
 *   BatchMode=yes                     never prompt interactively
 */

const KEY_CACHE_DIR = path.join(os.homedir(), ".cache", "detection-platform", "sar-keys");

function cacheSarKey(rangeId: string): string {
  mkdirSync(KEY_CACHE_DIR, { recursive: true });
  const cached = path.join(KEY_CACHE_DIR, `${rangeId}.key`);
  if (!existsSync(cached)) {
    const src = `attack-range-api:/app/ssh_keys/${rangeId}.key`;
    const r = spawnSync("docker", ["cp", src, cached]);
    if (r.status !== 0) {
      const err = (r.stderr?.toString() || r.stdout?.toString() || "unknown").trim();
      throw new Error(`docker cp for SAR key failed: ${err}`);
    }
    try { chmodSync(cached, 0o600); } catch { /* best-effort */ }
  }
  return cached;
}

export function buildSshCommand(rangeId: string, serverIp: string, remoteCmd: string): string {
  const keyPath = cacheSarKey(rangeId);
  const quoted = remoteCmd.replace(/'/g, `'"'"'`);
  const sshFlags = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -o BatchMode=yes`;
  // Username: ubuntu on Linux hosts; cloud Windows targets need RDP/WinRM instead of SSH.
  // Callers route Windows targets through other mechanisms (WinRM not supported here).
  return `ssh -i '${keyPath}' ${sshFlags} ubuntu@${serverIp} '${quoted}' 2>&1; ec=$?; echo "[ssh exited code=$ec]"`;
}

// ── Tool command templates ──

export const TOOL_RUNNERS = {
  whoami: () => "whoami && uname -a && pwd",
  "system-info": () => "uname -a; lsb_release -a 2>/dev/null; free -m; df -h | head -5",
  purplesharp: (technique: string) =>
    // Assumes PurpleSharp.exe has been pre-staged at C:\\Tools\\PurpleSharp\\. Runs via WinRM.
    `powershell -Command "& 'C:\\Tools\\PurpleSharp\\PurpleSharp.exe' -t ${technique}"`,
  "atomic-red-team": (technique: string) =>
    `powershell -Command "Import-Module 'C:\\AtomicRedTeam\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1'; Invoke-AtomicTest '${technique}' -Confirm:$false"`,
  rta: (script: string) => `python3 /opt/rta/${script}.py`,
} as const satisfies Record<string, (arg: string) => string>;

export type ToolId = keyof typeof TOOL_RUNNERS;
