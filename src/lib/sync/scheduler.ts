/**
 * Scheduled content-sync scheduler.
 *
 * Reads config/sync-jobs.json and automatically runs each ENABLED job on its
 * schedule (cron or intervalMinutes). Jobs are invoked over loopback against the
 * app's own API, carrying INTERNAL_WORKER_TOKEN (the same internal-cron trust the
 * *-tick routes use) so no external exposure is needed. Run state (last run /
 * status) is persisted to config/.sync-state.json. The self-driving loop
 * (ensureSyncScheduler) is started once at server boot from instrumentation.ts;
 * an external cron can instead drive it via GET/POST /api/sync/tick.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = join(process.cwd(), "config", "sync-jobs.json");
const STATE_PATH = join(process.cwd(), "config", ".sync-state.json");

export interface SyncJob {
  id: string; label?: string; endpoint: string; method?: string;
  enabled?: boolean; cron?: string | null; intervalMinutes?: number | null;
  body?: unknown; timeoutSec?: number;
}
export interface SyncConfig { enabled?: boolean; defaults?: { timeoutSec?: number }; jobs?: SyncJob[] }
interface JobState { lastRunMs?: number; lastStatus?: string; lastHttp?: number; lastError?: string; lastMinuteKey?: string }
type State = Record<string, JobState>;

function loadConfig(): SyncConfig {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return { enabled: false, jobs: [] }; }
}
function loadState(): State { try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return {}; } }
function saveState(s: State): void { try { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch { /* best-effort */ } }

// ── Minimal 5-field cron matcher: "min hour day-of-month month day-of-week".
// Supports *, lists (a,b), ranges (a-b), steps (*/n, a-b/n). Sunday = 0 or 7.
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    let [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!Number.isFinite(step) || step < 1) continue;
    let lo = min, hi = max;
    if (range !== "*") {
      const m = range.split("-");
      lo = parseInt(m[0], 10);
      hi = m.length > 1 ? parseInt(m[1], 10) : lo;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    }
    for (let v = lo; v <= hi; v += step) if (v === value) return true;
  }
  return false;
}
export function cronMatches(expr: string, d: Date): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const dow = d.getDay(); // 0..6 (Sun=0)
  return (
    fieldMatches(f[0], d.getMinutes(), 0, 59) &&
    fieldMatches(f[1], d.getHours(), 0, 23) &&
    fieldMatches(f[2], d.getDate(), 1, 31) &&
    fieldMatches(f[3], d.getMonth() + 1, 1, 12) &&
    (fieldMatches(f[4], dow, 0, 6) || (dow === 0 && fieldMatches(f[4], 7, 0, 7)))
  );
}

function isDue(job: SyncJob, st: JobState, now: Date): boolean {
  if (typeof job.intervalMinutes === "number" && job.intervalMinutes > 0) {
    return !st.lastRunMs || (now.getTime() - st.lastRunMs) >= job.intervalMinutes * 60_000;
  }
  if (job.cron && cronMatches(job.cron, now)) {
    // Fire at most once per matching minute.
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    return st.lastMinuteKey !== key;
  }
  return false;
}

function baseUrl(): string {
  const port = process.env.PORT || "3000";
  return process.env.SYNC_BASE_URL || `http://127.0.0.1:${port}`;
}

async function runJob(job: SyncJob, defTimeout: number): Promise<JobState> {
  const token = process.env.INTERNAL_WORKER_TOKEN || "";
  const timeoutMs = (job.timeoutSec || defTimeout || 900) * 1000;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  const now = Date.now();
  try {
    const res = await fetch(baseUrl() + job.endpoint, {
      method: job.method || "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-worker-token": token } : {}) },
      body: job.method === "GET" ? undefined : JSON.stringify(job.body ?? {}),
      signal: ctrl.signal,
    });
    const ok = res.ok;
    return { lastRunMs: now, lastStatus: ok ? "ok" : "error", lastHttp: res.status, lastError: ok ? undefined : (await res.text().catch(() => "")).slice(0, 300) };
  } catch (e: any) {
    return { lastRunMs: now, lastStatus: "error", lastError: String(e?.message || e).slice(0, 300) };
  } finally { clearTimeout(to); }
}

/** Run every due, enabled job once. Returns what ran. Safe to call on a timer. */
export async function syncTick(): Promise<{ enabled: boolean; ran: Array<{ id: string; status: string; http?: number }>; due: number }> {
  const cfg = loadConfig();
  if (!cfg.enabled) return { enabled: false, ran: [], due: 0 };
  const state = loadState();
  const now = new Date();
  const defTimeout = cfg.defaults?.timeoutSec || 900;
  const due = (cfg.jobs || []).filter((j) => j.enabled && isDue(j, state[j.id] || {}, now));
  const ran: Array<{ id: string; status: string; http?: number }> = [];
  for (const job of due) {
    // mark the minute immediately so a slow job isn't double-fired by the next tick
    state[job.id] = { ...(state[job.id] || {}), lastMinuteKey: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}` };
    saveState(state);
    const result = await runJob(job, defTimeout);
    state[job.id] = { ...state[job.id], ...result };
    saveState(state);
    ran.push({ id: job.id, status: result.lastStatus || "?", http: result.lastHttp });
  }
  return { enabled: true, ran, due: due.length };
}

/** Current config + last-run state, for the status endpoint / UI. */
export function syncStatus() {
  const cfg = loadConfig();
  const state = loadState();
  return {
    enabled: !!cfg.enabled,
    jobs: (cfg.jobs || []).map((j) => ({
      id: j.id, label: j.label, endpoint: j.endpoint, enabled: !!j.enabled,
      schedule: j.cron ? `cron ${j.cron}` : j.intervalMinutes ? `every ${j.intervalMinutes}m` : "unscheduled",
      lastRun: state[j.id]?.lastRunMs ? new Date(state[j.id].lastRunMs!).toISOString() : null,
      lastStatus: state[j.id]?.lastStatus || null, lastHttp: state[j.id]?.lastHttp || null, lastError: state[j.id]?.lastError || null,
    })),
  };
}

let loopStarted = false;
/** Start the self-driving scheduler loop once (checks due jobs each minute). */
export function ensureSyncScheduler(): void {
  if (loopStarted) return;
  loopStarted = true;
  const run = async () => {
    try { await syncTick(); } catch { /* next tick retries */ }
    setTimeout(run, 60_000); // check every minute (cron granularity)
  };
  setTimeout(run, 10_000); // small delay so the server is listening before the first loopback call
}
