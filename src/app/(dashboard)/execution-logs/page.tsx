"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ScrollText, Search, Filter, RefreshCw, CheckCircle2, XCircle,
  Loader2, Clock, Shield, Terminal, Activity,
  ChevronDown, ChevronRight, Copy, Check,
} from "lucide-react";

type ExecStatus = "success" | "failure" | "running" | "queued" | "error";

interface SimulationRecord {
  id: string;
  techniqueIds: string[];
  targetServer: string;
  targetIp: string;
  executor: string;
  parameters: Record<string, string>;
  status: string;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  success: { label: "Success", color: "text-success bg-success/10 border-success/30", icon: CheckCircle2 },
  failure: { label: "Failed", color: "text-danger bg-danger/10 border-danger/30", icon: XCircle },
  running: { label: "Running", color: "text-accent bg-accent/10 border-accent/30", icon: Loader2 },
  queued: { label: "Queued", color: "text-muted bg-muted/10 border-border", icon: Clock },
  error: { label: "Error", color: "text-danger bg-danger/10 border-danger/30", icon: XCircle },
};

export default function ExecutionLogsPage() {
  const [logs, setLogs] = useState<SimulationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page_size: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/sar/simulations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.items || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const filtered = logs.filter((l) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!l.techniqueIds.some((t) => t.toLowerCase().includes(q)) &&
          !l.targetServer.toLowerCase().includes(q) &&
          !l.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const successCount = logs.filter((l) => l.status === "success").length;
  const failCount = logs.filter((l) => l.status === "failure" || l.status === "error").length;
  const runningCount = logs.filter((l) => l.status === "running").length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Execution Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulation execution history with live status updates and log output
          </p>
        </div>
        <button onClick={fetchLogs} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors disabled:opacity-50">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Executions", value: String(logs.length), color: "text-foreground" },
          { label: "Successful", value: String(successCount), color: "text-success" },
          { label: "Failed", value: String(failCount), color: "text-danger" },
          { label: "Running", value: String(runningCount), color: "text-accent" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
            <p className={cn("text-xl font-bold mt-0.5", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text" placeholder="Search by technique ID, target server, or run ID…"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
            <option value="all">All Statuses</option>
            <option value="success">Success</option>
            <option value="failure">Failed</option>
            <option value="running">Running</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      <p className="text-sm text-muted">{filtered.length} executions</p>

      {/* Empty state */}
      {!loading && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ScrollText className="h-12 w-12 text-muted mb-4" />
          <h2 className="text-lg font-semibold text-foreground">No Execution Logs Yet</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            Run simulations from the Campaign Designer to see execution logs here.
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && logs.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      )}

      {/* Log stream */}
      <div className="space-y-2">
        {filtered.map((log) => {
          const st = statusConfig[log.status] || statusConfig.error;
          const StIcon = st.icon;
          const isExpanded = expandedLog === log.id;

          return (
            <div key={log.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                className="flex w-full items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                  <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", st.color)}>
                    <StIcon className={cn("h-2.5 w-2.5", log.status === "running" ? "animate-spin" : "")} />
                    {st.label}
                  </span>
                  {log.techniqueIds.map((t) => (
                    <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                  ))}
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">{log.targetServer.replace("attack-range-", "")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold bg-accent/10 text-accent">{log.executor.toUpperCase()}</span>
                  <span className="text-[10px] text-muted w-16 text-right">{log.durationMs > 0 ? `${(log.durationMs / 1000).toFixed(1)}s` : "—"}</span>
                  <span className="text-[10px] text-muted w-36 text-right">{new Date(log.startedAt).toLocaleString()}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4 space-y-3">
                  {/* Run ID */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-semibold text-muted uppercase">Run ID</span>
                    <code className="text-xs font-mono text-foreground bg-card-hover rounded px-2 py-0.5">{log.id}</code>
                    <button onClick={() => handleCopyId(log.id)} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                      {copiedId === log.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      {copiedId === log.id ? "Copied" : "Copy ID"}
                    </button>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div><span className="text-[10px] text-muted uppercase block">Target</span><span className="text-foreground font-medium">{log.targetServer.replace("attack-range-", "")}</span></div>
                    <div><span className="text-[10px] text-muted uppercase block">Target IP</span><span className="text-foreground font-medium">{log.targetIp}</span></div>
                    <div><span className="text-[10px] text-muted uppercase block">Executor</span><span className="text-foreground font-medium">{log.executor}</span></div>
                    <div><span className="text-[10px] text-muted uppercase block">Duration</span><span className="text-foreground font-medium">{log.durationMs > 0 ? `${(log.durationMs / 1000).toFixed(1)}s` : "In progress"}</span></div>
                  </div>

                  {/* Error */}
                  {log.errorMessage && (
                    <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{log.errorMessage}</div>
                  )}

                  {/* Logs */}
                  <div className="rounded-lg border border-border bg-background overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card-hover">
                      <Terminal className="h-3 w-3 text-muted" />
                      <span className="text-[10px] font-semibold text-muted uppercase">Output</span>
                    </div>
                    <div className="p-3 text-[10px] font-mono leading-relaxed whitespace-pre-wrap max-h-[250px] overflow-auto bg-[#0d1117]">
                      {(log.logs || "No output captured").split("\n").map((line, i) => (
                        <div key={i} className={cn(
                          line.includes("successfully") || line.includes("PASSED") || line.includes("[success]") ? "text-green-400" :
                          line.includes("FAILED") || line.includes("ERROR") || line.includes("[error]") || line.includes("[failure]") ? "text-red-400" :
                          line.includes("WARNING") || line.includes("[stderr]") ? "text-yellow-400" :
                          line.includes("INFO") || line.includes("[info]") ? "text-blue-400" :
                          line.startsWith("$") ? "text-cyan-400" :
                          "text-gray-400"
                        )}>{line}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live indicator */}
      {logs.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted">
          <Activity className="h-3 w-3 text-success animate-pulse" />
          <span>Auto-refreshes every 10 seconds</span>
        </div>
      )}
    </div>
  );
}
