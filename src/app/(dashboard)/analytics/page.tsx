"use client";

import React from "react";
import { BarChart3, TrendingUp, Clock, Shield, Target, Gauge } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Executive dashboard tracking Detection Reliability (R<sub>d</sub>), Mean Time to Implement (MTTI), and MITRE ATT&CK coverage heatmaps
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: Gauge, label: "Detection Reliability (Rd)", value: "\u2014", sub: "No data yet", color: "text-muted" },
          { icon: Clock, label: "Mean Time to Implement", value: "\u2014", sub: "No data yet", color: "text-muted" },
          { icon: Target, label: "MITRE Coverage", value: "\u2014", sub: "No data yet", color: "text-muted" },
          { icon: TrendingUp, label: "Rules in Production", value: "\u2014", sub: "No data yet", color: "text-muted" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
              <p className="text-[10px] font-semibold text-muted uppercase">{kpi.label}</p>
            </div>
            <p className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-muted mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* MITRE Coverage Heatmap */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">MITRE ATT&CK Coverage Heatmap</h2>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" /> &lt;50%</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" /> 50–74%</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-success" /> ≥75%</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="h-10 w-10 text-muted mb-3" />
          <p className="text-sm text-muted-foreground">
            No coverage data available. Analytics will populate once detection validation pipelines and SIEM connectors are configured.
          </p>
        </div>
      </div>

      {/* Monthly Trend */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Monthly Detection Metrics</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted mb-3" />
          <p className="text-sm text-muted-foreground">
            No monthly trend data yet. Metrics will appear here as detections are created and validated.
          </p>
        </div>
      </div>
    </div>
  );
}
