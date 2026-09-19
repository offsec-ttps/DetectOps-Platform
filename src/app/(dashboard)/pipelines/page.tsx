"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Workflow,
  Database,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  Activity,
  Server,
  Cpu,
  HardDrive,
  RefreshCw,
  Settings,
  BarChart3,
  Zap,
} from "lucide-react";

const pipelines = [
  {
    id: "pl-1",
    name: "Windows Endpoint Telemetry",
    source: "Windows Event Logs + Sysmon",
    processor: "Vector",
    destination: "Splunk HEC",
    status: "healthy",
    eventsPerSec: 2450,
    latencyMs: 12,
    uptime: "99.97%",
    transforms: ["Parse Sysmon XML", "ECS Normalization", "Field Enrichment", "PII Redaction"],
  },
  {
    id: "pl-2",
    name: "Cloud Audit Logs",
    source: "AWS CloudTrail + Azure Activity",
    processor: "Tenzir",
    destination: "Matano (S3/Iceberg)",
    status: "healthy",
    eventsPerSec: 890,
    latencyMs: 45,
    uptime: "99.92%",
    transforms: ["JSON Flatten", "OCSF Mapping", "Geo Enrichment", "Deduplication"],
  },
  {
    id: "pl-3",
    name: "Network Flow Data",
    source: "Zeek + Suricata",
    processor: "Substation",
    destination: "Elastic Security",
    status: "degraded",
    eventsPerSec: 5200,
    latencyMs: 78,
    uptime: "98.45%",
    transforms: ["Flow Aggregation", "ECS Normalization", "Threat Intel Enrichment"],
  },
  {
    id: "pl-4",
    name: "Email Security Events",
    source: "Microsoft 365 Message Trace",
    processor: "Vector",
    destination: "Splunk HEC",
    status: "healthy",
    eventsPerSec: 320,
    latencyMs: 25,
    uptime: "99.99%",
    transforms: ["Header Parsing", "URL Extraction", "Attachment Hash", "ECS Mapping"],
  },
];

const dataLakes = [
  {
    id: "dl-1",
    name: "Matano Security Lake",
    type: "Detection-as-Code Lake",
    storage: "S3 + Apache Iceberg",
    size: "4.2 TB",
    tables: 28,
    detections: 15,
    retention: "365 days hot, unlimited cold",
    status: "online",
    queryCost: "$0.005/GB scanned",
    features: ["Python detections", "OCSF schema", "Auto-partitioning", "Realtime alerts"],
  },
  {
    id: "dl-2",
    name: "Elastic Security Cluster",
    type: "SIEM + Search",
    storage: "Local SSD + S3 Snapshots",
    size: "1.8 TB",
    tables: 42,
    detections: 8,
    retention: "90 days hot, 365 warm",
    status: "online",
    queryCost: "N/A (self-hosted)",
    features: ["KQL queries", "ML anomaly detection", "MITRE mapping", "Case management"],
  },
  {
    id: "dl-3",
    name: "Splunk Enterprise",
    type: "Primary SIEM",
    storage: "Indexer Cluster (3 nodes)",
    size: "12.6 TB",
    tables: 156,
    detections: 45,
    retention: "90 days hot, 365 frozen",
    status: "online",
    queryCost: "License: 500 GB/day",
    features: ["SPL queries", "Notable events", "Adaptive response", "ES Content"],
  },
];

const statusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  healthy: { color: "text-success", icon: CheckCircle, label: "Healthy" },
  degraded: { color: "text-warning", icon: AlertTriangle, label: "Degraded" },
  offline: { color: "text-danger", icon: AlertTriangle, label: "Offline" },
  online: { color: "text-success", icon: CheckCircle, label: "Online" },
};

export default function PipelinesPage() {
  const [tab, setTab] = useState<"pipelines" | "lakes">("pipelines");

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pipelines & Data Lakes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage telemetry pipelines, normalization configs, and security data lake infrastructure
          </p>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
          <Settings className="h-4 w-4" />
          Configure Pipeline
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Active Pipelines", value: "4", icon: Workflow, color: "text-accent" },
          { label: "Events/sec (total)", value: "8,860", icon: Activity, color: "text-success" },
          { label: "Data Lakes", value: "3", icon: Database, color: "text-purple" },
          { label: "Total Storage", value: "18.6 TB", icon: HardDrive, color: "text-warning" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-card-hover p-2">
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["pipelines", "lakes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t
                ? "text-accent border-accent"
                : "text-muted border-transparent hover:text-foreground"
            )}
          >
            {t === "pipelines" ? "Telemetry Pipelines" : "Data Lakes"}
          </button>
        ))}
      </div>

      {tab === "pipelines" && (
        <div className="space-y-4">
          {pipelines.map((pl) => {
            const s = statusConfig[pl.status];
            const SIcon = s.icon;
            return (
              <div key={pl.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-foreground">{pl.name}</h3>
                      <span className={cn("flex items-center gap-1 text-xs font-medium", s.color)}>
                        <SIcon className="h-3.5 w-3.5" />
                        {s.label}
                      </span>
                    </div>
                    {/* Pipeline flow diagram */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                        <Server className="mb-0.5 inline h-3 w-3 mr-1" />
                        {pl.source}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted" />
                      <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-accent font-medium">
                        <Cpu className="mb-0.5 inline h-3 w-3 mr-1" />
                        {pl.processor}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted" />
                      <div className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                        <Database className="mb-0.5 inline h-3 w-3 mr-1" />
                        {pl.destination}
                      </div>
                    </div>
                    {/* Transforms */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pl.transforms.map((t) => (
                        <span key={t} className="rounded-md bg-card-hover px-2 py-0.5 text-[10px] text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Metrics */}
                  <div className="flex gap-6 text-right">
                    <div>
                      <p className="text-lg font-bold text-foreground">{pl.eventsPerSec.toLocaleString()}</p>
                      <p className="text-[10px] text-muted">events/sec</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{pl.latencyMs}ms</p>
                      <p className="text-[10px] text-muted">latency</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{pl.uptime}</p>
                      <p className="text-[10px] text-muted">uptime</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "lakes" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {dataLakes.map((dl) => {
            const s = statusConfig[dl.status];
            const SIcon = s.icon;
            return (
              <div key={dl.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground">{dl.name}</h3>
                  <span className={cn("flex items-center gap-1 text-xs font-medium", s.color)}>
                    <SIcon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-accent font-medium">{dl.type}</p>
                <div className="mt-4 space-y-2">
                  {[
                    { label: "Storage", value: dl.storage },
                    { label: "Size", value: dl.size },
                    { label: "Tables/Indexes", value: String(dl.tables) },
                    { label: "Active Detections", value: String(dl.detections) },
                    { label: "Retention", value: dl.retention },
                    { label: "Query Cost", value: dl.queryCost },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between text-xs">
                      <span className="text-muted">{row.label}</span>
                      <span className="text-muted-foreground font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {dl.features.map((f) => (
                    <span key={f} className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                    <BarChart3 className="mb-0.5 inline h-3 w-3 mr-1" />
                    Query
                  </button>
                  <button className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                    <Settings className="mb-0.5 inline h-3 w-3 mr-1" />
                    Configure
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
