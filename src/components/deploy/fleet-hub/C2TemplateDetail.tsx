"use client";

/**
 * C2 framework template detail — the deploy flow for one catalog entry.
 *
 * Shows prerequisites, configuration options, resource requirements, and docs,
 * plus a deploy section whose shape depends on the entry's deploy method:
 *   • provider/docker + available → an Automated deploy CTA (opens the deploy
 *     form) when self-hosted; a hint otherwise.
 *   • manual → guided step-by-step instructions aligned to the C2 Matrix how-to.
 *   • none (commercial) → detection opportunities + "configuration coming soon".
 */

import { useState } from "react";
import {
  X, ExternalLink, Server, Cpu, HardDrive, MemoryStick, Network, ShieldCheck,
  Terminal, BookOpen, AlertTriangle, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { C2CatalogEntry } from "@/config/c2-catalog";

type Tab = "automated" | "guided";

export default function C2TemplateDetail({
  entry, localDeploy, onClose, onDeploy, onConnect,
}: {
  entry: C2CatalogEntry;
  localDeploy: boolean;
  onClose: () => void;
  onDeploy: (entry: C2CatalogEntry) => void;
  onConnect: (entry: C2CatalogEntry) => void;
}) {
  const method = entry.deploy.method;
  const autoDeployable = (method === "provider" || method === "docker") && entry.deploy.available;
  const hasGuided = method === "manual" && !!entry.deploy.guidedSteps?.length;
  const [tab, setTab] = useState<Tab>(autoDeployable ? "automated" : "guided");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-foreground">{entry.name}</h3>
              <Badge tone={entry.category === "commercial" ? "warning" : entry.category === "caldera" ? "accent" : "muted"}>
                {entry.category === "caldera" ? "Caldera" : entry.category === "commercial" ? "Commercial" : "Open-source"}
              </Badge>
              {entry.language && <span className="text-[10px] text-muted-foreground">{entry.language}</span>}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{entry.description}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0"><X className="h-4 w-4" /></button>
        </div>

        {/* Doc links + platforms */}
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          {entry.repo && <a href={entry.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink className="h-3 w-3" /> Repository</a>}
          <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><BookOpen className="h-3 w-3" /> Docs</a>
          {entry.c2MatrixUrl && <a href={entry.c2MatrixUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink className="h-3 w-3" /> C2 Matrix how-to</a>}
          <span className="ml-auto text-muted-foreground">Agents: {entry.platforms.join(" · ")}</span>
        </div>

        {/* Prerequisites + Resources */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[11px] font-semibold text-foreground mb-1.5">Prerequisites</p>
            <ul className="space-y-1">
              {entry.prerequisites.map((p, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5"><span className="text-accent mt-0.5">•</span>{p}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[11px] font-semibold text-foreground mb-1.5">Resource requirements</p>
            <div className="grid grid-cols-2 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Cpu className="h-3 w-3" /> {entry.resources.cpus} vCPU</span>
              <span className="inline-flex items-center gap-1.5"><MemoryStick className="h-3 w-3" /> {(entry.resources.memoryMB / 1024).toFixed(entry.resources.memoryMB % 1024 ? 1 : 0)} GB RAM</span>
              <span className="inline-flex items-center gap-1.5"><HardDrive className="h-3 w-3" /> {entry.resources.diskGB} GB disk</span>
              <span className="inline-flex items-center gap-1.5"><Network className="h-3 w-3" /> {entry.resources.ports.length ? entry.resources.ports.join(", ") : "n/a"}</span>
            </div>
          </div>
        </div>

        {/* Configuration options */}
        {entry.configOptions.length > 0 && (
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[11px] font-semibold text-foreground mb-1.5">Configuration options</p>
            <div className="space-y-1.5">
              {entry.configOptions.map((o) => (
                <div key={o.key} className="text-[11px]">
                  <span className="font-mono text-foreground">{o.label}</span>
                  {o.default && <span className="ml-1.5 text-[10px] text-muted-foreground">default: {o.default}</span>}
                  <p className="text-muted-foreground">{o.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deploy method tabs */}
        {(autoDeployable || hasGuided) && (
          <div className="flex gap-1 border-b border-border">
            {autoDeployable && <TabBtn active={tab === "automated"} onClick={() => setTab("automated")}><Server className="h-3 w-3" /> Automated</TabBtn>}
            {hasGuided && <TabBtn active={tab === "guided"} onClick={() => setTab("guided")}><Terminal className="h-3 w-3" /> Custom / Guided</TabBtn>}
          </div>
        )}

        {/* Automated deploy */}
        {tab === "automated" && autoDeployable && (
          <div className="space-y-2.5">
            <p className="text-[11px] text-muted-foreground">
              {method === "provider"
                ? "Deploy or connect a standalone server on this host; enroll beacons and run techniques straight from the Campaign Designer."
                : "Stand up this framework in Docker on this host. Once running, open its console to generate traffic and forward telemetry to your SIEM."}
            </p>
            {!localDeploy && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Managed deploy runs on self-hosted installs only (set PLATFORM_MODE=self-hosted).
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDeploy(entry)}
                disabled={!localDeploy}
                className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
              >
                <Server className="h-3.5 w-3.5" /> Deploy {entry.name}
              </button>
              {method === "provider" && (
                <button onClick={() => onConnect(entry)} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded border border-border text-foreground hover:bg-card-hover">
                  <Radio className="h-3.5 w-3.5" /> Connect existing
                </button>
              )}
            </div>
          </div>
        )}

        {/* Guided / manual */}
        {tab === "guided" && hasGuided && (
          <div className="space-y-2">
            <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Automated deploy for {entry.name} is coming soon. For now, deploy it manually in your lab using the steps below and the C2 Matrix how-to.
            </div>
            <ol className="space-y-1.5">
              {entry.deploy.guidedSteps!.map((s, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
                  <span className="shrink-0 h-4 w-4 rounded-full bg-accent/15 text-accent text-[9px] font-bold inline-flex items-center justify-center">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Commercial / template-only */}
        {method === "none" && (
          <div className="space-y-2.5">
            <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Template only — configuration and deployment support are coming in a future phase. This is a commercial, licensed framework; DetectOps does not deploy it.
            </div>
            {entry.detectionOpportunities && entry.detectionOpportunities.length > 0 && (
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-[11px] font-semibold text-foreground mb-1.5 inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-success" /> Detection opportunities</p>
                <ul className="space-y-1">
                  {entry.detectionOpportunities.map((d, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5"><span className="text-success mt-0.5">•</span>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "accent" | "warning" | "muted" }) {
  const c = tone === "accent" ? "border-accent/40 text-accent" : tone === "warning" ? "border-warning/40 text-warning" : "border-border text-muted-foreground";
  return <span className={cn("text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border", c)}>{children}</span>;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px", active ? "text-accent border-accent" : "text-muted-foreground border-transparent hover:text-foreground")}>
      {children}
    </button>
  );
}
