"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Server, Power, PowerOff, RefreshCw, Activity, Shield,
  Monitor, CheckCircle2, XCircle, Loader2, Wifi, WifiOff,
  Database, Play, Square, Settings2, ChevronDown, ChevronRight,
  ExternalLink, AlertTriangle, Zap, Network,
} from "lucide-react";

// ── Types ──

interface GOADVm {
  name: string;
  ip: string;
  os: string;
  role: string;
  state: string;
  reachable: boolean;
}

interface GOADStatus {
  connected: boolean;
  probeTimeMs: number;
  goadPath: string;
  error?: string;
  instance?: {
    id: string;
    lab: string;
    provider: string;
    provisioner: string;
    ipRange: string;
    status: string;
    extensions: string[];
  };
  domain?: {
    name: string;
    netbios: string;
    path: string;
  };
  virtualMachines: GOADVm[];
  splunkIntegration: {
    splunkIp: string;
    splunkReachable: boolean;
    receivingPortOpen: boolean;
    forwarderExtensionAvailable: boolean;
    forwarderInstalled: boolean;
    logFlowReady: boolean;
  };
  network: {
    subnet: string;
    sarSplunk: {
      ip: string;
      reachable: boolean;
      webUrl: string;
      receivingPort: number;
    };
  };
}

// ── Helpers ──

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    running: "bg-success/10 text-success border-success/30",
    poweroff: "bg-muted/10 text-muted-foreground border-border",
    saved: "bg-warning/10 text-warning border-warning/30",
    aborted: "bg-danger/10 text-danger border-danger/30",
    not_found: "bg-danger/10 text-danger border-danger/30",
  };
  return (
    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", colors[state] || colors.poweroff)}>
      {state.replace("_", " ")}
    </span>
  );
}

function ForwarderStatusBadge({ installed, available }: { installed: boolean; available: boolean }) {
  if (installed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-success/10 text-success border-success/30">
        <CheckCircle2 className="h-2.5 w-2.5" /> Installed
      </span>
    );
  }
  if (available) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-warning/10 text-warning border-warning/30">
        <AlertTriangle className="h-2.5 w-2.5" /> Not Installed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-danger/10 text-danger border-danger/30">
      <XCircle className="h-2.5 w-2.5" /> Extension Missing
    </span>
  );
}

// ── Main Component ──

export default function GOADPanel() {
  const [status, setStatus] = useState<GOADStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("vms");
  const [forwarderOutput, setForwarderOutput] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/goad/status");
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data: GOADStatus = await res.json();
      setStatus(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleStart = async (gui = false) => {
    setActionLoading("start");
    try {
      const res = await fetch("/api/goad/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gui, lab: status?.instance?.lab || "MINILAB" }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      // Wait a moment then refresh
      setTimeout(fetchStatus, 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading("stop");
    try {
      const res = await fetch("/api/goad/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lab: status?.instance?.lab || "MINILAB" }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setTimeout(fetchStatus, 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleInstallForwarder = async () => {
    setActionLoading("forwarder");
    setForwarderOutput(null);
    try {
      const res = await fetch("/api/goad/forwarder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setForwarderOutput(`Error: ${data.error}\n${data.details || ""}\n${data.stderr || ""}`);
      } else {
        setForwarderOutput(`Success: ${data.message}\n\n${data.stdout?.slice(-1500) || ""}`);
        setTimeout(fetchStatus, 2000);
      }
    } catch (err: any) {
      setForwarderOutput(`Error: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const instance = status?.instance;
  const connected = status?.connected ?? false;
  const allRunning = status?.virtualMachines?.every((v) => v.state === "running") ?? false;
  const splunkIntegration = status?.splunkIntegration;

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Probing GOAD environment...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection Banner */}
      <div className={cn(
        "rounded-xl border p-4 flex items-center justify-between",
        connected ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
      )}>
        <div className="flex items-center gap-3">
          {connected ? (
            <Shield className="h-6 w-6 text-success" />
          ) : (
            <Shield className="h-6 w-6 text-warning" />
          )}
          <div>
            <p className={cn("text-sm font-semibold", connected ? "text-success" : "text-warning")}>
              {connected
                ? `GOAD ${instance?.lab || "MINILAB"} — Active Directory Lab Online`
                : instance
                  ? `GOAD ${instance.lab} — VMs Not Running`
                  : "GOAD Instance Not Found"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {instance
                ? `Instance: ${instance.id} | Provider: ${instance.provider} | Subnet: ${instance.ipRange}.0/24`
                : error || "Check GOAD_PATH and GOAD_INSTANCE_ID configuration"}
              {status?.probeTimeMs ? ` | Probed in ${status.probeTimeMs}ms` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Controls */}
      {instance && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleStart(false)}
            disabled={allRunning || actionLoading !== null}
            className="flex items-center gap-1.5 rounded-lg bg-success/10 border border-success/30 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-40"
          >
            {actionLoading === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Start Headless
          </button>
          <button
            onClick={() => handleStart(true)}
            disabled={allRunning || actionLoading !== null}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
          >
            {actionLoading === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Monitor className="h-3 w-3" />}
            Start GUI
          </button>
          <button
            onClick={handleStop}
            disabled={!allRunning || actionLoading !== null}
            className="flex items-center gap-1.5 rounded-lg bg-danger/10 border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-40"
          >
            {actionLoading === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Stop Lab
          </button>
        </div>
      )}

      {/* VM Grid */}
      <div className="rounded-xl border border-border bg-card">
        <button
          onClick={() => setExpandedSection(expandedSection === "vms" ? null : "vms")}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
        >
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Virtual Machines</span>
            <span className="text-[10px] text-muted-foreground">
              ({status?.virtualMachines?.filter((v) => v.state === "running").length || 0}/{status?.virtualMachines?.length || 0} running)
            </span>
          </div>
          {expandedSection === "vms" ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        </button>

        {expandedSection === "vms" && (
          <div className="border-t border-border px-4 py-3 space-y-2">
            {(status?.virtualMachines || []).map((vm) => (
              <div key={vm.name} className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "h-2 w-2 rounded-full",
                    vm.state === "running" ? "bg-success animate-pulse" : "bg-muted"
                  )} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{vm.name}</p>
                    <p className="text-[10px] text-muted-foreground">{vm.role} — {vm.os}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <code className="text-[10px] font-mono text-muted-foreground bg-background rounded px-1.5 py-0.5">
                    {vm.ip}
                  </code>
                  {vm.reachable ? (
                    <Wifi className="h-3 w-3 text-success" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-muted" />
                  )}
                  <StateBadge state={vm.state} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Splunk Integration */}
      {splunkIntegration && (
        <div className="rounded-xl border border-border bg-card">
          <button
            onClick={() => setExpandedSection(expandedSection === "splunk" ? null : "splunk")}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">SAR Splunk Integration</span>
              {splunkIntegration.logFlowReady ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                  <Zap className="h-2.5 w-2.5" /> Log Flow Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30">
                  <AlertTriangle className="h-2.5 w-2.5" /> Setup Required
                </span>
              )}
            </div>
            {expandedSection === "splunk" ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
          </button>

          {expandedSection === "splunk" && (
            <div className="border-t border-border px-4 py-3 space-y-3">
              {/* Status grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                  <p className="text-[10px] text-muted-foreground mb-1">SAR Splunk Server</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-foreground">{splunkIntegration.splunkIp}</code>
                    {splunkIntegration.splunkReachable ? (
                      <CheckCircle2 className="h-3 w-3 text-success" />
                    ) : (
                      <XCircle className="h-3 w-3 text-danger" />
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                  <p className="text-[10px] text-muted-foreground mb-1">Receiving Port (9997)</p>
                  <div className="flex items-center gap-2">
                    {splunkIntegration.receivingPortOpen ? (
                      <span className="text-xs text-success font-medium">Open</span>
                    ) : (
                      <span className="text-xs text-danger font-medium">Closed</span>
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                  <p className="text-[10px] text-muted-foreground mb-1">Splunk Forwarder Extension</p>
                  <ForwarderStatusBadge
                    installed={splunkIntegration.forwarderInstalled}
                    available={splunkIntegration.forwarderExtensionAvailable}
                  />
                </div>
                <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                  <p className="text-[10px] text-muted-foreground mb-1">Log Flow Status</p>
                  {splunkIntegration.logFlowReady ? (
                    <span className="text-xs text-success font-medium">GOAD → Splunk Active</span>
                  ) : (
                    <span className="text-xs text-warning font-medium">Not Connected</span>
                  )}
                </div>
              </div>

              {/* Install Forwarder Button */}
              {!splunkIntegration.forwarderInstalled && splunkIntegration.forwarderExtensionAvailable && allRunning && (
                <button
                  onClick={handleInstallForwarder}
                  disabled={actionLoading !== null}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent/10 border border-accent/30 px-4 py-2.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
                >
                  {actionLoading === "forwarder" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  {actionLoading === "forwarder"
                    ? "Installing Splunk Forwarder (this may take several minutes)..."
                    : "Install Splunk Universal Forwarder on GOAD Machines"}
                </button>
              )}

              {/* Reinstall option if already installed */}
              {splunkIntegration.forwarderInstalled && (
                <button
                  onClick={handleInstallForwarder}
                  disabled={actionLoading !== null || !allRunning}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" />
                  Reinstall / Update Splunk Forwarder
                </button>
              )}

              {/* Forwarder output log */}
              {forwarderOutput && (
                <div className="rounded-lg bg-background border border-border p-3">
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Ansible Output</p>
                  <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {forwarderOutput}
                  </pre>
                </div>
              )}

              {/* Splunk Web link */}
              {status?.network?.sarSplunk?.reachable && (
                <a
                  href={status.network.sarSplunk.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Splunk Web — Search: index=win host=dc* OR host=ws*
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Domain Info */}
      {status?.domain && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Active Directory Domain</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-2 rounded-lg bg-background/50 border border-border/50">
              <p className="text-[10px] text-muted-foreground">Domain</p>
              <p className="text-xs font-mono text-foreground">{status.domain.name}</p>
            </div>
            <div className="p-2 rounded-lg bg-background/50 border border-border/50">
              <p className="text-[10px] text-muted-foreground">NetBIOS</p>
              <p className="text-xs font-mono text-foreground">{status.domain.netbios}</p>
            </div>
            <div className="p-2 rounded-lg bg-background/50 border border-border/50">
              <p className="text-[10px] text-muted-foreground">Network</p>
              <p className="text-xs font-mono text-foreground">{status?.network?.subnet}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
