"use client";

/**
 * Open-source + commercial C2 framework catalog grid. Each card opens the
 * template detail (C2TemplateDetail) where the operator sees prerequisites,
 * config, resources, and the deploy flow. Purely presentational — the parent
 * owns selection + deploy.
 */

import { Radio, ShieldAlert, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type { C2CatalogEntry } from "@/config/c2-catalog";

function statusChip(entry: C2CatalogEntry): { label: string; cls: string } {
  if (entry.deploy.method === "none") return { label: "Template only", cls: "border-warning/40 text-warning" };
  if (entry.deploy.available) return { label: "Automated deploy", cls: "border-success/40 text-success" };
  return { label: "Guided · coming soon", cls: "border-border text-muted-foreground" };
}

function Card({ entry, onSelect }: { entry: C2CatalogEntry; onSelect: (e: C2CatalogEntry) => void }) {
  const chip = statusChip(entry);
  const Icon = entry.category === "commercial" ? ShieldAlert : Radio;
  return (
    <button
      onClick={() => onSelect(entry)}
      className="text-left rounded-xl border border-border bg-card p-4 flex flex-col hover:border-accent/40 hover:bg-card-hover transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-muted/10", entry.deploy.available ? "text-accent" : "text-muted-foreground")}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={cn("text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border", chip.cls)}>{chip.label}</span>
      </div>
      <h4 className="text-sm font-semibold text-foreground mt-3">{entry.name}</h4>
      {entry.language && <p className="text-[10px] text-muted-foreground">{entry.language}</p>}
      <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-3 flex-1">{entry.description}</p>
      <p className="mt-2 text-[10px] text-muted-foreground">Agents: {entry.platforms.join(" · ")}</p>
    </button>
  );
}

export default function C2Catalog({ entries, onSelect }: { entries: C2CatalogEntry[]; onSelect: (e: C2CatalogEntry) => void }) {
  const openSource = entries.filter((e) => e.category === "open-source");
  const commercial = entries.filter((e) => e.category === "commercial");

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground inline-flex items-center gap-1.5"><Boxes className="h-4 w-4 text-accent" /> Open-Source C2 Frameworks</p>
          <p className="text-xs text-muted-foreground mt-0.5">Deploy a real C2 in your lab, generate authentic adversary traffic, and build detections. Automated deploy for the first wave; the rest ship guided steps + C2 Matrix how-tos.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {openSource.map((e) => <Card key={e.id} entry={e} onSelect={onSelect} />)}
        </div>
      </div>

      {commercial.length > 0 && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground inline-flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-warning" /> Commercial C2 (template only)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Licensed frameworks DetectOps does not deploy — these templates surface detection opportunities so you can hunt their behaviour. Configuration support is coming later.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {commercial.map((e) => <Card key={e.id} entry={e} onSelect={onSelect} />)}
          </div>
        </div>
      )}
    </div>
  );
}
