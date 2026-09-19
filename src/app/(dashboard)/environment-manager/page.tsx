"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Server, Plus, Power, Trash2, RefreshCw, Terminal, Activity,
  Cloud, Monitor, Clock, CheckCircle2, XCircle, Loader2,
  Settings2, Shield, ChevronDown, ChevronRight, Globe, Cpu,
  Wifi, WifiOff, Database, HardDrive, Eye, EyeOff, Copy,
  ScrollText, AlertTriangle, Layers, ExternalLink,
  Play, Square, PowerOff,
} from "lucide-react";
import GOADPanel from "./goad-panel";

// ── Types for SAR API response ──

interface SARStatus {
  connected: boolean;
  probeTimeMs: number;
  installPath: string;
  config: {
    error?: string;
    splunk: { ip: string; adminPassword: string; version: string; binaryUrl: string };
    windows: { dcIp: string; username: string; password: string; sysmonTemplate: string; timezone: string };
    simulation: { defaultTechnique: string; artRepository: string; artBranch: string };
    caldera: { password: string; ip: string };
    enabledMachines: Record<string, boolean>;
  };
  virtualMachines: { name: string; state: string; provider: string }[];
  network: {
    splunkServer: { ip: string; pingReachable: boolean; restApiPort: number; webUiPort: number; webUiUrl: string; restApiUrl: string };
    windowsDC: { ip: string; pingReachable: boolean; winrmPort: number; rdpPort: number };
  };
  splunk: {
    reachable: boolean;
    serverName?: string;
    version?: string;
    build?: string;
    os?: string;
    cpuArch?: string;
    cores?: number;
    memoryMB?: number;
    licenseGroup?: string;
    licenseState?: string;
    guid?: string;
    indexes?: { name: string; eventCount: number; sizeMB: number }[];
    apps?: { name: string; label: string; version: string; enabled: boolean }[];
    error?: string;
  };
  recentLogs: string[];
}

// ── Copied field for credentials ──

function CopyField({ value, masked = false }: { value: string; masked?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const display = masked && !show ? "••••••••••••" : value;

  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="text-xs font-mono text-foreground bg-background/50 rounded px-1.5 py-0.5">{display}</code>
      {masked && (
        <button onClick={() => setShow(!show)} className="text-muted hover:text-foreground transition-colors">
          {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
      )}
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-muted hover:text-foreground transition-colors"
      >
        {copied ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

// ── Main page ──

export default function EnvironmentManagerPage() {
  const [activeTab, setActiveTab] = useState<"local" | "goad" | "templates">("local");
  const [sar, setSar] = useState<SARStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVm, setExpandedVm] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showApps, setShowApps] = useState(false);

  // SAR/GOAD control state
  const [sarOp, setSarOp] = useState<{ action: string; status: string; logs: string[] } | null>(null);
  const [sarOpLoading, setSarOpLoading] = useState(false);
  const [goadOpLoading, setGoadOpLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sar/status");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data: SARStatus = await res.json();
      setSar(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Poll SAR operation status
  useEffect(() => {
    if (!sarOp || sarOp.status !== "running") return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch("/api/sar/start");
        if (res.ok) {
          const data = await res.json();
          setSarOp(data.status === "idle" ? null : data);
          if (data.status !== "running") { clearInterval(iv); fetchStatus(); }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [sarOp?.status, fetchStatus]);

  const handleSarAction = async (action: "resume" | "stop") => {
    setSarOpLoading(true);
    try {
      const res = await fetch("/api/sar/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setSarOp({ action, status: "running", logs: [`SAR ${action} initiated...`] });
      }
    } catch {}
    setSarOpLoading(false);
  };

  const handleGoadAction = async (action: "start" | "stop") => {
    setGoadOpLoading(true);
    try {
      const endpoint = action === "start" ? "/api/goad/start" : "/api/goad/stop";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lab: "MINILAB" }),
      });
      if (res.ok) {
        setTimeout(fetchStatus, 5000);
      }
    } catch {}
    setGoadOpLoading(false);
  };

  const connected = sar?.connected ?? false;
  const splunkLive = sar?.splunk?.reachable ?? false;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Environment Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect, monitor, and manage Splunk Attack Range + GOAD lab environments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            {loading ? "Probing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Lab Control Panel ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* SAR Controls */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-foreground">Splunk Attack Range</span>
              <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full border",
                connected ? "bg-success/10 text-success border-success/30" : "bg-danger/10 text-danger border-danger/30"
              )}>{connected ? "Online" : "Offline"}</span>
            </div>
            {connected && sar?.network.splunkServer.webUiUrl && (
              <a href={sar.network.splunkServer.webUiUrl} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-accent hover:underline flex items-center gap-1">
                <ExternalLink className="h-3 w-3" /> Splunk Web
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => handleSarAction("resume")}
              disabled={sarOpLoading || sarOp?.status === "running" || connected}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-success/10 border border-success/30 px-3 py-2 text-xs font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-40"
            >
              {sarOpLoading && sarOp?.action === "resume" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Resume SAR
            </button>
            <button
              onClick={() => handleSarAction("stop")}
              disabled={sarOpLoading || sarOp?.status === "running" || !connected}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-40"
            >
              {sarOpLoading && sarOp?.action === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
              Stop SAR
            </button>
          </div>
          {connected && (
            <p className="text-[10px] text-muted-foreground">
              Splunk {sar?.splunk.version} | {sar?.virtualMachines.filter((v) => v.state === "running").length}/{sar?.virtualMachines.length} VMs | {sar?.network.splunkServer.ip}
            </p>
          )}
          {!connected && !sarOp && (
            <p className="text-[10px] text-muted-foreground">{error || "SAR is not running. Click Resume to start."}</p>
          )}
        </div>

        {/* GOAD Controls */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-foreground">GOAD Active Directory</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => handleGoadAction("start")}
              disabled={goadOpLoading}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-success/10 border border-success/30 px-3 py-2 text-xs font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-40"
            >
              {goadOpLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Start GOAD
            </button>
            <button
              onClick={() => handleGoadAction("stop")}
              disabled={goadOpLoading}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-40"
            >
              {goadOpLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
              Stop GOAD
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">MINILAB (mini.lab) | DC01: 10.0.1.30 | WS01: 10.0.1.31</p>
        </div>
      </div>

      {/* SAR Operation Log (shown while running) */}
      {sarOp && sarOp.status === "running" && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            <span className="text-xs font-medium text-accent">SAR {sarOp.action} in progress...</span>
          </div>
          <div className="rounded-lg bg-background border border-border p-2 max-h-32 overflow-y-auto">
            {sarOp.logs.map((log, i) => (
              <p key={i} className="text-[10px] font-mono text-muted-foreground">{log}</p>
            ))}
          </div>
        </div>
      )}

      {/* Connection status banner */}
      {!loading && (
        <div className={cn(
          "rounded-xl border p-4 flex items-center justify-between",
          connected
            ? "border-success/30 bg-success/5"
            : "border-danger/30 bg-danger/5"
        )}>
          <div className="flex items-center gap-3">
            {connected ? (
              <Wifi className="h-6 w-6 text-success" />
            ) : (
              <WifiOff className="h-6 w-6 text-danger" />
            )}
            <div>
              <p className={cn("text-sm font-semibold", connected ? "text-success" : "text-danger")}>
                {connected ? "Connected to Local Attack Range" : "Not Connected"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {connected
                  ? `Probe completed in ${sar?.probeTimeMs}ms — ${sar?.virtualMachines.length} VMs detected, Splunk ${sar?.splunk.version} responding`
                  : error || "Could not reach the local SAR installation"}
              </p>
            </div>
          </div>
          {connected && sar?.network.splunkServer.webUiUrl && (
            <a
              href={sar.network.splunkServer.webUiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-success/10 border border-success/30 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> Open Splunk Web
            </a>
          )}
        </div>
      )}

      {/* Stats row */}
      {sar && (
        <div className="grid grid-cols-5 gap-4">
          {[
            {
              label: "VMs Running",
              value: String(sar.virtualMachines.filter((v) => v.state === "running").length),
              sub: `of ${sar.virtualMachines.length} total`,
              color: "text-success",
            },
            {
              label: "Splunk REST API",
              value: splunkLive ? "Online" : "Offline",
              sub: splunkLive ? `v${sar.splunk.version}` : sar.splunk.error?.slice(0, 30) || "",
              color: splunkLive ? "text-success" : "text-danger",
            },
            {
              label: "Indexes",
              value: String(sar.splunk.indexes?.length ?? 0),
              sub: `${(sar.splunk.indexes ?? []).reduce((s, i) => s + i.eventCount, 0).toLocaleString()} events`,
              color: "text-accent",
            },
            {
              label: "Splunk Apps",
              value: String(sar.splunk.apps?.filter((a) => a.enabled).length ?? 0),
              sub: "installed & enabled",
              color: "text-foreground",
            },
            {
              label: "Windows DC",
              value: sar.network.windowsDC.pingReachable ? "Reachable" : "Unreachable",
              sub: sar.network.windowsDC.ip,
              color: sar.network.windowsDC.pingReachable ? "text-success" : "text-danger",
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
              <p className={cn("text-xl font-bold mt-1", s.color)}>{s.value}</p>
              <p className="text-[10px] text-muted mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "local" as const, label: "Splunk Attack Range" },
          { key: "goad" as const, label: "GOAD Active Directory" },
          { key: "templates" as const, label: "Configuration" },
        ]).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Local Attack Range ── */}
      {activeTab === "local" && sar && (
        <div className="space-y-5">

          {/* Virtual Machines */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" /> Virtual Machines
            </h2>
            <div className="space-y-2">
              {sar.virtualMachines.map((vm) => {
                const isRunning = vm.state === "running";
                const isSplunk = vm.name.includes("splunk");
                const isDC = vm.name.includes("domain-controller");
                const ip = isSplunk ? sar.network.splunkServer.ip : isDC ? sar.network.windowsDC.ip : "—";
                const pingOk = isSplunk ? sar.network.splunkServer.pingReachable : isDC ? sar.network.windowsDC.pingReachable : false;
                const isExpanded = expandedVm === vm.name;

                return (
                  <div key={vm.name} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button
                      onClick={() => setExpandedVm(isExpanded ? null : vm.name)}
                      className="flex w-full items-center justify-between px-5 py-3.5 hover:bg-card-hover transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                        <div className="rounded-lg p-2 bg-card-hover">
                          {isSplunk ? <Database className="h-5 w-5 text-accent" /> : <Monitor className="h-5 w-5 text-accent" />}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-semibold text-foreground">{vm.name}</p>
                          <p className="text-[10px] text-muted">{vm.provider} · {ip}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {pingOk && (
                          <span className="text-[10px] text-success flex items-center gap-1">
                            <Wifi className="h-3 w-3" /> reachable
                          </span>
                        )}
                        <span className={cn(
                          "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                          isRunning ? "text-success bg-success/10 border-success/30" : "text-danger bg-danger/10 border-danger/30"
                        )}>
                          {isRunning ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {vm.state}
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border px-5 py-4 space-y-3">
                        {isSplunk && splunkLive && (
                          <div className="grid grid-cols-4 gap-4">
                            {[
                              { label: "Server Name", value: sar.splunk.serverName || "—" },
                              { label: "Version", value: `${sar.splunk.version} (build ${sar.splunk.build})` },
                              { label: "OS", value: sar.splunk.os || "—" },
                              { label: "Architecture", value: sar.splunk.cpuArch || "—" },
                              { label: "CPU Cores", value: String(sar.splunk.cores ?? "—") },
                              { label: "Memory", value: sar.splunk.memoryMB ? `${sar.splunk.memoryMB} MB` : "—" },
                              { label: "License", value: `${sar.splunk.licenseGroup} (${sar.splunk.licenseState})` },
                              { label: "GUID", value: sar.splunk.guid?.slice(0, 16) + "…" || "—" },
                            ].map((d) => (
                              <div key={d.label}>
                                <p className="text-[10px] font-semibold text-muted uppercase">{d.label}</p>
                                <p className="text-xs text-foreground mt-0.5 font-mono">{d.value}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {isDC && (
                          <div className="grid grid-cols-4 gap-4">
                            {[
                              { label: "IP Address", value: sar.network.windowsDC.ip },
                              { label: "WinRM Port", value: String(sar.network.windowsDC.winrmPort) },
                              { label: "RDP Port", value: String(sar.network.windowsDC.rdpPort) },
                              { label: "Ping", value: sar.network.windowsDC.pingReachable ? "OK" : "Unreachable" },
                            ].map((d) => (
                              <div key={d.label}>
                                <p className="text-[10px] font-semibold text-muted uppercase">{d.label}</p>
                                <p className="text-xs text-foreground mt-0.5 font-mono">{d.value}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-[10px] text-muted">
                          <span>Ports: {isSplunk ? "8000 (Web), 8089 (REST), 8088 (HEC), 9997 (Fwd)" : "5985 (WinRM), 3389 (RDP)"}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Network Connectivity */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Wifi className="h-4 w-4 text-accent" /> Network Endpoints
            </h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-card-hover">
                    {["Service", "IP Address", "Port", "Protocol", "Status", "URL"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { service: "Splunk Web UI", ip: sar.network.splunkServer.ip, port: "8000", proto: "HTTP", ok: splunkLive, url: sar.network.splunkServer.webUiUrl },
                    { service: "Splunk REST API", ip: sar.network.splunkServer.ip, port: "8089", proto: "HTTPS", ok: splunkLive, url: sar.network.splunkServer.restApiUrl },
                    { service: "Splunk HEC", ip: sar.network.splunkServer.ip, port: "8088", proto: "HTTPS", ok: splunkLive, url: `https://${sar.network.splunkServer.ip}:8088` },
                    { service: "Splunk Forwarder", ip: sar.network.splunkServer.ip, port: "9997", proto: "TCP", ok: sar.network.splunkServer.pingReachable, url: "—" },
                    { service: "Windows WinRM", ip: sar.network.windowsDC.ip, port: "5985", proto: "HTTP", ok: sar.network.windowsDC.pingReachable, url: `http://${sar.network.windowsDC.ip}:5985` },
                    { service: "Windows RDP", ip: sar.network.windowsDC.ip, port: "3389", proto: "TCP", ok: sar.network.windowsDC.pingReachable, url: "—" },
                  ].map((row) => (
                    <tr key={row.service} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 text-xs font-medium text-foreground">{row.service}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{row.ip}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{row.port}</td>
                      <td className="px-4 py-2.5 text-[10px] text-muted">{row.proto}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("flex items-center gap-1 text-[10px] font-semibold", row.ok ? "text-success" : "text-danger")}>
                          {row.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {row.ok ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {row.url !== "—" ? (
                          <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline font-mono">{row.url}</a>
                        ) : (
                          <span className="text-[10px] text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Splunk Indexes */}
          {sar.splunk.indexes && sar.splunk.indexes.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Database className="h-4 w-4 text-accent" /> Splunk Indexes
              </h2>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-card-hover">
                      {["Index Name", "Event Count", "Size (MB)", "Status"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sar.splunk.indexes.map((idx) => (
                      <tr key={idx.name} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-mono font-medium text-accent">{idx.name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-foreground font-semibold">{idx.eventCount.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{idx.sizeMB}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-[10px] font-semibold", idx.eventCount > 0 ? "text-success" : "text-muted")}>
                            {idx.eventCount > 0 ? "Active" : "Empty"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Splunk Apps (collapsible) */}
          {sar.splunk.apps && sar.splunk.apps.length > 0 && (
            <div>
              <button
                onClick={() => setShowApps(!showApps)}
                className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2 hover:text-accent transition-colors"
              >
                {showApps ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Layers className="h-4 w-4 text-accent" />
                Installed Apps ({sar.splunk.apps.filter((a) => a.enabled).length} enabled)
              </button>
              {showApps && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-card-hover">
                        {["App ID", "Label", "Version", "Status"].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sar.splunk.apps.map((app) => (
                        <tr key={app.name} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                          <td className="px-4 py-2 text-[10px] font-mono text-muted-foreground">{app.name}</td>
                          <td className="px-4 py-2 text-xs font-medium text-foreground">{app.label}</td>
                          <td className="px-4 py-2 text-[10px] text-muted-foreground">{app.version}</td>
                          <td className="px-4 py-2">
                            <span className={cn("text-[10px] font-semibold", app.enabled ? "text-success" : "text-muted")}>
                              {app.enabled ? "enabled" : "disabled"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Recent Logs (collapsible) */}
          {sar.recentLogs.length > 0 && (
            <div>
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2 hover:text-accent transition-colors"
              >
                {showLogs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <ScrollText className="h-4 w-4 text-accent" />
                Recent Logs ({sar.recentLogs.length} entries)
              </button>
              {showLogs && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="bg-[#0d1117] p-4 font-mono text-[11px] leading-5 overflow-x-auto max-h-[300px] overflow-y-auto">
                    {sar.recentLogs.map((line, i) => {
                      const isError = line.includes("ERROR");
                      const isSuccess = line.includes("successfully");
                      return (
                        <div key={i} className={cn(
                          isError ? "text-danger" : isSuccess ? "text-success" : "text-muted-foreground"
                        )}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {loading && !sar && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-8 w-8 text-accent animate-spin mb-4" />
          <p className="text-sm text-muted-foreground">Probing local Attack Range installation…</p>
          <p className="text-[10px] text-muted mt-1">Checking VMs, Splunk API, network connectivity</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && !sar && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground">Failed to probe Attack Range</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <button onClick={fetchStatus} className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* ── Tab: GOAD Active Directory ── */}
      {activeTab === "goad" && (
        <GOADPanel />
      )}

      {/* ── Tab: Configuration ── */}
      {activeTab === "templates" && sar && (
        <div className="space-y-5">
          {/* Credentials */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" /> Credentials
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Splunk Admin User", value: "admin" },
                { label: "Splunk Admin Password", value: sar.config.splunk.adminPassword, masked: true },
                { label: "Windows User", value: sar.config.windows.username },
                { label: "Windows Password", value: sar.config.windows.password, masked: true },
                { label: "CALDERA Password", value: sar.config.caldera.password, masked: true },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                  <CopyField value={c.value} masked={c.masked} />
                </div>
              ))}
            </div>
          </div>

          {/* Network Map */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Globe className="h-4 w-4 text-accent" /> Network Configuration
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Splunk Server IP", value: sar.config.splunk.ip },
                { label: "Windows DC IP", value: sar.config.windows.dcIp },
                { label: "CALDERA Server IP", value: sar.config.caldera.ip },
                { label: "Network Subnet", value: "10.0.1.0/24" },
                { label: "Sysmon Template", value: sar.config.windows.sysmonTemplate },
                { label: "Windows Timezone", value: sar.config.windows.timezone },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                  <CopyField value={c.value} />
                </div>
              ))}
            </div>
          </div>

          {/* Simulation Config */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" /> Simulation Configuration
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Default Technique", value: sar.config.simulation.defaultTechnique },
                { label: "ART Repository", value: sar.config.simulation.artRepository },
                { label: "ART Branch", value: sar.config.simulation.artBranch },
                { label: "Splunk Binary Version", value: sar.config.splunk.version },
              ].map((c) => (
                <div key={c.label} className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-4 py-3">
                  <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                  <CopyField value={c.value} />
                </div>
              ))}
            </div>
          </div>

          {/* Enabled Machines */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" /> Machine Configuration
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(sar.config.enabledMachines).map(([name, enabled]) => (
                <div key={name} className={cn(
                  "rounded-lg border px-4 py-3 flex items-center justify-between",
                  enabled ? "border-success/30 bg-success/5" : "border-border bg-background/50"
                )}>
                  <span className="text-xs font-medium text-foreground">{name.replace(/_/g, " ")}</span>
                  <span className={cn("text-[10px] font-semibold", enabled ? "text-success" : "text-muted")}>
                    {enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Install path */}
          <div className="rounded-lg border border-border bg-background/50 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Installation Path</span>
            <CopyField value={sar.installPath} />
          </div>
        </div>
      )}
    </div>
  );
}
