"use client";

import Link from "next/link";
import { FlaskConical, FileCode2, Cloud, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface Sim {
  id: string;
  framework: string;
  refId: string;
  techniqueId: string;
  displayName: string;
  description: string;
  rationale: string;
}

const FRAMEWORK_META: Record<string, { color: string; Icon: React.ComponentType<{ className?: string }>; label: string; href: (refId: string) => string }> = {
  atomic:      { color: "border-accent/30 bg-accent/5",      Icon: FlaskConical, label: "ART",        href: () => "/atomic-tests" },
  purplesharp: { color: "border-purple/30 bg-purple/5",      Icon: FileCode2,    label: "PurpleSharp", href: () => "/use-cases/purplesharp" },
  stratus:     { color: "border-info/30 bg-info/5",          Icon: Cloud,        label: "Stratus",     href: () => "/use-cases/canvas" },
};

export default function SimulationsList({ sims }: { sims: Sim[] }) {
  if (!sims.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        No matching simulations found in the ART / PurpleSharp / Stratus catalogues for this pack's techniques.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground">Attack simulations ({sims.length})</h2>
      </div>
      <div className="divide-y divide-border">
        {sims.map((s) => {
          const meta = FRAMEWORK_META[s.framework] || FRAMEWORK_META.atomic;
          return (
            <div key={s.id} className={cn("px-4 py-2", meta.color)}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border", meta.color)}>
                  <meta.Icon className="h-2.5 w-2.5 inline mr-0.5" />
                  {meta.label}
                </span>
                <span className="font-mono text-[10px] text-accent">{s.techniqueId}</span>
                <span className="text-xs font-medium text-foreground truncate flex-1" title={s.displayName}>{s.displayName}</span>
                <Link href={meta.href(s.refId)} className="text-[11px] text-accent hover:underline inline-flex items-center gap-0.5">
                  open <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
              {s.rationale && <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">{s.rationale}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
