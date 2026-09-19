"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw, History,
} from "lucide-react";

export default function AgenticSyncPage() {
  const [activeTab, setActiveTab] = useState<"targets" | "history">("targets");

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agentic Sync</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatically update GitHub coverage maps, version control files, and rule bundles via Reporter Agent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
            <History className="h-3 w-3" /> View Git Log
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <RefreshCw className="h-4 w-4" /> Sync All
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Sync Targets", value: "0", color: "text-foreground" },
          { label: "Up to Date", value: "0", color: "text-success" },
          { label: "Pending Changes", value: "0", color: "text-warning" },
          { label: "Errors", value: "0", color: "text-danger" },
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
          { key: "targets" as const, label: "Sync Targets" },
          { key: "history" as const, label: "Sync History" },
        ]).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "targets" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No sync targets configured. Add GitHub repositories and rule bundles to enable automated synchronization.
          </p>
        </div>
      )}

      {activeTab === "history" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                {["Action", "Targets", "Success", "Failed", "Duration", "Triggered By", "Timestamp"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No sync operations recorded yet.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
