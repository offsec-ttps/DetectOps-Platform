"use client";

/**
 * Deploy hub — the single front door for standing up a simulation environment.
 * One clean chooser: Cloud Lab (user's cloud) · Remote Fleet (user's endpoints)
 * · Local Lab (self-hosted/dev VirtualBox). Reuses the existing cloud + local
 * deploy machinery; Local is gated to self-hosted installs.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cloud, Cpu, Server, Rocket, ChevronLeft, ChevronRight, Loader2, ShieldCheck, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import CloudTab from "@/components/detection-lab/cloud/CloudTab";
import LocalDeployFlow from "@/components/deploy/LocalDeployFlow";
import CloudRegisterPanel from "@/components/deploy/CloudRegisterPanel";
import CloudReadinessPanel from "@/components/deploy/CloudReadinessPanel";
import CloudTemplatesPanel from "@/components/deploy/CloudTemplatesPanel";
import FleetSimulationHub from "@/components/deploy/fleet-hub/FleetSimulationHub";

type View = "chooser" | "cloud" | "local" | "fleet";

export default function DeployHubPage() {
  const [view, setView] = useState<View>("chooser");
  const [localAvailable, setLocalAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/deploy/capabilities").then((r) => r.json()).then((d) => setLocalAvailable(!!d.localAvailable)).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  // Deep-link support: /deploy?view=local|cloud|fleet opens that flow directly
  // (used by the "Manage" links in the Campaign Designer's Active Environments).
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("view");
      if (v === "local" || v === "cloud" || v === "fleet") setView(v);
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Rocket className="h-6 w-6 text-accent" /> Deploy
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Stand up a simulation environment — in your cloud, on your endpoints, or locally — then simulate &amp; score detection.</p>
        </div>
        {view !== "chooser" && (
          <button onClick={() => setView("chooser")} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> All options</button>
        )}
      </div>

      {view === "chooser" && (
        <>
          {/* Deploy a Lab — stand up a self-contained range only */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Deploy a Lab</p>
              <p className="text-xs text-muted-foreground mt-0.5">Stand up a self-contained range to run techniques against and score detection.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChooserCard
                Icon={Server} tone="muted" title="Local Lab" badge={localAvailable ? "self-hosted" : "self-hosted only"}
                desc="Spin up VirtualBox/Vagrant VMs on this host. Best for self-hosted installs and local evaluation."
                disabled={loaded && !localAvailable}
                disabledNote="Available on self-hosted installs (set PLATFORM_MODE=self-hosted)."
                onClick={() => setView("local")} />
              <ChooserCard
                Icon={Cloud} tone="info" title="Cloud Lab" badge="recommended for SaaS"
                desc="Deploy Splunk Attack Range / GOAD into your own cloud account (AWS, Azure, GCP) using your API keys. Scales per tenant."
                onClick={() => setView("cloud")} />
            </div>
          </div>

          {/* Adversary Simulation — run techniques against your own endpoints */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">Adversary Simulation</p>
              <p className="text-xs text-muted-foreground mt-0.5">Run Atomic Red Team techniques against your own endpoints and score detection in real time.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChooserCard
                Icon={Cpu} tone="accent" title="Remote Fleet" badge="recommended for SaaS"
                desc="Install a lightweight signed agent on your own endpoints, then run Atomic Red Team techniques and score detection in real time."
                onClick={() => setView("fleet")} />
            </div>
          </div>

          {/* Flow reminder */}
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-foreground font-medium"><Rocket className="h-3.5 w-3.5 text-accent" /> Deploy</span>
              <ChevronRight className="h-3 w-3" />
              <span className="inline-flex items-center gap-1.5"><Radar className="h-3.5 w-3.5 text-accent" /> Simulate</span>
              <ChevronRight className="h-3 w-3" />
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-purple" /> Score detection</span>
              <span className="ml-2">— deployed environments auto-register as simulation targets.</span>
            </div>
          </div>
        </>
      )}

      {view === "cloud" && <div className="space-y-4"><CloudReadinessPanel /><CloudTemplatesPanel /><CloudTab onJumpToOnPrem={() => setView(localAvailable ? "local" : "chooser")} /><CloudRegisterPanel /></div>}
      {view === "local" && <LocalDeployFlow />}
      {/* Fleet Simulation hub: C2 options catalog + C2 servers + native fleets. */}
      {view === "fleet" && <FleetSimulationHub />}
    </div>
  );
}

function ChooserCard({ Icon, title, desc, badge, tone, onClick, href, disabled, disabledNote }: {
  Icon: any; title: string; desc: string; badge?: string; tone: "info" | "accent" | "muted";
  onClick?: () => void; href?: string; disabled?: boolean; disabledNote?: string;
}) {
  const toneCls = tone === "info" ? "text-info" : tone === "accent" ? "text-accent" : "text-muted-foreground";
  const inner = (
    <div className={cn("h-full rounded-xl border bg-card p-5 transition-all flex flex-col",
      disabled ? "border-border opacity-60" : "border-border hover:border-accent/40 hover:bg-card-hover cursor-pointer")}>
      <div className="flex items-center justify-between">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg bg-muted/10", toneCls)}><Icon className="h-5 w-5" /></div>
        {badge && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-border text-muted-foreground">{badge}</span>}
      </div>
      <h3 className="text-sm font-semibold text-foreground mt-3">{title}</h3>
      <p className="text-[11px] text-muted-foreground mt-1 flex-1">{desc}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-accent">
        {disabled ? <span className="text-muted-foreground">{disabledNote}</span> : <>Choose <ChevronRight className="h-3.5 w-3.5" /></>}
      </div>
    </div>
  );
  if (disabled) return <div>{inner}</div>;
  if (href) return <Link href={href}>{inner}</Link>;
  return <button onClick={onClick} className="text-left">{inner}</button>;
}
