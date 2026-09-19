/**
 * Unified event log.
 *
 * Single entry point — `logEvent({...})` — that:
 *   1. Writes a row to the EventLog table (best-effort, never throws).
 *   2. Appends a JSON line to logs/events-YYYY-MM-DD.jsonl on disk
 *      so the user can tail it like any traditional service log.
 *   3. Mirrors a single-line summary to stdout so it lands in the dev-server
 *      log captured by start-server.sh.
 *
 * Designed to be cheap to call from any route handler. If any of the three
 * sinks fail, the others still run; the caller never sees an exception.
 */

import { prisma } from "@/lib/prisma";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type EventStatus = "ok" | "error" | "warn" | "info";
export type EventCategory =
  | "auth"
  | "sigma"
  | "simulation"
  | "detection"
  | "report"
  | "build"
  | "lab"
  | "integration"
  | "workspace"
  | "usecase"        // Use Case Builder: usecase.create / .update / .export / .canvas.save / .ai.*
  | "detection-pack" // Detection Pack pipeline: detection-pack.generate.* / .update / .github-push / .job.*
  | "enterprise-uc"  // Enterprise Use Case pipeline: enterprise-uc.upload / .validate / .run / .promote / .comment
  | "bas"            // Adversary-sim BAS fleet: bas.fleet.* / .node.enroll / .node.heartbeat / .campaign.* / .token.*
  | "mcp"            // Detection-content MCP server: mcp.key.mint / .key.revoke / .tools.call / .initialize
  | "system"
  | "other";

export interface LogEventInput {
  category: EventCategory;
  action: string;                    // dotted, eg "auth.login", "sigma.convert"
  actor?: string;                    // userId / email / "system" / "anonymous"
  status?: EventStatus;              // defaults to "ok"
  targetType?: string;
  targetId?: string | null;
  durationMs?: number;
  message?: string;
  details?: Record<string, unknown>;
  errorMessage?: string | null;
  requestId?: string;
}

const LOG_DIR = join(process.cwd(), "logs");
let logDirEnsured = false;

async function ensureLogDir() {
  if (logDirEnsured) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    logDirEnsured = true;
  } catch { /* ignore — file sink will silently skip */ }
}

function todayFile(): string {
  // ISO date in UTC so log rolls cleanly. Format: events-2026-06-05.jsonl
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `events-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.jsonl`;
}

function consoleLine(row: any): string {
  const status =
    row.status === "error" ? "✗" :
    row.status === "warn"  ? "!" :
    row.status === "info"  ? "·" : "✓";
  const dur = row.durationMs ? ` ${row.durationMs}ms` : "";
  const tgt = row.targetId ? ` ${row.targetType || ""}:${String(row.targetId).slice(0, 12)}` : "";
  const msg = row.message ? ` — ${row.message}` : "";
  return `[event ${status}] ${row.category}.${row.action} actor=${row.actor}${tgt}${dur}${msg}`;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  const row = {
    ts: new Date(),
    category: input.category,
    action: input.action,
    actor: input.actor ?? "system",
    status: input.status ?? "ok",
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    durationMs: Math.max(0, Math.floor(input.durationMs ?? 0)),
    message: (input.message ?? "").slice(0, 500),
    details: JSON.stringify(input.details ?? {}),
    errorMessage: input.errorMessage ?? null,
    requestId: input.requestId ?? null,
  };

  // 1. DB write (best-effort)
  prisma.eventLog.create({ data: row as any }).catch(() => { /* swallow */ });

  // 2. JSONL file (best-effort)
  ensureLogDir()
    .then(() => appendFile(
      join(LOG_DIR, todayFile()),
      JSON.stringify({ ...row, ts: row.ts.toISOString() }) + "\n",
      "utf-8",
    ))
    .catch(() => { /* swallow */ });

  // 3. stdout
  try { console.log(consoleLine(row)); } catch { /* swallow */ }
}

/**
 * Time a block of work and log a single event with its duration. Returns
 * whatever the block returns. The block's thrown error (if any) gets
 * recorded on the event before being re-thrown.
 */
export async function withEvent<T>(
  meta: Omit<LogEventInput, "durationMs" | "status">,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await logEvent({ ...meta, status: "ok", durationMs: Date.now() - start });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logEvent({
      ...meta,
      status: "error",
      durationMs: Date.now() - start,
      errorMessage: msg,
    });
    throw err;
  }
}
