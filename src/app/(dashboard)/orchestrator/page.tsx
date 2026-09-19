"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Orbit, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Settings2, Shield, Key, Globe, Layers, ArrowRight,
  AlertTriangle, Activity, Server, Database, Lock,
  ChevronDown, ChevronRight, Play, Pause, Eye,
} from "lucide-react";

type ServiceStatus = "healthy" | "degraded" | "down" | "maintenance";

interface CoreService {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  endpoint: string;
  lastReconcile: string;
  reconcileInterval: string;
  version: string;
  uptime: string;
}

interface DeploySecret {
  id: string;
  name: string;
  scope: string;
  type: "api_key" | "token" | "certificate" | "password";
  target: string;
  lastRotated: string;
  expiresAt: string;
  status: "active" | "expiring_soon" | "expired";
}

const services: CoreService[] = [
  {
    id: "svc-1", name: "CoreTide Reconciler", description: "Cross-platform state reconciliation engine — keeps Splunk, MDE, and Git in sync",
    status: "healthy", endpoint: "http://coretide:8080/api/v1/reconcile",
    lastReconcile: "2026-03-28 14:58", reconcileInterval: "5m", version: "2.4.1", uptime: "14d 6h",
  },
  {
    id: "svc-2", name: "Splunk Deployment Server", description: "Manages detection rule distribution to Splunk search heads via REST API",
    status: "healthy", endpoint: "https://splunk.internal:8089",
    lastReconcile: "2026-03-28 14:55", reconcileInterval: "10m", version: "9.2.0", uptime: "30d 2h",
  },
  {
    id: "svc-3", name: "MDE Graph Connector", description: "Microsoft Defender for Endpoint custom detection rule deployment via Graph API",
    status: "degraded", endpoint: "https://graph.microsoft.com/v1.0/security",
    lastReconcile: "2026-03-28 14:40", reconcileInterval: "15m", version: "1.2.0", uptime: "7d 18h",
  },
  {
    id: "svc-4", name: "Tenzir Pipeline Engine", description: "Log transformation and surgical data routing for telemetry normalization",
    status: "healthy", endpoint: "http://tenzir:5158/api/v1",
    lastReconcile: "2026-03-28 14:57", reconcileInterval: "1m", version: "4.6.0", uptime: "22d 10h",
  },
  {
    id: "svc-5", name: "Matano Data Lake", description: "AWS S3/Iceberg security data lake for long-term telemetry replay",
    status: "healthy", endpoint: "s3://matano-lake-prod/",
    lastReconcile: "2026-03-28 14:50", reconcileInterval: "30m", version: "1.0.3", uptime: "45d 0h",
  },
  {
    id: "svc-6", name: "GitHub Actions Runner", description: "Self-hosted CI/CD runner for detection rule validation and deployment",
    status: "maintenance", endpoint: "https://github.com/acme-corp/detection-rules/actions",
    lastReconcile: "2026-03-28 12:00", reconcileInterval: "—", version: "2.314.1", uptime: "—",
  },
];

const secrets: DeploySecret[] = [
  { id: "sec-1", name: "SPLUNK_HEC_TOKEN", scope: "production", type: "token", target: "Splunk HTTP Event Collector", lastRotated: "2026-03-15", expiresAt: "2026-06-15", status: "active" },
  { id: "sec-2", name: "MDE_CLIENT_SECRET", scope: "production", type: "password", target: "Microsoft Defender for Endpoint", lastRotated: "2026-02-01", expiresAt: "2026-04-01", status: "expiring_soon" },
  { id: "sec-3", name: "GITHUB_PAT", scope: "ci/cd", type: "token", target: "GitHub API", lastRotated: "2026-03-01", expiresAt: "2026-09-01", status: "active" },
  { id: "sec-4", name: "AWS_MATANO_ACCESS_KEY", scope: "production", type: "api_key", target: "AWS S3 / Matano Lake", lastRotated: "2026-01-10", expiresAt: "2027-01-10", status: "active" },
  { id: "sec-5", name: "TENZIR_API_KEY", scope: "production", type: "api_key", target: "Tenzir Pipeline Engine", lastRotated: "2026-03-20", expiresAt: "2026-06-20", status: "active" },
  { id: "sec-6", name: "CALDERA_API_KEY", scope: "testing", type: "api_key", target: "CALDERA C2 Server", lastRotated: "2026-02-28", expiresAt: "2026-05-28", status: "active" },
];

const serviceStatusConfig: Record<ServiceStatus, { label: string; color: string; icon: React.ElementType }> = {
  healthy: { label: "Healthy", color: "text-success bg-success/10 border-success/30", icon: CheckCircle2 },
  degraded: { label: "Degraded", color: "text-warning bg-warning/10 border-warning/30", icon: AlertTriangle },
  down: { label: "Down", color: "text-danger bg-danger/10 border-danger/30", icon: XCircle },
  maintenance: { label: "Maintenance", color: "text-muted bg-muted/10 border-border", icon: Settings2 },
};

const secretStatusColors: Record<string, string> = {
  active: "text-success bg-success/10 border-success/30",
  expiring_soon: "text-warning bg-warning/10 border-warning/30",
  expired: "text-danger bg-danger/10 border-danger/30",
};

export default function OrchestratorPage() {
  const [activeTab, setActiveTab] = useState<"services" | "secrets">("services");
  const [expandedService, setExpandedService] = useState<string | null>("svc-1");

  const healthyCount = services.filter((s) => s.status === "healthy").length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">OpenTide Orchestrator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            CoreTide backend reconciliation, cross-platform deployment services, and secret management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
            <Activity className="h-3 w-3" /> Health Check
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <RefreshCw className="h-4 w-4" /> Reconcile All
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Services", value: String(services.length), color: "text-foreground" },
          { label: "Healthy", value: String(healthyCount), color: "text-success" },
          { label: "Secrets Managed", value: String(secrets.length), color: "text-accent" },
          { label: "Expiring Soon", value: String(secrets.filter((s) => s.status === "expiring_soon").length), color: "text-warning" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "services" as const, label: "Backend Services", icon: Server },
          { key: "secrets" as const, label: "Deployment Secrets", icon: Key },
        ]).map((t) => {
          const TIcon = t.icon;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={cn("flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
              )}>
              <TIcon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "services" && (
        <div className="space-y-3">
          {services.map((svc) => {
            const st = serviceStatusConfig[svc.status];
            const StIcon = st.icon;
            const isExpanded = expandedService === svc.id;
            return (
              <div key={svc.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedService(isExpanded ? null : svc.id)}
                  className="flex w-full items-center justify-between px-5 py-4 hover:bg-card-hover transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                    <div className="text-left">
                      <p className="text-sm font-semibold text-foreground">{svc.name}</p>
                      <p className="text-[10px] text-muted mt-0.5">{svc.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-muted">v{svc.version}</span>
                    <span className={cn("flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold", st.color)}>
                      <StIcon className="h-3 w-3" /> {st.label}
                    </span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-border px-5 py-4">
                    <div className="grid grid-cols-4 gap-4 mb-4">
                      {[
                        { label: "Endpoint", value: svc.endpoint },
                        { label: "Last Reconcile", value: svc.lastReconcile },
                        { label: "Interval", value: svc.reconcileInterval },
                        { label: "Uptime", value: svc.uptime },
                      ].map((d) => (
                        <div key={d.label}>
                          <p className="text-[10px] font-semibold text-muted uppercase">{d.label}</p>
                          <p className="text-xs text-foreground mt-0.5 font-mono">{d.value}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 pt-3 border-t border-border">
                      <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                        <RefreshCw className="h-3 w-3" /> Force Reconcile
                      </button>
                      <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                        <Eye className="h-3 w-3" /> View Logs
                      </button>
                      <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                        <Settings2 className="h-3 w-3" /> Configure
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "secrets" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Manage deployment secrets and API keys for cross-platform SIEM/EDR connectors</p>
            <button className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
              <Key className="h-3 w-3" /> Add Secret
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-card-hover">
                  {["Secret Name", "Scope", "Type", "Target Service", "Last Rotated", "Expires", "Status", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {secrets.map((sec) => (
                  <tr key={sec.id} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-medium text-foreground">
                        <Lock className="h-3 w-3 text-muted" /> {sec.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">{sec.scope}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sec.type.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sec.target}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sec.lastRotated}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{sec.expiresAt}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", secretStatusColors[sec.status])}>
                        {sec.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="text-xs text-accent hover:text-accent/80 transition-colors">Rotate</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Expiring warning */}
          {secrets.some((s) => s.status === "expiring_soon") && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Secret Rotation Required</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <strong>MDE_CLIENT_SECRET</strong> expires on 2026-04-01. Rotate this credential before expiry to prevent deployment failures.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted italic">Placeholder view. Full CoreTide backend reconciliation and cross-platform deployment integration will be configured when infrastructure connectors are set up.</p>
    </div>
  );
}
