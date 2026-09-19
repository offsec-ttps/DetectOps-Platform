"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Server,
  Monitor,
  Cloud,
  Shield,
  GitBranch,
  Database,
  ArrowRight,
  Plus,
  Crosshair,
  Lock,
} from "lucide-react";

export default function ThreatModelingPage() {
  const [tab, setTab] = useState<"assets" | "models" | "matrix">("assets");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Threat Modeling & ATT&CK Mapping</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Map organizational assets to MITRE ATT&CK techniques and prioritize attack paths
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
            <Plus className="h-4 w-4" /> Add Asset
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Crosshair className="h-4 w-4" /> New Threat Model
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["assets", "models", "matrix"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize",
              tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}
          >
            {t === "models" ? "Threat Models" : t === "matrix" ? "ATT&CK Matrix" : "Assets"}
          </button>
        ))}
      </div>

      {/* Assets */}
      {tab === "assets" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Server className="h-10 w-10 text-muted mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">
            No assets configured. Add organizational assets to begin threat modeling.
          </p>
        </div>
      )}

      {/* Threat Models */}
      {tab === "models" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Crosshair className="h-10 w-10 text-muted mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">
            No threat models created yet.
          </p>
        </div>
      )}

      {/* ATT&CK Matrix */}
      {tab === "matrix" && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Shield className="h-10 w-10 text-muted mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">
            Configure assets and threat models to generate the ATT&CK coverage matrix.
          </p>
        </div>
      )}
    </div>
  );
}
