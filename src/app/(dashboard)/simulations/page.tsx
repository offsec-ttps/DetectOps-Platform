"use client";

/**
 * Simulations landing — a grid of simulation categories (Ransomware, LOTL,
 * Phishing, …). Each tile opens that module's rich view (ransomware → intel;
 * others → technique catalogue). Driven by live simulation modules.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Skull, Terminal, Mail, Boxes, Crosshair, ShieldAlert, Radar, FlaskConical, Loader2, ChevronRight, ArrowRight, Hammer, Globe, Cloud, Network, MousePointerClick,
} from "lucide-react";
import { cn } from "@/lib/utils";

// category/icon-name → component + accent
const ICONS: Record<string, any> = { Skull, Terminal, Mail, Boxes, Crosshair, ShieldAlert, Radar, FlaskConical, Globe, Hammer, Cloud, Network, MousePointerClick };
const CATEGORY_STYLE: Record<string, { icon: any; tone: string }> = {
  "deceptive-delivery": { icon: MousePointerClick, tone: "text-danger border-danger/30 bg-danger/10" },
  ransomware: { icon: Skull, tone: "text-danger border-danger/30 bg-danger/10" },
  phishing: { icon: Mail, tone: "text-warning border-warning/30 bg-warning/10" },
  discovery: { icon: Terminal, tone: "text-accent border-accent/30 bg-accent/10" },
  "lateral-movement": { icon: Crosshair, tone: "text-purple border-purple/30 bg-purple/10" },
  apt: { icon: Globe, tone: "text-danger border-danger/30 bg-danger/10" },
  container: { icon: Boxes, tone: "text-accent border-accent/30 bg-accent/10" },
  cloud: { icon: Cloud, tone: "text-purple border-purple/30 bg-purple/10" },
  "active-directory": { icon: Network, tone: "text-danger border-danger/30 bg-danger/10" },
  hacktools: { icon: Hammer, tone: "text-warning border-warning/30 bg-warning/10" },
};

export default function SimulationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/simulations").then((r) => r.json()).then((d) => setItems(d.items || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><Boxes className="h-6 w-6 text-accent" /> Attack Simulations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose a simulation category. Each maps real-world adversary tradecraft to atomic tests you can run against your environments.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/simulations/watcher" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border border-purple/40 bg-purple/10 text-purple hover:bg-purple/20"><Radar className="h-3.5 w-3.5" /> Library Updates</Link>
          <Link href="/marketplace" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"><Hammer className="h-3.5 w-3.5" /> Module Marketplace</Link>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Boxes className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No simulation modules live yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">Build or install one from the Marketplace.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Static tile — opens the full Atomic Test Library */}
          <Link href="/atomic-tests" className="group rounded-2xl border border-border bg-card p-6 hover:border-accent/40 hover:bg-card-hover hover:shadow-[0_0_50px_rgba(59,130,246,0.10)] transition-all flex flex-col">
            <div className={cn("inline-flex h-12 w-12 items-center justify-center rounded-xl border", "text-accent border-accent/30 bg-accent/10")}><FlaskConical className="h-6 w-6" /></div>
            <h3 className="mt-4 text-lg font-semibold text-foreground tracking-tight">Atomics Execution</h3>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed flex-1">Browse and run the full Atomic Red Team library — every technique and test, executed directly against your environments.</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1.5"><Radar className="h-3.5 w-3.5" /> Atomic Test Library</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-accent group-hover:gap-2 transition-all">Open <ArrowRight className="h-3.5 w-3.5" /></span>
            </div>
          </Link>

          {items.map((m) => {
            const style = CATEGORY_STYLE[m.category] || { icon: ICONS[m.icon] || Boxes, tone: "text-accent border-accent/30 bg-accent/10" };
            const Icon = ICONS[m.icon] || style.icon;
            return (
              <Link key={m.moduleId} href={`/modules/${m.moduleId}`} className="group rounded-2xl border border-border bg-card p-6 hover:border-accent/40 hover:bg-card-hover hover:shadow-[0_0_50px_rgba(59,130,246,0.10)] transition-all flex flex-col">
                <div className={cn("inline-flex h-12 w-12 items-center justify-center rounded-xl border", style.tone)}><Icon className="h-6 w-6" /></div>
                <h3 className="mt-4 text-lg font-semibold text-foreground tracking-tight">{m.name}</h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed flex-1">{m.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1.5"><Radar className="h-3.5 w-3.5" /> {m.stat}</span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-accent group-hover:gap-2 transition-all">Open <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
