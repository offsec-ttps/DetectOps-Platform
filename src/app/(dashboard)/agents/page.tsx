"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Code2, FlaskConical, CheckCircle, FileText, Bot, Play, Pause, Clock,
  ChevronDown, ChevronUp, ArrowRight, Activity, AlertTriangle, Settings,
  RefreshCw, Loader2, Zap, MoreHorizontal, XCircle,
} from "lucide-react";

const agents = [
  {
    id: "developer",
    name: "Developer Agent",
    icon: Code2,
    color: "text-accent",
    bg: "bg-accent/10 border-accent/30",
    description: "Generates and refines Sigma detection rules from threat intel, ATT&CK mappings, and use case requirements",
    capabilities: ["Sigma rule generation", "SPL/KQL translation", "False positive tuning", "Rule optimization"],
  },
  {
    id: "simulation",
    name: "Simulation Agent",
    icon: FlaskConical,
    color: "text-purple",
    bg: "bg-purple/10 border-purple/30",
    description: "Executes adversary emulation tests via Atomic Red Team and CALDERA against lab environments",
    capabilities: ["ART test execution", "CALDERA profile deployment", "Lab orchestration", "Telemetry collection"],
  },
  {
    id: "validation",
    name: "Validation Agent",
    icon: CheckCircle,
    color: "text-success",
    bg: "bg-success/10 border-success/30",
    description: "Validates detection rules against Splunk and MDE, confirming alerts fire correctly with expected fidelity",
    capabilities: ["Splunk alert validation", "MDE hunting query check", "False positive analysis", "Rd score calculation"],
  },
  {
    id: "reporter",
    name: "Reporter Agent",
    icon: FileText,
    color: "text-warning",
    bg: "bg-warning/10 border-warning/30",
    description: "Generates LOCK documents, updates coverage matrices, and produces detection engineering reports",
    capabilities: ["LOCK document generation", "Coverage matrix updates", "Metric snapshots", "Stakeholder reports"],
  },
];

const agentConfigs = [
  { agent: "Developer", model: "Not configured", maxRetries: "Not configured", autoApprove: "Not configured", sigmaVersion: "Not configured", outputFormat: "Not configured" },
  { agent: "Simulation", framework: "Not configured", defaultLab: "Not configured", timeout: "Not configured", requireApproval: "Not configured", cleanupAfter: "Not configured" },
  { agent: "Validation", platforms: "Not configured", rdThreshold: "Not configured", fpThreshold: "Not configured", alertWindow: "Not configured", retryOnFail: "Not configured" },
  { agent: "Reporter", templateFormat: "Not configured", autoPublish: "Not configured", includeEvidence: "Not configured", notifySlack: "Not configured", coverageRefresh: "Not configured" },
];

const agentColor: Record<string, string> = {
  Developer: "text-accent",
  Simulation: "text-purple",
  Validation: "text-success",
  Reporter: "text-warning",
};

interface AgentStep { agent: string; label: string; status: string; output: string | null; }
interface AgentRun { id: string; name: string; status: string; duration: string; costUsd: number; completedAt: string | null; steps: AgentStep[]; }

const stepStatusDot: Record<string, string> = {
  completed: "bg-success", running: "bg-accent animate-pulse", failed: "bg-danger", skipped: "bg-muted", pending: "bg-muted/40",
};

export default function AgentsPage() {
  const [tab, setTab] = useState<"overview" | "workflows" | "config">("overview");
  const [runs, setRuns] = useState<AgentRun[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => fetch("/api/agents").then((r) => r.json()).then((d) => { if (active) setRuns(d.agentRuns || []); }).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agentic Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Orchestrate Developer, Simulation, Validation, and Reporter agents across the detection lifecycle
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
            <Settings className="h-4 w-4" /> Configure
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Zap className="h-4 w-4" /> Trigger Workflow
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["overview", "workflows", "config"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px", tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground")}>
            {t === "overview" ? "Agent Overview" : t === "workflows" ? "Workflow Runs" : "Configuration"}
          </button>
        ))}
      </div>

      {/* Agent Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {agents.map((agent) => (
              <div key={agent.id} className={cn("rounded-xl border p-4", agent.bg)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <agent.icon className={cn("h-5 w-5", agent.color)} />
                    <h3 className="font-semibold text-foreground text-sm">{agent.name}</h3>
                  </div>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted" /> Idle
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{agent.description}</p>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">Last run</span>
                    <span className="text-muted-foreground font-medium">&mdash;</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">Runs today</span>
                    <span className="text-muted-foreground font-medium">0</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">Success rate</span>
                    <span className="text-muted font-medium">&mdash;</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">Avg duration</span>
                    <span className="text-muted-foreground font-medium">&mdash;</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-[10px] font-semibold text-muted mb-1.5">Capabilities</p>
                  <div className="flex flex-wrap gap-1">
                    {agent.capabilities.map((c) => (
                      <span key={c} className="rounded bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">{c}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pipeline visualization */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Agent Pipeline Flow</h3>
            <div className="flex items-center justify-center gap-3">
              {[
                { name: "Threat Intel / Use Case", icon: AlertTriangle, color: "text-info", bg: "bg-info/10 border-info/30" },
                { name: "Developer Agent", icon: Code2, color: "text-accent", bg: "bg-accent/10 border-accent/30" },
                { name: "Simulation Agent", icon: FlaskConical, color: "text-purple", bg: "bg-purple/10 border-purple/30" },
                { name: "Validation Agent", icon: CheckCircle, color: "text-success", bg: "bg-success/10 border-success/30" },
                { name: "Reporter Agent", icon: FileText, color: "text-warning", bg: "bg-warning/10 border-warning/30" },
                { name: "Production Deploy", icon: Zap, color: "text-success", bg: "bg-success/10 border-success/30" },
              ].map((step, i) => (
                <React.Fragment key={step.name}>
                  {i > 0 && <ArrowRight className="h-4 w-4 text-muted shrink-0" />}
                  <div className={cn("rounded-lg border px-4 py-3 text-center min-w-[130px]", step.bg)}>
                    <step.icon className={cn("h-5 w-5 mx-auto", step.color)} />
                    <p className="mt-1.5 text-xs font-medium text-foreground">{step.name}</p>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Workflows Today", value: "0", icon: <Bot className="h-5 w-5 text-accent" /> },
              { label: "Success Rate", value: "\u2014", icon: <CheckCircle className="h-5 w-5 text-success" /> },
              { label: "Avg Pipeline Duration", value: "\u2014", icon: <Clock className="h-5 w-5 text-muted-foreground" /> },
              { label: "Rules Generated", value: "0", icon: <Code2 className="h-5 w-5 text-purple" /> },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                {m.icon}
                <p className="mt-2 text-2xl font-bold text-foreground">{m.value}</p>
                <p className="text-xs text-muted">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workflow Runs */}
      {tab === "workflows" && (
        runs.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Bot className="h-10 w-10 text-muted mx-auto" />
            <p className="mt-4 text-sm text-muted-foreground">
              No workflow runs yet. Start an analysis in <Link href="/sigmagen" className="text-accent hover:underline">SigmaGen AI</Link> to see agent execution history.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-accent" />
                    <h3 className="text-sm font-semibold text-foreground">{run.name}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {run.duration && <span className="flex items-center gap-1 text-muted"><Clock className="h-3 w-3" /> {run.duration}</span>}
                    {run.costUsd > 0 && <span className="text-muted">${run.costUsd.toFixed(4)}</span>}
                    <span className={cn("flex items-center gap-1.5 font-medium",
                      run.status === "completed" ? "text-success" : run.status === "failed" ? "text-danger" : "text-accent")}>
                      {run.status === "completed" ? <CheckCircle className="h-3.5 w-3.5" /> : run.status === "failed" ? <XCircle className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {run.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {run.steps.map((s) => (
                    <div key={s.agent} className="flex items-start gap-2 text-xs">
                      <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", stepStatusDot[s.status] || "bg-muted/40")} />
                      <span className="w-44 shrink-0 text-muted-foreground">{s.label}</span>
                      <span className="flex-1 text-muted">{s.output || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Configuration */}
      {tab === "config" && (
        <div className="space-y-4">
          {agentConfigs.map((cfg) => (
            <div key={cfg.agent} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className={cn("text-sm font-semibold", agentColor[cfg.agent])}>{cfg.agent} Agent Configuration</h3>
                <button className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-card-hover">Edit</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {Object.entries(cfg).filter(([k]) => k !== "agent").map(([key, value]) => (
                  <div key={key} className="flex justify-between text-xs">
                    <span className="text-muted capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="text-muted-foreground font-medium">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <h3 className="text-sm font-semibold text-foreground">Workflow Settings</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="flex justify-between"><span className="text-muted">Pipeline timeout</span><span className="text-muted-foreground font-medium">Not configured</span></div>
              <div className="flex justify-between"><span className="text-muted">Max concurrent workflows</span><span className="text-muted-foreground font-medium">Not configured</span></div>
              <div className="flex justify-between"><span className="text-muted">Auto-retry on failure</span><span className="text-muted-foreground font-medium">Not configured</span></div>
              <div className="flex justify-between"><span className="text-muted">Require approval for CALDERA</span><span className="text-muted-foreground font-medium">Not configured</span></div>
              <div className="flex justify-between"><span className="text-muted">Notification channel</span><span className="text-muted-foreground font-medium">Not configured</span></div>
              <div className="flex justify-between"><span className="text-muted">Auto-deploy on Rd &gt; 0.8</span><span className="text-muted-foreground font-medium">Not configured</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
