"use client";

import React from "react";
import { Database, ArrowRight } from "lucide-react";

export default function DataLakesPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Data Lakes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure and manage security data lake storage for long-term telemetry retention and historical replay capabilities
        </p>
      </div>

      {/* Empty state for lakes */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
        <Database className="h-12 w-12 text-muted mb-4" />
        <p className="text-sm text-muted-foreground text-center max-w-md">
          No data lakes configured. Connect your security data lake to enable long-term telemetry storage and historical replay.
        </p>
      </div>

      {/* Replay Jobs */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-card-hover px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Replay Jobs</span>
            <span className="text-xs text-muted">Historical data replay for detection backtesting</span>
          </div>
          <button className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
            New Replay Job <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No replay jobs yet.</p>
        </div>
      </div>
    </div>
  );
}
