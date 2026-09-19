"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, Search,
  Play, Database, Activity, BarChart3,
  Eye, Zap,
} from "lucide-react";

type TabKey = "jobs" | "telemetry" | "logic" | "simulator";

export default function DetectionValidationPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("jobs");

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: "jobs", label: "Validation Jobs", icon: Play },
    { key: "telemetry", label: "Telemetry Explorer", icon: Database },
    { key: "logic", label: "Logic Verification", icon: Eye },
    { key: "simulator", label: "Alert Simulator", icon: BarChart3 },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Detection Validation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            End-to-end validation console — map use cases to simulations, verify telemetry delivery, classify failures, and predict alert volume
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-muted-foreground">Validation Agent</span>
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="text-[10px] text-success font-medium">Online</span>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Play className="h-4 w-4" /> New Job
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Validations", value: "0", sub: "Last 30 days", color: "text-accent" },
          { label: "Confirmed", value: "0", sub: "No data yet", color: "text-success" },
          { label: "No Telemetry", value: "0", sub: "Pipeline gaps", color: "text-danger" },
          { label: "Logic Errors", value: "0", sub: "Rule tuning needed", color: "text-warning" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold text-muted uppercase">{stat.label}</p>
            <p className={cn("text-2xl font-bold mt-1", stat.color)}>{stat.value}</p>
            <p className="text-[10px] text-muted mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const TIcon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === t.key
                  ? "text-accent border-accent"
                  : "text-muted border-transparent hover:text-foreground"
              )}
            >
              <TIcon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab: Validation Jobs */}
      {activeTab === "jobs" && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Play className="h-12 w-12 text-muted mb-4" />
          <p className="text-sm text-muted-foreground text-center max-w-md">
            No validation jobs yet. Create a job to validate detection rules against simulation results.
          </p>
        </div>
      )}

      {/* Tab: Telemetry Explorer */}
      {activeTab === "telemetry" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">Query Splunk REST API or Microsoft Graph to verify if raw signals reached the cloud after simulation execution</p>

          {/* Query input */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <select className="h-9 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:border-input-focus focus:outline-none">
                <option>Splunk REST API</option>
                <option>Microsoft Graph Security</option>
                <option>Microsoft Defender API</option>
              </select>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="index=sysmon EventCode=1 | search ParentImage=*powershell*"
                  className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-3 text-xs font-mono text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
                />
              </div>
              <button className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
                <Zap className="h-3 w-3" /> Execute Query
              </button>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-muted">
              <span>Time range: <strong className="text-foreground">Last 24 hours</strong></span>
              <span>Max results: <strong className="text-foreground">10,000</strong></span>
              <span>Timeout: <strong className="text-foreground">30s</strong></span>
            </div>
          </div>

          {/* Empty query history */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border bg-card-hover px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Recent Queries</span>
            </div>
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No queries executed yet.</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Logic Verification */}
      {activeTab === "logic" && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
          <Eye className="h-12 w-12 text-muted mb-4" />
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Run validations to see failure classification results.
          </p>
        </div>
      )}

      {/* Tab: Alert Simulator */}
      {activeTab === "simulator" && (
        <div className="space-y-4">
          <p className="text-xs text-muted">Predictive analytics — estimate alert frequency based on historical data before deploying rules to production</p>

          {/* Simulation controls */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Prediction Window</p>
                  <select className="mt-1 h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:border-input-focus focus:outline-none">
                    <option>Next 7 days</option>
                    <option>Next 14 days</option>
                    <option>Next 30 days</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Environment</p>
                  <select className="mt-1 h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:border-input-focus focus:outline-none">
                    <option>Production — All Endpoints</option>
                    <option>Staging — Test Group</option>
                    <option>Lab — Attack Range</option>
                  </select>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted uppercase">Alert Threshold</p>
                  <select className="mt-1 h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:border-input-focus focus:outline-none">
                    <option>100 alerts/day (SOC capacity)</option>
                    <option>250 alerts/day</option>
                    <option>500 alerts/day</option>
                  </select>
                </div>
              </div>
              <button className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
                <Activity className="h-3 w-3" /> Run Simulation
              </button>
            </div>
          </div>

          {/* Empty results */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12">
            <BarChart3 className="h-10 w-10 text-muted mb-3" />
            <p className="text-sm text-muted-foreground">No simulation data yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}
