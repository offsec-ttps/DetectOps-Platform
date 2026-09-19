"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Check, Loader2, X, Minus, Circle } from "lucide-react";

export interface PipelineStep {
  agent: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
}

const STATUS_DOT: Record<PipelineStep["status"], React.ReactNode> = {
  completed: <Check className="h-3 w-3 text-success" />,
  running: <Loader2 className="h-3 w-3 text-accent animate-spin" />,
  failed: <X className="h-3 w-3 text-danger" />,
  skipped: <Minus className="h-3 w-3 text-muted" />,
  pending: <Circle className="h-2.5 w-2.5 text-muted" />,
};

export function AgentTimeline({ steps }: { steps: PipelineStep[] }) {
  if (!steps?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Agent pipeline</div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.agent} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                s.status === "completed" && "border-success/40 bg-success/10",
                s.status === "running" && "border-accent/40 bg-accent/10 agent-active",
                s.status === "failed" && "border-danger/40 bg-danger/10",
                s.status === "skipped" && "border-border bg-card",
                s.status === "pending" && "border-border bg-card",
              )}
            >
              {STATUS_DOT[s.status]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-medium",
                  s.status === "pending" || s.status === "skipped" ? "text-muted-foreground" : "text-foreground",
                )}>
                  <span className="text-[10px] text-muted mr-1">{i + 1}.</span>{s.label}
                </span>
              </div>
              {s.summary && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.summary}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
