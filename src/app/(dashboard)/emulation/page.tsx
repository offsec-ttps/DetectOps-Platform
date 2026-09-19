"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  FlaskConical, Play, CheckCircle, XCircle, Clock, Server, Terminal,
  RefreshCw, Loader2, ChevronDown, ChevronUp, Monitor, Plus,
  AlertTriangle, Zap, Power,
} from "lucide-react";

interface SimulationRecord {
  id: string;
  techniqueIds: string[];
  targetServer: string;
  targetIp: string;
  executor: string;
  status: string;
  logs: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
}

interface SARStatus {
  connected: boolean;
  virtualMachines: { name: string; state: string; provider: string }[];
  splunk: { reachable: boolean; version?: string };
  config: { splunk: { ip: string }; windows: { dcIp: string } };
}

const statusIcon = (s: string) => {
  switch (s) {
    case "success": return <CheckCircle className="h-4 w-4 text-success" />;
    case "failure": return <XCircle className="h-4 w-4 text-danger" />;
    case "running": return <Loader2 className="h-4 w-4 text-accent animate-spin" />;
    case "error": return <AlertTriangle className="h-4 w-4 text-danger" />;
    default: return <Clock className="h-4 w-4 text-muted" />;
  }
};

const statusLabel: Record<string, { text: string; color: string }> = {
  success: { text: "Success", color: "text-success" },
  failure: { text: "Failure", color: "text-danger" },
  running: { text: "Running", color: "text-accent" },
  error: { text: "Error", color: "text-danger" },
};

export default function EmulationPage() {
  const [tab, setTab] = useState<"runs" | "labs">("runs");
  const [runs, setRuns] = useState<SimulationRecord[]>([]);
  const [sar, setSar] = useState<SARStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, sarRes] = await Promise.all([
        fetch("/api/sar/simulations?page_size=20"),
        fetch("/api/sar/status"),
      ]);
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.items || []); }
      if (sarRes.ok) { setSar(await sarRes.json()); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Emulation & Labs</h1>
          <p className="mt-1 text-sm text-muted-foreground">View simulation results and manage lab environments</p>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["runs", "labs"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px", tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground")}>
            {t === "runs" ? "Simulation Runs" : "Lab Environments"}
          </button>
        ))}
      </div>

      {/* Simulation Runs Tab */}
      {tab === "runs" && (
        <div className="space-y-3">
          {loading && runs.length === 0 && (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
          )}
          {!loading && runs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FlaskConical className="h-12 w-12 text-muted mb-4" />
              <h2 className="text-lg font-semibold text-foreground">No Simulation Runs Yet</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-sm">Launch simulations from the Campaign Designer to see results here.</p>
            </div>
          )}
          {runs.map((run) => (
            <div key={run.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                className="flex w-full items-center gap-4 p-4 text-left hover:bg-card-hover transition-colors">
                {statusIcon(run.status)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {run.techniqueIds.map((t) => (
                      <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted">
                    <span className="rounded-full px-2 py-0.5 font-semibold text-[10px] bg-accent/15 text-accent">{run.executor.toUpperCase()}</span>
                    <span>{run.targetServer.replace("attack-range-", "")}</span>
                    <span>{new Date(run.startedAt).toLocaleString()}</span>
                    <span>{run.durationMs > 0 ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</span>
                  </div>
                </div>
                <span className={cn("text-xs font-medium", statusLabel[run.status]?.color || "text-muted")}>{statusLabel[run.status]?.text || run.status}</span>
                {expanded === run.id ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
              </button>
              {expanded === run.id && (
                <div className="border-t border-border bg-background overflow-hidden">
                  <div className="p-3 text-[10px] font-mono leading-relaxed whitespace-pre-wrap max-h-[250px] overflow-auto bg-[#0d1117]">
                    {(run.logs || "No output captured").split("\n").map((line, i) => (
                      <div key={i} className={cn(
                        line.includes("successfully") || line.includes("PASSED") ? "text-green-400" :
                        line.includes("FAILED") || line.includes("ERROR") ? "text-red-400" :
                        line.includes("WARNING") ? "text-yellow-400" :
                        line.includes("INFO") ? "text-blue-400" :
                        line.startsWith("$") ? "text-cyan-400" :
                        "text-gray-400"
                      )}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lab Environments Tab */}
      {tab === "labs" && (
        <div className="space-y-4">
          {loading && !sar && (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
          )}
          {sar && (
            <div className="space-y-4">
              {/* SAR Lab */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">Splunk Attack Range — Local</h3>
                  <span className={cn("flex items-center gap-1.5 text-xs font-medium", sar.connected ? "text-success" : "text-warning")}>
                    <span className={cn("h-2 w-2 rounded-full", sar.connected ? "bg-success animate-pulse" : "bg-warning")} />
                    {sar.connected ? "Online" : "Offline"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", sar.connected ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30")}>
                    {sar.connected ? "Live" : "Stopped"}
                  </span>
                  <span className="text-xs text-muted">VirtualBox (Vagrant)</span>
                  {sar.splunk?.version && <span className="text-xs text-muted">Splunk {sar.splunk.version}</span>}
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted">VMs</span><span className="text-muted-foreground font-medium">{sar.virtualMachines?.length || 0} configured</span></div>
                  {sar.virtualMachines?.map((vm) => (
                    <div key={vm.name} className="flex justify-between pl-4">
                      <span className="text-muted">{vm.name.replace("attack-range-", "")}</span>
                      <span className={cn("font-medium", vm.state === "running" ? "text-success" : "text-muted")}>{vm.state}</span>
                    </div>
                  ))}
                  <div className="flex justify-between"><span className="text-muted">Splunk IP</span><span className="text-muted-foreground font-medium">{sar.config?.splunk?.ip || "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Windows DC IP</span><span className="text-muted-foreground font-medium">{sar.config?.windows?.dcIp || "—"}</span></div>
                </div>
              </div>

              {/* GOAD Lab */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">GOAD Active Directory — MINILAB</h3>
                  <span className="text-[10px] text-muted">mini.lab domain</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-accent/15 text-accent border-accent/30">AD Lab</span>
                  <span className="text-xs text-muted">VirtualBox | Splunk UF installed</span>
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted">Domain Controller</span><span className="text-muted-foreground font-medium">DC01 — 10.0.1.30 (Win Server 2019)</span></div>
                  <div className="flex justify-between"><span className="text-muted">Workstation</span><span className="text-muted-foreground font-medium">WS01 — 10.0.1.31 (Windows 10)</span></div>
                  <div className="flex justify-between"><span className="text-muted">Domain</span><span className="text-muted-foreground font-medium">mini.lab (MINILAB)</span></div>
                  <div className="flex justify-between"><span className="text-muted">Log Forwarding</span><span className="text-muted-foreground font-medium">Splunk UF → 10.0.1.12:9997</span></div>
                  <div className="flex justify-between"><span className="text-muted">Monitoring</span><span className="text-muted-foreground font-medium">Sysmon + PowerShell + AD logs</span></div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 text-[10px] text-muted-foreground">
                  <span className="font-medium text-muted">Simulation targets:</span> Kerberoasting, AS-REP Roasting, DCSync, CredSSP relay, Pass-the-Hash, NTLM relay, Golden Ticket
                </div>
              </div>

              {/* Simulation Chain Overview */}
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
                <h4 className="text-xs font-semibold text-foreground mb-3">Simulation Chain (Step 1 → Step 4)</h4>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { step: 1, label: "Select Technique", desc: "Choose ATT&CK technique from library", icon: "🎯" },
                    { step: 2, label: "Execute on Target", desc: "Run on GOAD DC01/WS01 or SAR DC", icon: "⚡" },
                    { step: 3, label: "Validate Detection", desc: "Search Splunk for matching alerts", icon: "🔍" },
                    { step: 4, label: "Generate Report", desc: "Create LOCK pattern report + PR", icon: "📄" },
                  ].map((s) => (
                    <div key={s.step} className="rounded-lg border border-border/50 bg-card p-3 text-center">
                      <span className="text-lg">{s.icon}</span>
                      <p className="text-[10px] font-semibold text-foreground mt-1">Step {s.step}: {s.label}</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <a href="/campaign-designer" className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90">
                  <Zap className="h-3 w-3" /> Run Simulation
                </a>
                <a href="/environment-manager" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover text-center">
                  Environment Manager
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
