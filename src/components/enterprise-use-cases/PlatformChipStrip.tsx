"use client";

import {
  Layers, Monitor, Terminal, Apple, Cloud, KeyRound, Container as ContainerIcon,
  Server, Globe, Network as NetworkIcon, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Bucket { name: string; count: number }

export const PLATFORM_BUCKETS: Array<{ id: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: "windows",    label: "Windows",     Icon: Monitor       },
  { id: "linux",      label: "Linux",       Icon: Terminal      },
  { id: "macos",      label: "macOS",       Icon: Apple         },
  { id: "cloud",      label: "Cloud",       Icon: Cloud         },
  { id: "saas",       label: "SaaS",        Icon: KeyRound      },
  { id: "container",  label: "Container",   Icon: ContainerIcon },
  { id: "network",    label: "Network",     Icon: NetworkIcon   },
  { id: "hypervisor", label: "Hypervisor",  Icon: Server        },
  { id: "browser",    label: "Browser",     Icon: Globe         },
  { id: "other",      label: "Other",       Icon: MoreHorizontal},
];

interface Props {
  buckets: Bucket[];
  selected: string;
  onChange: (id: string) => void;
}

export default function PlatformChipStrip({ buckets, selected, onChange }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Layers className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Use cases by platform</span>
        {selected && (
          <button onClick={() => onChange("")} className="ml-auto text-[10px] text-accent hover:underline">clear filter</button>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {PLATFORM_BUCKETS.map((b) => {
          const count = buckets.find((x) => x.name === b.id)?.count ?? 0;
          const active = selected === b.id;
          return (
            <button
              key={b.id}
              onClick={() => onChange(active ? "" : b.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : count > 0
                    ? "border-border bg-background/40 text-foreground hover:border-accent/40 hover:bg-card-hover"
                    : "border-border bg-background/20 text-muted-foreground/60 hover:text-muted-foreground",
              )}
              title={`${count} use case${count !== 1 ? "s" : ""} covering ${b.label}`}
            >
              <b.Icon className={cn("h-3.5 w-3.5", active ? "text-accent" : count > 0 ? "text-foreground" : "text-muted-foreground/60")} />
              <span className="font-medium">{b.label}</span>
              <span className={cn(
                "font-mono px-1.5 py-0.5 rounded text-[10px] font-semibold",
                active ? "bg-accent/20 text-accent" : count > 0 ? "bg-foreground/10 text-foreground" : "bg-muted/15 text-muted-foreground/60",
              )}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
