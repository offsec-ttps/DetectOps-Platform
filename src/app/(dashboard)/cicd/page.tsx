"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  CheckCircle,
  Clock,
  Play,
  Settings,
  Rocket,
} from "lucide-react";

export default function CICDPage() {
  const [tab, setTab] = useState<"pipelines" | "integrations">("pipelines");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CI/CD & Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pipeline status for detection rule validation, deployment, and external integrations
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
            <Settings className="h-4 w-4" />
            Configure
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Play className="h-4 w-4" />
            Trigger Run
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Runs (30d)", value: "0", icon: GitBranch, color: "text-accent" },
          { label: "Success Rate", value: "\u2014", icon: CheckCircle, color: "text-success" },
          { label: "Avg Duration", value: "\u2014", icon: Clock, color: "text-muted-foreground" },
          { label: "Deployments", value: "0", icon: Rocket, color: "text-purple" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <s.icon className={cn("h-5 w-5", s.color)} />
              <div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["pipelines", "integrations"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize",
              tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}
          >
            {t === "pipelines" ? "Pipeline Runs" : "Integrations"}
          </button>
        ))}
      </div>

      {tab === "pipelines" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No pipeline runs yet. Configure CI/CD integrations to see pipeline activity.
          </p>
        </div>
      )}

      {tab === "integrations" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No integrations configured. Connect your SIEM, EDR, and source control to enable automated pipelines.
          </p>
        </div>
      )}
    </div>
  );
}
