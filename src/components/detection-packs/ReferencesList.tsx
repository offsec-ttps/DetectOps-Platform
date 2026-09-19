"use client";

import { ExternalLink, FileText, Newspaper, ShieldAlert, Users, Building2, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Reference { title: string; url: string; type: string }

const TYPE_META: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  report:    { Icon: FileText,    color: "text-info",        label: "Report"    },
  blog:      { Icon: Newspaper,   color: "text-purple",      label: "Blog"      },
  advisory:  { Icon: ShieldAlert, color: "text-warning",     label: "Advisory"  },
  community: { Icon: Users,       color: "text-success",     label: "Community" },
  vendor:    { Icon: Building2,   color: "text-accent",      label: "Vendor"    },
  other:     { Icon: LinkIcon,    color: "text-muted-foreground", label: "Other" },
};

export default function ReferencesList({ refs }: { refs: Reference[] }) {
  if (!refs.length) return null;
  // Sort by type for visual grouping
  const sorted = [...refs].sort((a, b) => a.type.localeCompare(b.type));
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground">References ({refs.length})</h2>
      </div>
      <ul className="divide-y divide-border">
        {sorted.map((r, i) => {
          const meta = TYPE_META[r.type] || TYPE_META.other;
          return (
            <li key={i} className="px-4 py-2 flex items-center gap-2">
              <meta.Icon className={cn("h-3.5 w-3.5 flex-shrink-0", meta.color)} />
              <span className={cn("text-[10px] uppercase tracking-wider w-16 flex-shrink-0", meta.color)}>{meta.label}</span>
              <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-foreground hover:text-accent truncate flex-1" title={r.url}>
                {r.title || r.url}
              </a>
              <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
