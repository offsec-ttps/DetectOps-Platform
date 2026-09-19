"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Activity, Loader2, RefreshCw, Play, Inbox, AlertTriangle, CheckCircle2,
  Clock, RotateCw, Gauge, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  sourceType: string;
  sourceTable: string;
  sourceRefId: string;
  status: string;
  attempts: number;
  costEstimateUsd: number;
  packId: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface StatusBucket { status: string; count: number }
interface Budget {
  budget: number;
  perJobEstimate: number;
  usedTokens: number;
  remainingTokens: number | null;
  exhausted: boolean;
  costUsd: number;
  generationCount: number;
  resetsAt: string;
}

interface QueueResponse {
  items: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  byStatus: StatusBucket[];
  budget: Budget;
}

const STATUS_COLORS: Record<string, string> = {
  queued:            "bg-info/15 text-info border-info/40",
  running:           "bg-purple/15 text-purple border-purple/40",
  completed:         "bg-success/15 text-success border-success/40",
  failed:            "bg-danger/15 text-danger border-danger/40",
  "budget-exceeded": "bg-warning/15 text-warning border-warning/40",
  skipped:           "bg-muted/15 text-muted-foreground border-border",
};

const FILTERS = ["", "queued", "running", "completed", "failed", "budget-exceeded"] as const;

export default function DetectionPackQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [auto, setAuto] = useState(true);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (statusFilter) sp.set("status", statusFilter);
      const res = await fetch(`/api/detection-packs/jobs?${sp.toString()}&pageSize=80`);
      setData(await res.json());
    } catch { /* keep last state */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchQueue(); }, [statusFilter]);    // eslint-disable-line
  useEffect(() => {
    if (!auto) return;
    // Page-driven tick: fires the worker every 30 s while an admin keeps the
    // queue page open. Production deployments should run an external cron
    // hitting POST /api/detection-packs/jobs/tick so the queue progresses
    // without the UI being open.
    const fetchInterval = setInterval(fetchQueue, 5_000);
    const tickInterval = setInterval(() => {
      fetch("/api/detection-packs/jobs/tick", {
        method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
      }).catch(() => { /* offline / 500; next tick retries */ });
    }, 30_000);
    return () => { clearInterval(fetchInterval); clearInterval(tickInterval); };
  }, [auto, statusFilter]);                              // eslint-disable-line

  const tickNow = async () => {
    setTicking(true);
    try {
      await fetch("/api/detection-packs/jobs/tick", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      await fetchQueue();
    } finally { setTicking(false); }
  };
  const tickAndBackstop = async () => {
    setTicking(true);
    try {
      await fetch("/api/detection-packs/jobs/tick?backstop=1", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      await fetchQueue();
    } finally { setTicking(false); }
  };
  const retry = async (id: string, force = false) => {
    setRetrying(id);
    try {
      const sp = force ? "?force=1" : "";
      await fetch(`/api/detection-packs/jobs/${id}/retry${sp}`, { method: "POST" });
      await fetchQueue();
    } finally { setRetrying(null); }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/detections/packs" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Detection Packs
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-accent" />
            Auto-pipeline Queue
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Detection Pack generation jobs enqueued automatically on threat-intel + community-rule ingest. The worker ticks every 30 s; backstop sweeps every 5 min.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-accent" />
            auto-refresh
          </label>
          <button onClick={fetchQueue} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> refresh
          </button>
          <button
            onClick={tickNow}
            disabled={ticking}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
          >
            {ticking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Tick now
          </button>
          <button
            onClick={tickAndBackstop}
            disabled={ticking}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-border text-foreground hover:bg-card-hover"
            title="Tick + run backstop sweep for missed rows"
          >
            <RotateCw className="h-3 w-3" />
            + backstop
          </button>
        </div>
      </div>

      {/* Budget snapshot */}
      {data?.budget && (
        <div className={cn(
          "rounded-xl border p-4",
          data.budget.exhausted ? "border-warning/40 bg-warning/5" : "border-border bg-card",
        )}>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Gauge className={cn("h-4 w-4", data.budget.exhausted ? "text-warning" : "text-accent")} />
            <span className="font-semibold text-foreground">Daily token budget</span>
            <span className="font-mono text-foreground">
              {data.budget.usedTokens.toLocaleString()} /{" "}
              {data.budget.budget === 0 ? "∞ (disabled)" : data.budget.budget.toLocaleString()}
            </span>
            {data.budget.budget > 0 && (
              <span className="font-mono text-muted-foreground">
                ({data.budget.remainingTokens?.toLocaleString() ?? 0} remaining · reset {new Date(data.budget.resetsAt).toLocaleString()})
              </span>
            )}
            <span className="ml-auto font-mono text-muted-foreground">
              {data.budget.generationCount} LLM call{data.budget.generationCount !== 1 ? "s" : ""} · ${data.budget.costUsd.toFixed(4)}
            </span>
          </div>
          {data.budget.budget > 0 && (
            <div className="mt-2 h-1.5 rounded-full bg-background overflow-hidden">
              <div
                className={cn("h-full transition-all", data.budget.exhausted ? "bg-warning" : "bg-accent")}
                style={{ width: `${Math.min(100, Math.round((data.budget.usedTokens / data.budget.budget) * 100))}%` }}
              />
            </div>
          )}
          {data.budget.exhausted && (
            <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3" />
              Budget exhausted — new jobs will be marked <code className="font-mono">budget-exceeded</code> until {new Date(data.budget.resetsAt).toLocaleString()}.
            </div>
          )}
        </div>
      )}

      {/* Status counters */}
      {data?.byStatus && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const count = data.byStatus.find((b) => b.status === f)?.count ?? 0;
            const active = statusFilter === f;
            return (
              <button
                key={f || "all"}
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors",
                  active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{f || "all"}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f ? count : data.total}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Job table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No jobs in this view. The pipeline enqueues automatically on TI / community-rule ingest.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.items.map((j) => {
              const duration = j.completedAt && j.startedAt
                ? Math.max(0, new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime())
                : null;
              return (
                <div key={j.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", STATUS_COLORS[j.status] || STATUS_COLORS.queued)}>
                      {j.status}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">{j.sourceType}</span>
                    <span className="font-mono text-[10px] text-foreground">{j.sourceTable}</span>
                    <span className="font-mono text-[10px] text-accent truncate max-w-[180px]" title={j.sourceRefId}>{j.sourceRefId}</span>
                    {j.attempts > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">try {j.attempts}/3</span>
                    )}
                    {j.costEstimateUsd > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">${j.costEstimateUsd.toFixed(4)}</span>
                    )}
                    {duration !== null && (
                      <span className="font-mono text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" /> {(duration / 1000).toFixed(1)}s
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {new Date(j.createdAt).toLocaleString()}
                    </span>
                    {j.packId && (
                      <Link
                        href={`/detections/packs/${j.packId}`}
                        className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline"
                      >
                        pack <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    )}
                    {(j.status === "failed" || j.status === "budget-exceeded") && (
                      <button
                        onClick={() => retry(j.id, j.status === "budget-exceeded")}
                        disabled={retrying === j.id}
                        className="inline-flex items-center gap-0.5 text-[10px] text-info hover:underline disabled:opacity-50"
                      >
                        {retrying === j.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCw className="h-2.5 w-2.5" />}
                        retry
                      </button>
                    )}
                  </div>
                  {j.errorMessage && (
                    <div className="mt-1 text-[10px] text-danger font-mono line-clamp-2 ml-1">
                      {j.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground space-y-1">
        <p>
          Manual generation from the TI / rule pages bypasses this queue. The auto-pipeline enqueues every newly-ingested TI report and community rule (dedup'd by source ref id).
        </p>
        <p>
          <strong>Auto-refresh ON</strong> on this page ticks the worker every 30&nbsp;s. For unattended progression, point an external cron at{" "}
          <code className="font-mono">POST /api/detection-packs/jobs/tick</code>.
          Budget configurable via <code className="font-mono">DETECTION_PACK_DAILY_TOKEN_BUDGET</code> (default 500&nbsp;000 tok/day).
        </p>
      </div>
    </div>
  );
}
