"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import CloudTab from "@/components/detection-lab/cloud/CloudTab";
import {
  Server, Monitor, Cloud, Cpu, HardDrive, MemoryStick, CheckCircle2,
  XCircle, Loader2, RefreshCw, ChevronDown, ChevronRight, Play,
  AlertTriangle, Shield, Zap, ExternalLink, Download, Settings2,
  Box, Wrench, Crosshair, Terminal, Globe, Layers, Info, Rocket,
  LayoutGrid, List, FileText, Save, Eye, Star, CircleDot,
  FolderOpen, FolderSync, Copy, MapPin, ScanSearch,
  PowerOff, Trash2,
} from "lucide-react";

// ── Types ──

interface VMDef { name: string; role: string; os: string; ip?: string; cpus: number; memoryMB: number; diskGB: number; services: string[] }
interface ToolDef { id: string; name: string; description: string; repo: string; category: string; platforms: string[]; requirements: string[]; installSteps: string[]; targetVM: string; enabled: boolean }
interface LabTemplate { id: string; name: string; description: string; labType: string; mode: string; size: string; cloudProvider?: string; cloudTemplateRef?: string; requirements: { ramGB: number; cpuCores: number; diskGB: number; gpuRequired: boolean; notes?: string }; vms: VMDef[]; tools: string[]; config: Record<string, unknown>; recommended?: boolean }
interface InstalledEnv { id: string; name: string; type: string; status: string; path: string; vms: string[]; templateId?: string }
interface Drive { mount: string; device: string; totalGB: number; usedGB: number; availGB: number; usePct: number }
interface SystemInfo { ramGB: number; cpuCores: number; cpuModel: string; diskGB: number; os: string; drives: Drive[]; prerequisites: { virtualbox: string | null; vagrant: string | null; ansible: string | null; docker: string | null; dockerCompose: string | null }; runningVMs: string[]; allVMs: { name: string; state: string }[]; installedEnvironments: InstalledEnv[] }
interface Deployment { id: string; templateId: string; templateName: string; mode: string; status: string; tools: string[]; startedAt: string; logs: string[]; progress: number; error?: string }
interface ConfigSection { name: string; entries: { key: string; value: string; comment: string }[] }
interface SARConfig { exists: boolean; path: string; raw: string; sections: ConfigSection[]; flat: Record<string, string>; summary: Record<string, unknown>; sectionNames: string[] }
interface RegistrySource { id: string; name: string; type: string; path: string; status: string; healthy: boolean; description: string; configs: { file: string; exists: boolean; sizeKB: number }[]; dirs: { dir: string; exists: boolean }[] }
interface BlueprintInfo { id: string; path: string; files: number; sizeKB: number; scannedAt?: string }
interface DeployInfo { id: string; name: string; path: string; sourceId: string; templateId: string; createdAt: string }
interface CheckItem { category: string; item: string; status: boolean; critical: boolean; detail?: string }
interface ValidationResult {
  probeTimeMs: number;
  hosts: { id: string; ip: string; name: string; role: string; reachable: boolean }[];
  crossPing: { sarDcToGoadDc: boolean; sameSubnet: string };
  checklist: CheckItem[];
  summary: { total: number; passed: number; failed: number; criticalFailed: number; ready: boolean };
  splunkData: Record<string, { hasData: boolean; eventCount: number }>;
  loggingConfig: { components: { name: string; target: string; purpose: string }[]; splunkInputs: string[] };
}

// ── Small Components ──

function SizeBadge({ size }: { size: string }) {
  const c: Record<string, string> = { minimal: "bg-success/10 text-success border-success/30", standard: "bg-accent/10 text-accent border-accent/30", full: "bg-warning/10 text-warning border-warning/30", custom: "bg-muted/10 text-muted-foreground border-border" };
  return <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", c[size] || c.custom)}>{size}</span>;
}

function StatusDot({ status }: { status: string }) {
  const c: Record<string, string> = { running: "bg-success animate-pulse", stopped: "bg-warning", installed: "bg-muted", error: "bg-danger" };
  return <span className={cn("inline-block h-2 w-2 rounded-full", c[status] || c.installed)} />;
}

function ResourceBar({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const ok = pct <= 80;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className={ok ? "text-foreground" : "text-warning"}>{used}/{total} {unit}</span></div>
      <div className="h-1.5 rounded-full bg-background/50 overflow-hidden"><div className={cn("h-full rounded-full transition-all", ok ? "bg-accent" : "bg-warning")} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function ProviderIcon({ provider }: { provider?: string }) {
  const c: Record<string, string> = { aws: "text-[#FF9900]", azure: "text-[#0078D4]", gcp: "text-[#4285F4]" };
  return <Globe className={cn("h-3.5 w-3.5", c[provider || ""] || "text-muted-foreground")} />;
}

// ── Recommendations Banner ──

function RecommendationBanner({ system, templates }: { system: SystemInfo; templates: LabTemplate[] }) {
  const recommended = useMemo(() => {
    return templates
      .filter((t) => t.mode === "on-prem")
      .map((t) => {
        const ramOk = system.ramGB >= t.requirements.ramGB;
        const cpuOk = system.cpuCores >= t.requirements.cpuCores;
        const diskOk = system.diskGB >= t.requirements.diskGB;
        const score = (ramOk ? 1 : 0) + (cpuOk ? 1 : 0) + (diskOk ? 1 : 0)
          + (t.recommended ? 0.5 : 0)
          + (t.labType === "sar-goad" ? 0.3 : 0);
        return { ...t, feasible: ramOk && cpuOk && diskOk, score };
      })
      .sort((a, b) => b.score - a.score);
  }, [system, templates]);

  const best = recommended.filter((r) => r.feasible);
  const topPick = best[0];

  if (!topPick) {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-warning">Insufficient resources for any on-prem template</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your system has {system.ramGB}GB RAM, {system.cpuCores} cores, {system.diskGB}GB disk.
            The smallest template needs 8GB RAM / 4 cores / 40GB disk.
            Consider freeing resources or using a cloud deployment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Star className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-foreground">Recommended for your system</span>
        <span className="text-[11px] text-muted-foreground">({system.ramGB}GB RAM, {system.cpuCores} cores, {system.diskGB}GB disk)</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {best.slice(0, 3).map((tpl, i) => (
          <div key={tpl.id} className={cn("flex-shrink-0 rounded-lg border p-3 min-w-[220px]",
            i === 0 ? "border-accent/40 bg-accent/10" : "border-border bg-card"
          )}>
            <div className="flex items-center gap-1.5 mb-1">
              {i === 0 && <Zap className="h-3 w-3 text-accent" />}
              <span className="text-xs font-semibold text-foreground">{tpl.name}</span>
              <SizeBadge size={tpl.size} />
            </div>
            <p className="text-[11px] text-muted-foreground">{tpl.vms.length} VMs | {tpl.requirements.ramGB}GB RAM | {tpl.labType.toUpperCase()}</p>
            {i === 0 && <span className="inline-block mt-1 text-[10px] font-medium text-accent bg-accent/10 rounded px-1.5 py-0.5">Best match</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detected Environments ──

function DetectedEnvironments({ envs, onRefresh }: { envs: InstalledEnv[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // lab-level busy: `${envId}:${action}`
  const [vmBusy, setVmBusy] = useState<string | null>(null); // vm-level busy: `${vmName}:${action}`
  const [actionLog, setActionLog] = useState<Record<string, string>>({});
  const [vmLog, setVmLog] = useState<Record<string, string>>({}); // keyed by vmName

  if (envs.length === 0) return null;

  // Deployed labs (managed by the platform) vs source installs (existing local installs)
  const deployedLabs = envs.filter((e) => e.name.includes("[deployed]"));
  const sourceLabs = envs.filter((e) => !e.name.includes("[deployed]"));

  const runAction = async (env: InstalledEnv, action: "stop" | "resume" | "destroy") => {
    if (!env.name.includes("[deployed]")) return; // only managed deployments can be controlled
    const key = `${env.id}:${action}`;
    setBusy(key);
    setActionLog((prev) => ({ ...prev, [env.id]: `Running ${action}...` }));
    try {
      const res = await fetch("/api/detection-lab/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deployPath: env.path }),
      });
      const data = await res.json();
      if (res.ok) {
        const msg = data.results?.join(" · ") || `${action} OK`;
        setActionLog((prev) => ({ ...prev, [env.id]: msg }));
      } else {
        setActionLog((prev) => ({ ...prev, [env.id]: `Error: ${data.error || "Unknown"}` }));
      }
    } catch (err: any) {
      setActionLog((prev) => ({ ...prev, [env.id]: `Error: ${err.message}` }));
    }
    setBusy(null);
    setTimeout(onRefresh, 3000);
  };

  // Per-VM actions — hit the /api/detection-lab/vm endpoint which wraps VBoxManage
  const runVmAction = async (vmName: string, action: "start" | "stop" | "poweroff" | "restart") => {
    const key = `${vmName}:${action}`;
    setVmBusy(key);
    setVmLog((prev) => ({ ...prev, [vmName]: `${action}...` }));
    try {
      const res = await fetch("/api/detection-lab/vm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmName, action }),
      });
      const data = await res.json();
      if (res.ok) {
        const msg = data.message || (data.results ? data.results.join(" · ") : `${action} → ${data.state}`);
        setVmLog((prev) => ({ ...prev, [vmName]: msg }));
      } else {
        setVmLog((prev) => ({ ...prev, [vmName]: `Error: ${data.error || "Unknown"}` }));
      }
    } catch (err: any) {
      setVmLog((prev) => ({ ...prev, [vmName]: `Error: ${err.message}` }));
    }
    setVmBusy(null);
    setTimeout(onRefresh, 2500);
  };

  const renderEnvRow = (env: InstalledEnv, managed: boolean) => {
    const isExpanded = expanded === env.id;
    const statusColor =
      env.status === "running" ? "bg-success/10 text-success border-success/30" :
      env.status === "stopped" ? "bg-warning/10 text-warning border-warning/30" :
      env.status === "partial" ? "bg-accent/10 text-accent border-accent/30" :
      env.status === "missing" ? "bg-danger/10 text-danger border-danger/30" :
      "bg-muted/10 text-muted-foreground border-border";

    return (
      <div key={env.id} className="rounded-lg bg-background/50 border border-border/50 overflow-hidden">
        {/* Header row — clickable to expand */}
        <button
          onClick={() => setExpanded(isExpanded ? null : env.id)}
          className="w-full flex items-center justify-between p-2.5 hover:bg-card-hover transition-colors text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted" /> : <ChevronRight className="h-3 w-3 text-muted" />}
            <StatusDot status={env.status} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate">{env.name}</p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">{env.path}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-[11px] text-muted-foreground">
              {env.vms.filter((v) => v.includes("running")).length}/{env.vms.length} VMs
            </span>
            <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", statusColor)}>
              {env.status}
            </span>
          </div>
        </button>

        {/* Expanded details */}
        {isExpanded && (
          <div className="border-t border-border/50 px-3 py-2.5 space-y-2.5 bg-background/30">
            {/* VMs list with per-VM action buttons */}
            <div>
              <p className="text-[11px] font-medium text-muted-foreground uppercase mb-1.5">
                Virtual Machines <span className="text-muted normal-case">— each VM can be controlled individually</span>
              </p>
              <div className="space-y-1.5">
                {env.vms.map((vm, i) => {
                  const vmName = vm.replace(/\s+\([^)]+\)$/, "");
                  const vmState = vm.match(/\(([^)]+)\)$/)?.[1] || "unknown";
                  const isRunning = vmState === "running";
                  const isPoweroff = vmState === "poweroff";
                  const isSaved = vmState === "saved";
                  const isMissing = vmState === "missing";
                  const thisVmBusy = vmBusy?.startsWith(`${vmName}:`);

                  return (
                    <div key={i} className="rounded bg-background border border-border/30 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Monitor className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="text-[11px] font-mono text-foreground truncate">{vmName}</span>
                        </div>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0",
                          isRunning ? "bg-success/10 text-success" :
                          isMissing ? "bg-danger/10 text-danger" :
                          isSaved ? "bg-accent/10 text-accent" :
                          "bg-muted/10 text-muted-foreground"
                        )}>
                          {isPoweroff ? "powered off" : vmState}
                        </span>
                      </div>

                      {/* Per-VM action buttons — only for managed deployments */}
                      {managed && !isMissing && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); runVmAction(vmName, "start"); }}
                            disabled={vmBusy !== null || isRunning}
                            title="Start this VM"
                            className="flex items-center gap-0.5 text-[10px] font-medium text-success bg-success/10 hover:bg-success/20 border border-success/30 rounded px-1.5 py-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {vmBusy === `${vmName}:start` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
                            Start
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); runVmAction(vmName, "restart"); }}
                            disabled={vmBusy !== null}
                            title="Restart this VM (poweroff + start)"
                            className="flex items-center gap-0.5 text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-1.5 py-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {vmBusy === `${vmName}:restart` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                            Restart
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); runVmAction(vmName, "stop"); }}
                            disabled={vmBusy !== null || !isRunning}
                            title="Graceful shutdown (ACPI)"
                            className="flex items-center gap-0.5 text-[10px] font-medium text-warning bg-warning/10 hover:bg-warning/20 border border-warning/30 rounded px-1.5 py-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {vmBusy === `${vmName}:stop` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <PowerOff className="h-2.5 w-2.5" />}
                            Stop
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); runVmAction(vmName, "poweroff"); }}
                            disabled={vmBusy !== null || isPoweroff}
                            title="Hard power off (force)"
                            className="flex items-center gap-0.5 text-[10px] font-medium text-danger bg-danger/10 hover:bg-danger/20 border border-danger/30 rounded px-1.5 py-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {vmBusy === `${vmName}:poweroff` ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <XCircle className="h-2.5 w-2.5" />}
                            Power Off
                          </button>
                        </div>
                      )}

                      {vmLog[vmName] && thisVmBusy === false && (
                        <p className="mt-1 text-[10px] font-mono text-muted-foreground">{vmLog[vmName]}</p>
                      )}
                      {vmLog[vmName] && thisVmBusy && (
                        <p className="mt-1 text-[10px] font-mono text-accent">{vmLog[vmName]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons (only for managed deployments) */}
            {managed && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase mb-1.5">Actions</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); runAction(env, "resume"); }}
                    disabled={busy !== null || env.status === "running" || env.status === "missing"}
                    className="flex items-center gap-1 text-[11px] font-medium text-success bg-success/10 hover:bg-success/20 border border-success/30 rounded px-2.5 py-1 transition-colors disabled:opacity-40"
                  >
                    {busy === `${env.id}:resume` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Resume
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); runAction(env, "stop"); }}
                    disabled={busy !== null || env.status === "stopped" || env.status === "missing"}
                    className="flex items-center gap-1 text-[11px] font-medium text-warning bg-warning/10 hover:bg-warning/20 border border-warning/30 rounded px-2.5 py-1 transition-colors disabled:opacity-40"
                  >
                    {busy === `${env.id}:stop` ? <Loader2 className="h-3 w-3 animate-spin" /> : <PowerOff className="h-3 w-3" />}
                    Stop
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await runAction(env, "stop");
                      setTimeout(() => runAction(env, "resume"), 3000);
                    }}
                    disabled={busy !== null || env.status === "missing"}
                    className="flex items-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-2.5 py-1 transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={cn("h-3 w-3", busy?.startsWith(env.id) && "animate-spin")} />
                    Restart
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Destroy ${env.name}? This will delete the VMs and remove it from the registry.`)) {
                        runAction(env, "destroy");
                      }
                    }}
                    disabled={busy !== null}
                    className="flex items-center gap-1 text-[11px] font-medium text-danger bg-danger/10 hover:bg-danger/20 border border-danger/30 rounded px-2.5 py-1 transition-colors disabled:opacity-40"
                  >
                    {busy === `${env.id}:destroy` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Destroy
                  </button>
                </div>
                {actionLog[env.id] && (
                  <p className="mt-2 text-[11px] font-mono text-muted-foreground border-t border-border/30 pt-1.5">
                    {actionLog[env.id]}
                  </p>
                )}
              </div>
            )}

            {!managed && (
              <p className="text-[10px] text-muted-foreground italic">
                Source install (not managed by platform — use the original installation tools to control)
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CircleDot className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-foreground">Detected Environments</span>
          <span className="text-[11px] text-muted-foreground">({envs.length} found)</span>
        </div>
        <button
          onClick={onRefresh}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 border border-border rounded px-2 py-0.5"
        >
          <RefreshCw className="h-2.5 w-2.5" /> Refresh
        </button>
      </div>

      {/* Managed (deployed) labs first — these are the ones users care about */}
      {deployedLabs.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-accent uppercase mb-1.5">Managed Deployments</p>
          <div className="space-y-2">
            {deployedLabs.map((env) => renderEnvRow(env, true))}
          </div>
        </div>
      )}

      {/* Source installs (read-only reference) */}
      {sourceLabs.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-muted uppercase mb-1.5">Source Installs</p>
          <div className="space-y-2">
            {sourceLabs.map((env) => renderEnvRow(env, false))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lab Readiness Panel ──

function LabReadiness({ validation, onValidate, validating, onFix, fixing }: {
  validation: ValidationResult | null; onValidate: () => void; validating: boolean;
  onFix: (target: string) => void; fixing: string | null;
}) {
  if (!validation) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Lab Readiness</span>
          </div>
          <button onClick={onValidate} disabled={validating}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
            {validating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
            {validating ? "Validating..." : "Run Validation"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Validates network connectivity, Splunk forwarder installation, Sysmon, AD audit logging, and PowerShell logging across all lab VMs.
        </p>
      </div>
    );
  }

  const { summary, checklist, hosts, loggingConfig, splunkData } = validation;
  const categories = [...new Set(checklist.map((c) => c.category))];

  // Check which GOAD VMs need fixes
  const dc01NeedsUF = !checklist.find((c) => c.item.includes("DC01 logs"))?.status;
  const ws01NeedsUF = !checklist.find((c) => c.item.includes("WS01 logs"))?.status;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className={cn("px-5 py-3 flex items-center justify-between border-b",
        summary.ready ? "bg-success/5 border-success/20" : "bg-warning/5 border-warning/20"
      )}>
        <div className="flex items-center gap-2.5">
          {summary.ready ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertTriangle className="h-5 w-5 text-warning" />}
          <div>
            <p className={cn("text-sm font-semibold", summary.ready ? "text-success" : "text-warning")}>
              {summary.ready ? "Lab Ready — All Critical Checks Passed" : `${summary.criticalFailed} Critical Issue${summary.criticalFailed !== 1 ? "s" : ""} Found`}
            </p>
            <p className="text-[11px] text-muted-foreground">{summary.passed}/{summary.total} checks passed in {validation.probeTimeMs}ms</p>
          </div>
        </div>
        <button onClick={onValidate} disabled={validating}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 disabled:opacity-50">
          <RefreshCw className={cn("h-3 w-3", validating && "animate-spin")} /> Recheck
        </button>
      </div>

      {/* Network topology */}
      <div className="px-5 py-3 border-b border-border/50">
        <p className="text-[11px] font-medium text-muted-foreground uppercase mb-2">Network — {validation.crossPing.sameSubnet}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {hosts.map((h) => (
            <div key={h.id} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5",
              h.reachable ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
            )}>
              <span className={cn("h-2 w-2 rounded-full", h.reachable ? "bg-success" : "bg-danger")} />
              <span className="text-[11px] font-medium text-foreground">{h.name}</span>
              <code className="text-[10px] font-mono text-muted-foreground">{h.ip}</code>
            </div>
          ))}
          <div className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            validation.crossPing.sarDcToGoadDc ? "border-success/30 text-success" : "border-danger/30 text-danger"
          )}>
            SAR DC ↔ GOAD DC {validation.crossPing.sarDcToGoadDc ? "OK" : "FAIL"}
          </div>
        </div>
      </div>

      {/* Checklist by category */}
      <div className="px-5 py-3 space-y-3">
        {categories.map((cat) => {
          const items = checklist.filter((c) => c.category === cat);
          const catPassed = items.filter((c) => c.status).length;
          return (
            <div key={cat}>
              <p className="text-[11px] font-medium text-muted-foreground uppercase mb-1.5">
                {cat} <span className="text-muted">({catPassed}/{items.length})</span>
              </p>
              <div className="space-y-1">
                {items.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5">
                      {c.status ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-danger" />}
                      <span className={c.status ? "text-muted-foreground" : "text-foreground"}>{c.item}</span>
                      {c.critical && !c.status && <span className="text-[8px] text-danger font-medium px-1 rounded bg-danger/10">CRITICAL</span>}
                    </div>
                    {c.detail && <span className="text-[10px] text-muted">{c.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fix buttons for GOAD VMs missing Splunk UF */}
      {(dc01NeedsUF || ws01NeedsUF) && (
        <div className="px-5 py-3 border-t border-border bg-warning/5 space-y-2">
          <p className="text-[11px] font-medium text-warning">Missing log forwarding — install Splunk UF + Sysmon</p>
          <div className="flex gap-2">
            {dc01NeedsUF && (
              <button onClick={() => onFix("dc01")} disabled={fixing !== null}
                className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
                {fixing === "dc01" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                Fix DC01
              </button>
            )}
            {ws01NeedsUF && (
              <button onClick={() => onFix("ws01")} disabled={fixing !== null}
                className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
                {fixing === "ws01" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                Fix WS01
              </button>
            )}
          </div>
        </div>
      )}

      {/* Logging requirements */}
      <details className="border-t border-border">
        <summary className="px-5 py-2.5 text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-card-hover">
          Required Logging Components ({loggingConfig.components.length})
        </summary>
        <div className="px-5 pb-3 space-y-1.5">
          {loggingConfig.components.map((c) => (
            <div key={c.name} className="flex items-start gap-2 text-[11px]">
              <CheckCircle2 className="h-3 w-3 text-accent mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="text-muted-foreground"> — {c.purpose}</span>
                <p className="text-[10px] text-muted">Target: {c.target}</p>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Config Panel (right side) ──

function ConfigPanel({ config, onSave }: { config: SARConfig | null; onSave: (raw: string) => void }) {
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [editRaw, setEditRaw] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config?.raw) setEditRaw(config.raw);
    if (config?.sectionNames?.length && !selectedSection) setSelectedSection(config.sectionNames[0]);
  }, [config]);

  if (!config || !config.exists) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">SAR Configuration</span>
        </div>
        <p className="text-[11px] text-muted-foreground">attack_range_local.conf not found. Deploy a SAR instance first.</p>
      </div>
    );
  }

  const currentSection = config.sections.find((s) => s.name === selectedSection);

  const handleSave = async () => {
    setSaving(true);
    await onSave(editRaw);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header — always shows Edit button */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">SAR Configuration</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded border border-accent/30 transition-colors">
              <Settings2 className="h-3 w-3" /> Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => { setEditing(false); setEditRaw(config.raw); }} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded border border-accent/30 transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Save className="h-3 w-3" />}
                {saving ? "Saving..." : saved ? "Saved!" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* File path */}
      <div className="px-4 py-1.5 bg-background/50 border-b border-border/50">
        <p className="text-[10px] font-mono text-muted-foreground truncate" title={config.path}>{config.path}</p>
      </div>

      {editing ? (
        /* ── Full raw editor ── */
        <div className="relative">
          <div className="px-4 py-2 bg-background/30 border-b border-border/30 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Editing attack_range_local.conf</span>
            <span className="text-[10px] text-muted-foreground">{editRaw.split("\n").length} lines</span>
          </div>
          <textarea
            value={editRaw}
            onChange={(e) => setEditRaw(e.target.value)}
            className="w-full h-[420px] p-3 text-[10.5px] font-mono leading-relaxed bg-background text-foreground border-0 focus:outline-none resize-none"
            spellCheck={false}
          />
        </div>
      ) : (
        /* ── Section browser (read-only view) ── */
        <div>
          <div className="px-3 py-2 border-b border-border">
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
            >
              {config.sectionNames.map((s) => (
                <option key={s} value={s}>{`Section: ${s}`}</option>
              ))}
            </select>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {currentSection?.entries.map((e, i) => (
              <div key={i} className="px-3 py-1.5 border-b border-border/30 hover:bg-card-hover transition-colors">
                {e.comment && <p className="text-[10px] text-muted-foreground italic"># {e.comment}</p>}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-accent flex-shrink-0">{e.key}</span>
                  <span className="text-[11px] font-mono text-foreground truncate text-right" title={e.value}>
                    {e.key.includes("password") ? "••••••••" : e.value}
                  </span>
                </div>
              </div>
            ))}
            {(!currentSection || currentSection.entries.length === 0) && (
              <p className="p-3 text-[11px] text-muted-foreground">No entries in this section.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sources & Blueprints Panel ──

function SourcesPanel({ sources, blueprints, deploys, onScan, scanning, drives, onDeploy }: {
  sources: RegistrySource[]; blueprints: BlueprintInfo[]; deploys: DeployInfo[];
  onScan: () => void; scanning: boolean; drives: Drive[];
  onDeploy: (sourceId: string, targetPath: string, name: string) => void;
}) {
  const [deployingSource, setDeployingSource] = useState<string | null>(null);
  const [targetDrive, setTargetDrive] = useState(drives[0]?.mount || "/");
  const [deployName, setDeployName] = useState("");
  const [showDeployForm, setShowDeployForm] = useState(false);

  const handleDeploy = () => {
    if (!deployingSource || !deployName.trim()) return;
    const base = targetDrive === "/" ? "/opt/detection-labs" : `${targetDrive}/detection-labs`;
    onDeploy(deployingSource, base, deployName.trim());
    setShowDeployForm(false);
    setDeployingSource(null);
    setDeployName("");
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-foreground">Registered Installations</span>
        </div>
        <button onClick={onScan} disabled={scanning}
          className="flex items-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1 rounded border border-accent/30 transition-colors disabled:opacity-50">
          {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
          {scanning ? "Scanning..." : "Scan & Snapshot"}
        </button>
      </div>

      {/* Sources */}
      <div className="max-h-[480px] overflow-y-auto">
        {sources.map((src) => {
          const bp = blueprints.find((b) => b.id === src.id);
          return (
            <div key={src.id} className="px-4 py-3 border-b border-border/30 hover:bg-card-hover/50 transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <StatusDot status={src.status === "found" ? (src.healthy ? "running" : "stopped") : "error"} />
                  <span className="text-xs font-medium text-foreground">{src.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase">{src.type}</span>
                </div>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground mb-1.5 truncate" title={src.path}>{src.path}</p>

              {/* Config files status */}
              <div className="flex flex-wrap gap-1 mb-2">
                {src.configs.map((c) => (
                  <span key={c.file} className={cn("text-[8px] px-1 py-0.5 rounded border font-mono",
                    c.exists ? "bg-success/10 text-success border-success/20" : "bg-danger/10 text-danger border-danger/20"
                  )}>
                    {c.file.split("/").pop()} {c.exists ? `(${c.sizeKB}KB)` : "missing"}
                  </span>
                ))}
              </div>

              {/* Blueprint status + Deploy button */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {bp ? (
                    <span className="text-[10px] text-success flex items-center gap-1">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Blueprint: {bp.files} files ({bp.sizeKB}KB)
                      {bp.scannedAt && <span className="text-muted-foreground">· {new Date(bp.scannedAt).toLocaleDateString()}</span>}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-2.5 w-2.5" /> No blueprint — click Scan
                    </span>
                  )}
                </div>
                {bp && src.healthy && (
                  <button
                    onClick={() => { setDeployingSource(src.id); setDeployName(`${src.type}-deploy`); setShowDeployForm(true); }}
                    className="flex items-center gap-1 text-[10px] font-medium text-accent hover:underline">
                    <Copy className="h-2.5 w-2.5" /> Deploy copy
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {sources.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            No sources registered. Add installations in<br />
            <code className="font-mono text-[10px]">labs/registry/sources.json</code>
          </div>
        )}
      </div>

      {/* Deploy form */}
      {showDeployForm && deployingSource && (
        <div className="border-t border-border px-4 py-3 bg-accent/5 space-y-2.5">
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-medium text-foreground">Deploy "{deployingSource}" to</span>
          </div>

          <label className="block">
            <span className="text-[10px] text-muted-foreground">Target drive</span>
            <select value={targetDrive} onChange={(e) => setTargetDrive(e.target.value)}
              className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground">
              {drives.map((d) => (
                <option key={d.mount} value={d.mount}>{d.mount} — {d.availGB}GB free ({d.device})</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] text-muted-foreground">Deployment name</span>
            <input value={deployName} onChange={(e) => setDeployName(e.target.value)}
              className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-[11px] font-mono text-foreground"
              placeholder="my-lab-deploy" />
          </label>

          <p className="text-[10px] font-mono text-muted-foreground">
            → {targetDrive === "/" ? "/opt/detection-labs" : `${targetDrive}/detection-labs`}/{deployName || "..."}
          </p>

          <div className="flex gap-2">
            <button onClick={handleDeploy} disabled={!deployName.trim()}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 px-2 py-1.5 rounded border border-accent/30 disabled:opacity-40">
              <Rocket className="h-3 w-3" /> Deploy
            </button>
            <button onClick={() => { setShowDeployForm(false); setDeployingSource(null); }}
              className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded border border-border">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing deployments */}
      {deploys.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 py-2 bg-background/30">
            <span className="text-[11px] font-medium text-muted-foreground">Previous Deployments</span>
          </div>
          {deploys.map((d) => (
            <div key={d.id} className="px-4 py-2 border-b border-border/20 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-medium text-foreground">{d.name}</span>
                <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[200px]">{d.path}</p>
              </div>
              <span className="text-[10px] text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Template Card (Grid) ──

function TemplateCardGrid({ template, system, isBestMatch, isInstalled, onSelect }: {
  template: LabTemplate; system: SystemInfo | null; isBestMatch: boolean; isInstalled: boolean; onSelect: () => void;
}) {
  const feasible = !system || template.mode === "cloud" ||
    (system.ramGB >= template.requirements.ramGB && system.cpuCores >= template.requirements.cpuCores && system.diskGB >= template.requirements.diskGB);
  const totalRAM = template.vms.reduce((s, v) => s + v.memoryMB, 0);

  return (
    <div onClick={onSelect} className={cn("rounded-xl border bg-card p-4 cursor-pointer transition-all hover:border-accent/40 hover:shadow-sm",
      isInstalled && "ring-1 ring-success/30 border-success/30",
      isBestMatch && !isInstalled && "ring-1 ring-accent/30 border-accent/30",
      !feasible && !isInstalled && "opacity-60"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isBestMatch && !isInstalled && <Star className="h-3.5 w-3.5 text-accent fill-accent/30" />}
          {template.recommended && !isBestMatch && !isInstalled && <Zap className="h-3.5 w-3.5 text-accent" />}
          <SizeBadge size={template.size} />
          {!feasible && !isInstalled && <AlertTriangle className="h-3 w-3 text-warning" />}
        </div>
        {isInstalled ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5">
            <CheckCircle2 className="h-3 w-3" /> Installed
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground bg-muted/10 border border-border rounded-full px-2 py-0.5">
            Not installed
          </span>
        )}
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{template.name}</h3>
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mb-3">{template.description}</p>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Server className="h-3 w-3" />{template.vms.length}</span>
        <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3" />{Math.round(totalRAM / 1024)}G</span>
        <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{template.requirements.cpuCores}C</span>
        <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{template.requirements.diskGB}G</span>
      </div>
      {isBestMatch && !isInstalled && <span className="inline-block mt-2 text-[10px] font-medium text-accent bg-accent/10 rounded px-1.5 py-0.5">Best match for your system</span>}
    </div>
  );
}

// ── Template Row (Table) ──

function TemplateTableRow({ template, system, isBestMatch, isInstalled, onSelect }: {
  template: LabTemplate; system: SystemInfo | null; isBestMatch: boolean; isInstalled: boolean; onSelect: () => void;
}) {
  const feasible = !system || (system.ramGB >= template.requirements.ramGB && system.cpuCores >= template.requirements.cpuCores && system.diskGB >= template.requirements.diskGB);
  return (
    <tr onClick={onSelect} className={cn("cursor-pointer hover:bg-card-hover transition-colors border-b border-border/30",
      isInstalled && "bg-success/5",
      isBestMatch && !isInstalled && "bg-accent/5",
      !feasible && !isInstalled && "opacity-60"
    )}>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {isBestMatch && !isInstalled && <Star className="h-3 w-3 text-accent fill-accent/30" />}
          <span className="text-xs font-medium text-foreground">{template.name}</span>
        </div>
      </td>
      <td className="px-3 py-2.5"><span className="text-[11px] text-muted-foreground uppercase">{template.labType}</span></td>
      <td className="px-3 py-2.5"><SizeBadge size={template.size} /></td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{template.vms.length} VMs</td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{template.requirements.ramGB}GB</td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{template.requirements.cpuCores}</td>
      <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{template.requirements.diskGB}GB</td>
      <td className="px-3 py-2.5">
        {isInstalled ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Installed</span>
        ) : feasible ? (
          <span className="text-[10px] text-muted-foreground">Not installed</span>
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        )}
      </td>
    </tr>
  );
}

// ── Expanded Template Detail (replaces card expand) ──

function TemplateDetail({ template, system, tools, selectedTools, onToggleTool, onBack, drives }: {
  template: LabTemplate; system: SystemInfo | null; tools: ToolDef[];
  selectedTools: Set<string>; onToggleTool: (id: string) => void;
  onBack: () => void;
  drives?: Drive[];
}) {
  const [deployPath, setDeployPath] = useState(() => {
    // Default: first non-root drive if available, else /opt
    const bestDrive = drives?.find((d) => d.mount !== "/" && d.availGB > template.requirements.diskGB) || drives?.[0];
    const base = bestDrive && bestDrive.mount !== "/" ? bestDrive.mount : "/opt";
    return `${base}/detection-labs/${template.id}`;
  });

  const feasible = !system || template.mode === "cloud" || (system.ramGB >= template.requirements.ramGB && system.cpuCores >= template.requirements.cpuCores && system.diskGB >= template.requirements.diskGB);
  const availableTools = tools.filter((t) => template.tools.includes(t.id));

  // Find which drive the typed path is on
  const matchedDrive = drives?.slice().sort((a, b) => b.mount.length - a.mount.length).find((d) => deployPath.startsWith(d.mount));
  const diskAvail = matchedDrive?.availGB ?? system?.diskGB ?? 0;
  const driveHasSpace = diskAvail >= template.requirements.diskGB;

  const checks = system ? [
    { label: "RAM", need: template.requirements.ramGB, have: system.ramGB, unit: "GB", ok: system.ramGB >= template.requirements.ramGB },
    { label: "CPU Cores", need: template.requirements.cpuCores, have: system.cpuCores, unit: "", ok: system.cpuCores >= template.requirements.cpuCores },
    { label: "Disk Space", need: template.requirements.diskGB, have: diskAvail, unit: "GB", ok: driveHasSpace },
  ] : [];

  // Group VMs by source
  const sarVMs = template.vms.filter((v) => v.name.startsWith("splunk") || v.name.startsWith("windows-") || v.name === "kali");
  const goadVMs = template.vms.filter((v) => ["DC01", "DC02", "DC03", "WS01", "SRV02", "SRV03"].includes(v.name));

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground"><ChevronDown className="h-4 w-4 rotate-90" /></button>
          <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
          <SizeBadge size={template.size} />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 uppercase">{template.labType}</span>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground">{template.description}</p>

        {/* Resource check */}
        {system && (
          <div className={cn("rounded-lg border p-3", feasible && driveHasSpace ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
            <div className="flex items-center gap-1.5 mb-2">
              {feasible && driveHasSpace ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
              <span className={cn("text-xs font-medium", feasible && driveHasSpace ? "text-success" : "text-warning")}>
                {feasible && driveHasSpace ? "System meets all requirements" : "Resource constraints — consider a lighter template or different drive"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {checks.map((c) => (
                <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                  {c.ok ? <CheckCircle2 className="h-2.5 w-2.5 text-success" /> : <XCircle className="h-2.5 w-2.5 text-danger" />}
                  <span className="text-muted-foreground">{c.label}: {c.need}{c.unit} needed, {c.have}{c.unit} available</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VMs grouped by source */}
        {sarVMs.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Server className="h-3 w-3" /> SAR Virtual Machines ({sarVMs.length})
            </p>
            <div className="space-y-1.5">
              {sarVMs.map((vm) => (
                <div key={vm.name} className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-3 w-3 text-accent" />
                    <span className="text-xs font-medium text-foreground">{vm.name}</span>
                    <span className="text-[11px] text-muted-foreground">{vm.role}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{vm.os}</span>
                    {vm.ip && vm.ip !== "auto" && <code className="font-mono bg-background rounded px-1">{vm.ip}</code>}
                    <span>{vm.cpus}C / {Math.round(vm.memoryMB / 1024)}GB</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {goadVMs.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
              <Shield className="h-3 w-3" /> GOAD Virtual Machines ({goadVMs.length})
            </p>
            <div className="space-y-1.5">
              {goadVMs.map((vm) => (
                <div key={vm.name} className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-accent/20">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-3 w-3 text-warning" />
                    <span className="text-xs font-medium text-foreground">{vm.name}</span>
                    <span className="text-[11px] text-muted-foreground">{vm.role}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{vm.os}</span>
                    {vm.ip && vm.ip !== "auto" && <code className="font-mono bg-background rounded px-1">{vm.ip}</code>}
                    <span>{vm.cpus}C / {Math.round(vm.memoryMB / 1024)}GB</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1">Services</p>
          <div className="flex flex-wrap gap-1">
            {template.vms.flatMap((v) => v.services).filter((v, i, a) => a.indexOf(v) === i).map((s) => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">{s}</span>
            ))}
          </div>
        </div>

        {/* Tools */}
        {availableTools.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Optional Tools</p>
            <div className="space-y-1">
              {availableTools.map((tool) => (
                <label key={tool.id} className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border/50 cursor-pointer hover:bg-card-hover">
                  <input type="checkbox" checked={selectedTools.has(tool.id)} onChange={() => onToggleTool(tool.id)} className="rounded border-border" />
                  <Wrench className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground">{tool.name}</span>
                  <span className="text-[11px] text-muted-foreground">— {tool.platforms.join(", ")}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Deployment path selection (on-prem only) */}
        {template.mode === "on-prem" && (
          <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5 text-accent" />
              <span className="text-[11px] font-medium text-foreground">Deployment Path</span>
            </div>

            {/* Single editable path input */}
            <input
              value={deployPath}
              onChange={(e) => setDeployPath(e.target.value)}
              className="block w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs font-mono text-foreground"
              placeholder="/path/to/deploy/lab"
            />

            {/* Quick drive buttons */}
            {drives && drives.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Quick:</span>
                {drives.map((d) => (
                  <button key={d.mount}
                    onClick={() => setDeployPath(`${d.mount === "/" ? "/opt" : d.mount}/detection-labs/${template.id}`)}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-accent hover:border-accent/30 transition-colors">
                    {d.mount} ({d.availGB}GB free)
                  </button>
                ))}
              </div>
            )}

            {/* Status line */}
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-mono text-muted-foreground flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5" />
                {matchedDrive ? `${matchedDrive.device} — ${matchedDrive.availGB}GB free` : "unknown drive"}
              </span>
              {!driveHasSpace && (
                <span className="text-danger font-medium">needs {template.requirements.diskGB}GB, only {diskAvail}GB available</span>
              )}
              {driveHasSpace && <span className="text-success">space OK</span>}
            </div>
          </div>
        )}

        {/* Phased Deployment Panel */}
        <PhasedDeploymentPanel
          template={template}
          deployPath={deployPath}
          canDeploy={feasible && driveHasSpace && !!deployPath.trim()}
          blockReason={!feasible ? "Insufficient resources" : !driveHasSpace ? "Not enough disk space" : !deployPath.trim() ? "Set deploy path" : null}
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// Phased Deployment Panel — Phase 1: SAR, Phase 2: GOAD, Phase 3: Tools
// ══════════════════════════════════════════════

interface PhaseStatePayload {
  status: "pending" | "running" | "success" | "failed" | "skipped";
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  logs: string[];
  error: string | null;
  result: Record<string, any>;
}

interface DeploymentStatePayload {
  id: string;
  templateId: string;
  templateName: string;
  labType: string;
  deployPath: string;
  prefix: string;
  vmNames: Record<string, string>;
  createdAt: string;
  currentPhase: "prepare" | "sar" | "goad" | "tools" | null;
  phases: {
    prepare: PhaseStatePayload;
    sar: PhaseStatePayload;
    goad: PhaseStatePayload;
    tools: PhaseStatePayload;
  };
}

function PhasedDeploymentPanel({ template, deployPath, canDeploy, blockReason }: {
  template: LabTemplate; deployPath: string; canDeploy: boolean; blockReason: string | null;
}) {
  const [state, setState] = useState<DeploymentStatePayload | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  // Poll deployment state
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/detection-lab/deploy?deployPath=${encodeURIComponent(deployPath)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.deployment) setState(json.deployment);
      }
    } catch { /* ignore */ }
  }, [deployPath]);

  useEffect(() => { if (deployPath) fetchState(); }, [deployPath, fetchState]);

  // Auto-poll while a phase is running
  useEffect(() => {
    if (!state?.currentPhase) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/detection-lab/deploy`);
        if (res.ok) {
          const json = await res.json();
          if (json.deployment) setState(json.deployment);
          if (!json.hasActive) setRunning(false);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [state?.currentPhase]);

  const runPhaseRequest = async (phase: "prepare" | "sar" | "goad" | "tools") => {
    if (!canDeploy) return;
    setRunning(true);
    try {
      const res = await fetch("/api/detection-lab/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, deployPath, phase }),
      });
      const json = await res.json();
      if (json.deployment) setState(json.deployment);
      if (!res.ok) console.error("Phase failed:", json.error);
    } catch (err) {
      console.error(err);
    }
    setRunning(false);
  };

  const vagrantPhases: { id: "prepare" | "sar" | "goad" | "tools"; title: string; description: string; subtitle: string }[] = [
    {
      id: "prepare",
      title: "Phase 0: Prepare",
      subtitle: "Copy + patch sources",
      description: "Clean target dir, copy SAR & GOAD source trees, patch Vagrantfiles with unique VM names.",
    },
    {
      id: "sar",
      title: "Phase 1: SAR Installation",
      subtitle: "Splunk Attack Range",
      description: "Build SAR VMs (Splunk server + Windows DC). Verify Splunk Web (8000) and HEC receiver (9997) are up.",
    },
    {
      id: "goad",
      title: "Phase 2: GOAD + Network Config",
      subtitle: "AD lab + log forwarding",
      description: "Build GOAD DC01 + WS01, verify WinRM, install Splunk Forwarder + Sysmon (provides PowerShell logging, AD audit, log forwarding).",
    },
    {
      id: "tools",
      title: "Phase 3: Tool Deployment",
      subtitle: "PurpleSharp + RTA (skipped for now)",
      description: "Adversary simulation tools — skipped until lab is verified working.",
    },
  ];

  const dockerPhases: typeof vagrantPhases = [
    {
      id: "prepare",
      title: "Phase 0: Prepare",
      subtitle: "Install Docker + clone attack_range",
      description: "Verify/auto-install docker + docker-compose, check ports 4321/4000 are free, git clone splunk/attack_range repo.",
    },
    {
      id: "sar",
      title: "Phase 1: Docker Stack Up",
      subtitle: "docker compose up -d",
      description: "Start the SAR controller + web UI containers. Poll localhost:4000 (API) and localhost:4321 (Web) until reachable.",
    },
    {
      id: "goad",
      title: "Phase 2: GOAD (skipped)",
      subtitle: "Not applicable for Docker",
      description: "Docker controller does not provision local AD — skipped.",
    },
    {
      id: "tools",
      title: "Phase 3: Tool Deployment",
      subtitle: "PurpleSharp + RTA (skipped for now)",
      description: "Adversary simulation tools — skipped until lab is verified working.",
    },
  ];

  const phases = template.labType === "sar-docker" ? dockerPhases : vagrantPhases;

  // SAR-only and SAR-Docker templates skip GOAD phase
  const visiblePhases = template.labType !== "sar-goad" ? phases.filter((p) => p.id !== "goad") : phases;

  // Determine which phase is "next" to run
  const findNextPhase = (): "prepare" | "sar" | "goad" | "tools" | null => {
    if (!state) return "prepare";
    if (state.phases.prepare.status !== "success") return "prepare";
    if (state.phases.sar.status !== "success") return "sar";
    if (template.labType === "sar-goad" && state.phases.goad.status !== "success") return "goad";
    return null; // all done
  };

  const nextPhase = findNextPhase();
  const allComplete = nextPhase === null;
  const anyRunning = state?.currentPhase !== null && state?.currentPhase !== undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">Phased Deployment</span>
          {state && <code className="text-[10px] text-muted-foreground bg-background rounded px-1">{state.prefix}</code>}
        </div>
        <div className="flex items-center gap-2">
          {state && <button onClick={fetchState} className="text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="h-3 w-3 inline" /> refresh</button>}
          {nextPhase && canDeploy && (
            <button
              onClick={() => runPhaseRequest(nextPhase)}
              disabled={running || anyRunning}
              className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
            >
              {anyRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run {nextPhase}
            </button>
          )}
          {allComplete && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-success bg-success/10 border border-success/30 rounded px-2 py-1">
              <CheckCircle2 className="h-3 w-3" /> Lab Ready
            </span>
          )}
        </div>
      </div>

      {!canDeploy && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning flex items-center gap-2">
          <AlertTriangle className="h-3 w-3" /> {blockReason}
        </div>
      )}

      {/* Phase cards */}
      <div className="space-y-2">
        {visiblePhases.map((p, idx) => {
          const ps = state?.phases[p.id];
          const status = ps?.status || "pending";
          const isExpanded = expandedPhase === p.id;
          const canRun = canDeploy && !anyRunning && (
            p.id === "prepare" ||
            (p.id === "sar" && state?.phases.prepare.status === "success") ||
            (p.id === "goad" && state?.phases.sar.status === "success") ||
            (p.id === "tools" && state?.phases.goad.status === "success")
          );

          return (
            <div key={p.id} className={cn(
              "rounded-lg border transition-colors",
              status === "success" ? "border-success/30 bg-success/5" :
              status === "failed" ? "border-danger/30 bg-danger/5" :
              status === "running" ? "border-accent/40 bg-accent/5" :
              status === "skipped" ? "border-border/50 bg-card" :
              "border-border bg-card"
            )}>
              <div className="px-3 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <PhaseStatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{p.title}</span>
                      {ps?.durationMs ? <span className="text-[10px] text-muted-foreground">({Math.round(ps.durationMs / 1000)}s)</span> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{p.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {ps && ps.logs.length > 0 && (
                    <button
                      onClick={() => setExpandedPhase(isExpanded ? null : p.id)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {ps.logs.length} logs
                    </button>
                  )}
                  {(status === "failed" || status === "pending") && canRun && p.id !== "tools" && (
                    <button
                      onClick={() => runPhaseRequest(p.id)}
                      disabled={running || anyRunning}
                      className="flex items-center gap-1 text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-2 py-1 disabled:opacity-30"
                    >
                      {status === "failed" ? "Retry" : "Run"}
                    </button>
                  )}
                  {status === "success" && p.id !== "tools" && canRun && (
                    <button
                      onClick={() => runPhaseRequest(p.id)}
                      disabled={running || anyRunning}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 disabled:opacity-30"
                      title="Re-run this phase"
                    >
                      ↻
                    </button>
                  )}
                </div>
              </div>

              {/* Description */}
              {!isExpanded && (
                <p className="px-3 pb-2 text-[11px] text-muted-foreground">{p.description}</p>
              )}

              {/* Error */}
              {status === "failed" && ps?.error && (
                <div className="px-3 pb-2">
                  <p className="text-[11px] text-danger font-mono bg-danger/5 border border-danger/20 rounded px-2 py-1">
                    Error: {ps.error}
                  </p>
                </div>
              )}

              {/* Logs */}
              {isExpanded && ps && ps.logs.length > 0 && (
                <div className="border-t border-border/30 px-3 py-2 max-h-60 overflow-y-auto bg-background/50">
                  {ps.logs.map((line, i) => (
                    <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">{line}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lifecycle controls (only when prepare is done) */}
      {state && state.phases.prepare.status === "success" && (
        <div className="border-t border-border pt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Lifecycle</span>
          <div className="flex items-center gap-1">
            {(["stop", "resume", "destroy"] as const).map((action) => (
              <button
                key={action}
                onClick={async () => {
                  if (action === "destroy" && !confirm(`Destroy this deployment? This removes all VMs.`)) return;
                  await fetch("/api/detection-lab/deploy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action, deployPath }),
                  });
                  fetchState();
                }}
                className={cn(
                  "text-[11px] px-2 py-1 rounded border",
                  action === "destroy" ? "border-danger/30 text-danger hover:bg-danger/10" :
                  "border-border text-muted-foreground hover:bg-card-hover"
                )}
              >
                {action}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseStatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-danger shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-accent shrink-0" />;
  if (status === "skipped") return <span className="h-4 w-4 rounded-full border border-border shrink-0" title="skipped" />;
  return <span className="h-4 w-4 rounded-full border-2 border-border shrink-0" />;
}

// ── Deployment Status ──

function DeploymentPanel({ deployment, onRefresh }: { deployment: Deployment; onRefresh: () => void }) {
  const sc: Record<string, string> = { validating: "text-accent", deploying: "text-accent", provisioning: "text-warning", "installing-tools": "text-purple-400", running: "text-success", error: "text-danger" };
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {deployment.status === "running" ? <CheckCircle2 className="h-5 w-5 text-success" /> : deployment.status === "error" ? <XCircle className="h-5 w-5 text-danger" /> : <Loader2 className="h-5 w-5 animate-spin text-accent" />}
          <div>
            <p className="text-sm font-semibold text-foreground">{deployment.templateName}</p>
            <p className={cn("text-[11px] font-medium", sc[deployment.status] || "text-muted-foreground")}>{deployment.status.replace(/-/g, " ").toUpperCase()}</p>
          </div>
        </div>
        <button onClick={onRefresh} className="p-1 rounded hover:bg-card-hover"><RefreshCw className="h-3.5 w-3.5 text-muted-foreground" /></button>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground"><span>Progress</span><span>{deployment.progress}%</span></div>
        <div className="h-2 rounded-full bg-background/50 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500", deployment.status === "running" ? "bg-success" : deployment.status === "error" ? "bg-danger" : "bg-accent")} style={{ width: `${deployment.progress}%` }} />
        </div>
      </div>
      <div className="rounded-lg bg-background border border-border p-2 max-h-40 overflow-y-auto">
        {deployment.logs.map((log, i) => <p key={i} className="text-[11px] font-mono text-muted-foreground leading-relaxed">{log}</p>)}
      </div>
    </div>
  );
}

// ── Tools Tab ──

function ToolsPanel({ tools }: { tools: ToolDef[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Automatically install simulation tools during deployment. The pipeline detects the target OS, compiles binaries, and deploys to the selected server.</p>
      {tools.map((tool) => (
        <div key={tool.id} className="rounded-xl border border-border bg-card">
          <button onClick={() => setExpanded(expanded === tool.id ? null : tool.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors">
            <div className="flex items-center gap-3">
              <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", tool.category === "adversary-simulation" ? "bg-danger/10" : tool.category === "red-team" ? "bg-warning/10" : "bg-accent/10")}>
                {tool.category === "adversary-simulation" ? <Crosshair className="h-4 w-4 text-danger" /> : tool.category === "red-team" ? <Shield className="h-4 w-4 text-warning" /> : <Wrench className="h-4 w-4 text-accent" />}
              </div>
              <div className="text-left"><p className="text-sm font-medium text-foreground">{tool.name}</p><p className="text-[11px] text-muted-foreground">{tool.category.replace(/-/g, " ")} | {tool.platforms.join(", ")}</p></div>
            </div>
            {expanded === tool.id ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
          </button>
          {expanded === tool.id && (
            <div className="border-t border-border px-4 py-3 space-y-3">
              <p className="text-xs text-muted-foreground">{tool.description}</p>
              <a href={tool.repo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"><ExternalLink className="h-3 w-3" /> {tool.repo}</a>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[11px] font-medium text-muted-foreground mb-1">Requirements</p>{tool.requirements.map((r, i) => <div key={i} className="flex items-center gap-1 text-[11px] text-foreground"><span className="text-muted">-</span> {r}</div>)}</div>
                <div><p className="text-[11px] font-medium text-muted-foreground mb-1">Pipeline Steps</p>{tool.installSteps.map((s, i) => <div key={i} className="flex items-center gap-1.5 text-[11px] text-foreground"><span className="text-[10px] font-mono text-muted bg-background rounded px-1">{i + 1}</span> {s}</div>)}</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// ── Main Page ──
// ═══════════════════════════════════════════════

export default function DetectionLabPage() {
  const [activeTab, setActiveTab] = useState<"on-prem" | "cloud" | "tools">("on-prem");
  const [templates, setTemplates] = useState<LabTemplate[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [sarConfig, setSarConfig] = useState<SARConfig | null>(null);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(["purplesharp"]));
  const [labFilter, setLabFilter] = useState<"all" | "sar" | "sar-goad">("all");
  const [cloudFilter, setCloudFilter] = useState<"all" | "aws" | "azure" | "gcp">("all");
  const [installMode, setInstallMode] = useState<"template" | "custom">("template");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [selectedTemplate, setSelectedTemplate] = useState<LabTemplate | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<string>("/");
  const [regSources, setRegSources] = useState<RegistrySource[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintInfo[]>([]);
  const [labDeploys, setLabDeploys] = useState<DeployInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, sysRes, depRes, confRes, regRes, bpRes] = await Promise.all([
        fetch("/api/detection-lab/templates"),
        fetch("/api/detection-lab/system-info"),
        fetch("/api/detection-lab/deploy"),
        fetch("/api/detection-lab/config"),
        fetch("/api/detection-lab/registry"),
        fetch("/api/detection-lab/blueprint"),
      ]);
      if (tplRes.ok) { const d = await tplRes.json(); setTemplates(d.templates); setTools(d.tools); }
      if (sysRes.ok) setSystem(await sysRes.json());
      if (depRes.ok) { const d = await depRes.json(); setDeployment(d.deployment); }
      if (confRes.ok) setSarConfig(await confRes.json());
      if (regRes.ok) { const d = await regRes.json(); setRegSources(d.sources || []); }
      if (bpRes.ok) { const d = await bpRes.json(); setBlueprints(d.blueprints || []); setLabDeploys(d.deployments || []); }
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Polling for the per-phase deployment is handled inside PhasedDeploymentPanel.
  // The legacy top-level Deployment polling has been removed since the API now
  // returns a phased state shape.

  const handleDeploy = async (templateId: string, deployPath?: string) => {
    setDeploying(true);
    try {
      const res = await fetch("/api/detection-lab/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, tools: Array.from(selectedTools), deployPath }),
      });
      if (res.ok) setTimeout(fetchAll, 1000);
    } catch {}
    setDeploying(false);
  };

  const handleSaveConfig = async (raw: string) => {
    try {
      const res = await fetch("/api/detection-lab/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
      if (res.ok) { const confRes = await fetch("/api/detection-lab/config"); if (confRes.ok) setSarConfig(await confRes.json()); }
    } catch {}
  };

  const handleScanBlueprints = async () => {
    setScanning(true);
    try {
      await fetch("/api/detection-lab/blueprint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
      // Refresh blueprints & registry
      const [regRes, bpRes] = await Promise.all([fetch("/api/detection-lab/registry"), fetch("/api/detection-lab/blueprint")]);
      if (regRes.ok) setRegSources((await regRes.json()).sources || []);
      if (bpRes.ok) { const d = await bpRes.json(); setBlueprints(d.blueprints || []); setLabDeploys(d.deployments || []); }
    } catch {}
    setScanning(false);
  };

  const handleBlueprintDeploy = async (sourceId: string, targetPath: string, name: string) => {
    try {
      const res = await fetch("/api/detection-lab/blueprint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", sourceId, targetPath, deployName: name }),
      });
      if (res.ok) {
        // Refresh deployments list
        const bpRes = await fetch("/api/detection-lab/blueprint");
        if (bpRes.ok) { const d = await bpRes.json(); setLabDeploys(d.deployments || []); }
      }
    } catch {}
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/detection-lab/validate");
      if (res.ok) setValidation(await res.json());
    } catch {}
    setValidating(false);
  };

  const handleFix = async (target: string) => {
    setFixing(target);
    try {
      await fetch("/api/detection-lab/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fix", target }),
      });
      // Re-validate after fix
      setTimeout(handleValidate, 2000);
    } catch {}
    setFixing(null);
  };

  const toggleTool = (id: string) => { setSelectedTools((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

  const onPremTemplates = templates.filter((t) => t.mode === "on-prem" && (labFilter === "all" || t.labType === labFilter));
  const cloudTemplates = templates.filter((t) => t.mode === "cloud" && (cloudFilter === "all" || t.cloudProvider === cloudFilter));

  // Effective disk from selected drive (used for all feasibility checks)
  const effectiveDiskGB = useMemo(() => {
    if (!system) return 0;
    const drive = system.drives?.find((d) => d.mount === selectedDrive) || system.drives?.[0];
    return drive?.availGB ?? system.diskGB;
  }, [system, selectedDrive]);

  // Build a system snapshot with the selected drive's disk for passing to child components
  const effectiveSystem = useMemo(() => {
    if (!system) return null;
    return { ...system, diskGB: effectiveDiskGB };
  }, [system, effectiveDiskGB]);

  // Determine best match
  const bestMatchId = useMemo(() => {
    if (!system) return null;
    const feasible = onPremTemplates.filter((t) =>
      system.ramGB >= t.requirements.ramGB && system.cpuCores >= t.requirements.cpuCores && effectiveDiskGB >= t.requirements.diskGB
    ).sort((a, b) => {
      const sa = (a.recommended ? 1 : 0) + (a.labType === "sar-goad" ? 0.5 : 0) + (a.size === "standard" ? 0.3 : a.size === "minimal" ? 0.1 : 0);
      const sb = (b.recommended ? 1 : 0) + (b.labType === "sar-goad" ? 0.5 : 0) + (b.size === "standard" ? 0.3 : b.size === "minimal" ? 0.1 : 0);
      return sb - sa;
    });
    return feasible[0]?.id || null;
  }, [system, onPremTemplates, effectiveDiskGB]);

  // Set of template IDs that have been successfully deployed (from the registry)
  const installedTemplateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const env of system?.installedEnvironments || []) {
      if (env.templateId && env.name.includes("[deployed]")) {
        ids.add(env.templateId);
      }
    }
    return ids;
  }, [system]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Detection Engineering Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deploy detection engineering infrastructure — on-premises or cloud — with automated tool installation</p>
        </div>
        <button onClick={fetchAll} disabled={loading} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-50">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* System Resources */}
      {system && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Cpu className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-foreground">Host System</span>
            <span className="text-[11px] text-muted-foreground">— {system.os} | {system.cpuModel}</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <ResourceBar label="RAM" used={0} total={system.ramGB} unit="GB" />
            <ResourceBar label="CPU Cores" used={0} total={system.cpuCores} unit="" />
            {/* Disk Space with drive selector */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Disk Space</span>
                {system.drives && system.drives.length > 1 ? (
                  <select
                    value={selectedDrive}
                    onChange={(e) => setSelectedDrive(e.target.value)}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground max-w-[160px] truncate"
                  >
                    {system.drives.map((d) => (
                      <option key={d.mount} value={d.mount}>
                        {d.mount} — {d.availGB}GB free / {d.totalGB}GB
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-foreground">
                    {(system.drives?.find((d) => d.mount === selectedDrive) || system.drives?.[0])?.availGB ?? system.diskGB}/{(system.drives?.find((d) => d.mount === selectedDrive) || system.drives?.[0])?.totalGB ?? system.diskGB} GB
                  </span>
                )}
              </div>
              {(() => {
                const drive = system.drives?.find((d) => d.mount === selectedDrive) || system.drives?.[0];
                const avail = drive?.availGB ?? system.diskGB;
                const total = drive?.totalGB ?? system.diskGB;
                const used = total - avail;
                const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
                const ok = pct <= 80;
                return (
                  <>
                    <div className="h-1.5 rounded-full bg-background/50 overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", ok ? "bg-accent" : "bg-warning")} style={{ width: `${pct}%` }} />
                    </div>
                    {drive && (
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
                        <span className="font-mono truncate max-w-[120px]" title={drive.device}>{drive.device}</span>
                        <span>{drive.availGB}GB available</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11px]">
            {([
              ["virtualbox", "VirtualBox"],
              ["vagrant", "Vagrant"],
              ["ansible", "Ansible"],
              ["docker", "Docker"],
              ["dockerCompose", "Compose"],
            ] as const).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1">
                {system.prerequisites[k] ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-danger" />}
                {label} {system.prerequisites[k] || "missing"}
              </span>
            ))}
            {system.runningVMs.length > 0 && <span className="text-muted-foreground">| {system.runningVMs.length} VMs running</span>}
          </div>
        </div>
      )}

      {/* Detected Environments */}
      {system && <DetectedEnvironments envs={system.installedEnvironments} onRefresh={fetchAll} />}

      {/* Active deployment (per-phase status now lives inside the template detail PhasedDeploymentPanel) */}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: "on-prem" as const, label: "On-Premises", icon: Server },
          { key: "cloud" as const, label: "Cloud", icon: Cloud },
          { key: "tools" as const, label: "Tools & Integrations", icon: Wrench },
        ]).map((t) => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSelectedTemplate(null); }}
            className={cn("flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}><t.icon className="h-3.5 w-3.5" /> {t.label}</button>
        ))}
      </div>

      {/* ═══ ON-PREM TAB ═══ */}
      {activeTab === "on-prem" && (
        <div className="space-y-4">
          {/* Recommendations */}
          {effectiveSystem && templates.length > 0 && !selectedTemplate && <RecommendationBanner system={effectiveSystem} templates={templates} />}

          {/* Lab Readiness Validation */}
          <LabReadiness validation={validation} onValidate={handleValidate} validating={validating} onFix={handleFix} fixing={fixing} />

          {/* Filters + View + Mode (with Config panel on right) */}
          <div className="flex gap-4">
            {/* Left: templates area */}
            <div className="flex-1 space-y-4 min-w-0">
              {/* Control bar */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Lab:</span>
                  {(["all", "sar", "sar-goad"] as const).map((f) => (
                    <button key={f} onClick={() => { setLabFilter(f); setSelectedTemplate(null); }}
                      className={cn("text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors",
                        labFilter === f ? "bg-accent/10 text-accent border-accent/30" : "text-muted-foreground border-border hover:bg-card-hover"
                      )}>{f === "all" ? "All" : f === "sar" ? "SAR" : "SAR + GOAD"}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Mode:</span>
                  {(["template", "custom"] as const).map((m) => (
                    <button key={m} onClick={() => { setInstallMode(m); setSelectedTemplate(null); }}
                      className={cn("text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors",
                        installMode === m ? "bg-accent/10 text-accent border-accent/30" : "text-muted-foreground border-border hover:bg-card-hover"
                      )}>{m === "template" ? "Template" : "Custom"}</button>
                  ))}
                  <span className="text-border mx-1">|</span>
                  <button onClick={() => setViewMode("grid")} className={cn("p-1 rounded", viewMode === "grid" ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground")}><LayoutGrid className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setViewMode("table")} className={cn("p-1 rounded", viewMode === "table" ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground")}><List className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              {/* Selected template detail */}
              {selectedTemplate && installMode === "template" && (
                <TemplateDetail template={selectedTemplate} system={effectiveSystem} tools={tools} selectedTools={selectedTools} onToggleTool={toggleTool} onBack={() => setSelectedTemplate(null)} drives={system?.drives} />
              )}

              {/* Template list */}
              {!selectedTemplate && installMode === "template" && (
                viewMode === "grid" ? (
                  <div className="grid grid-cols-2 gap-3">
                    {onPremTemplates.map((tpl) => (
                      <TemplateCardGrid key={tpl.id} template={tpl} system={effectiveSystem} isBestMatch={tpl.id === bestMatchId} isInstalled={installedTemplateIds.has(tpl.id)} onSelect={() => setSelectedTemplate(tpl)} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <table className="w-full">
                      <thead><tr className="border-b border-border bg-background/50 text-[11px] text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Template</th>
                        <th className="px-3 py-2 text-left font-medium">Type</th>
                        <th className="px-3 py-2 text-left font-medium">Size</th>
                        <th className="px-3 py-2 text-left font-medium">VMs</th>
                        <th className="px-3 py-2 text-left font-medium">RAM</th>
                        <th className="px-3 py-2 text-left font-medium">CPU</th>
                        <th className="px-3 py-2 text-left font-medium">Disk</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                      </tr></thead>
                      <tbody>
                        {onPremTemplates.map((tpl) => (
                          <TemplateTableRow key={tpl.id} template={tpl} system={effectiveSystem} isBestMatch={tpl.id === bestMatchId} isInstalled={installedTemplateIds.has(tpl.id)} onSelect={() => setSelectedTemplate(tpl)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* Custom mode */}
              {installMode === "custom" && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-foreground">Custom Deployment</h3></div>
                  <p className="text-xs text-muted-foreground">Configure and deploy a custom lab. Edit the SAR configuration in the right panel, select VMs and tools below.</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <label className="block"><span className="text-[11px] font-medium text-muted-foreground">Base Lab</span>
                        <select className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                          <option value="sar">SAR (Splunk Attack Range)</option><option value="sar-goad">SAR + GOAD (Active Directory)</option>
                        </select></label>
                      <label className="block"><span className="text-[11px] font-medium text-muted-foreground">Network Subnet</span>
                        <input type="text" defaultValue="10.0.1.0/24" className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground" /></label>
                      <label className="block"><span className="text-[11px] font-medium text-muted-foreground">Splunk Password</span>
                        <input type="password" defaultValue="I-l1ke-Attack-Range!" className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono text-foreground" /></label>
                    </div>
                    <div className="space-y-3">
                      <p className="text-[11px] font-medium text-muted-foreground">Include VMs</p>
                      {["Splunk Server", "Windows Domain Controller", "Windows Server", "Windows Workstation", "Kali Attack Machine"].map((vm) => (
                        <label key={vm} className="flex items-center gap-2 text-xs text-foreground">
                          <input type="checkbox" defaultChecked={["Splunk Server", "Windows Domain Controller"].includes(vm)} className="rounded border-border" /> {vm}
                        </label>
                      ))}
                      <p className="text-[11px] font-medium text-muted-foreground mt-3">Tools</p>
                      {tools.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-xs text-foreground">
                          <input type="checkbox" checked={selectedTools.has(t.id)} onChange={() => toggleTool(t.id)} className="rounded border-border" /> {t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent/10 border border-accent/30 px-4 py-2.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors">
                    <Rocket className="h-3.5 w-3.5" /> Deploy Custom Configuration
                  </button>
                </div>
              )}
            </div>

            {/* Right: Config + Sources panels */}
            <div className="w-80 flex-shrink-0 space-y-4">
              <ConfigPanel config={sarConfig} onSave={handleSaveConfig} />
              <SourcesPanel
                sources={regSources}
                blueprints={blueprints}
                deploys={labDeploys}
                onScan={handleScanBlueprints}
                scanning={scanning}
                drives={system?.drives || []}
                onDeploy={handleBlueprintDeploy}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ CLOUD TAB ═══ */}
      {activeTab === "cloud" && (
        <CloudTab onJumpToOnPrem={() => setActiveTab("on-prem")} />
      )}

      {/* ═══ TOOLS TAB ═══ */}
      {activeTab === "tools" && <ToolsPanel tools={tools} />}
    </div>
  );
}
