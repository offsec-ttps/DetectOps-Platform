"use client";

import { CheckCircle2, Cloud, ExternalLink, Layers, Rocket, Server, XCircle } from "lucide-react";
import type { SarOperationStatus, SarProviderAvailability, SarTemplateInfo } from "@/types/sar";
import { ProviderIcon } from "./_shared";
import { cn } from "@/lib/utils";

/**
 * Header strip shown at the top of the Cloud tab.
 * Surfaces where the platform is running, where SAR is running, and one-line
 * counts so the user gets a full picture without scrolling.
 */
export default function HostInfoHeader({
  providers, templates, ranges, installedLocalCount,
}: {
  providers: SarProviderAvailability[];
  templates: SarTemplateInfo[];
  ranges: SarOperationStatus[];
  installedLocalCount: number;
}) {
  const running = ranges.filter((r) => r.status === "running").length;
  const building = ranges.filter((r) =>
    ["queued", "build_vpn", "wait_for_vpn", "build_lab"].includes(r.status),
  ).length;

  const platformUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Row 1: links */}
      <div className="flex items-center flex-wrap gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-foreground">Detection Platform</span>
          <a href={platformUrl} className="text-[11px] font-mono text-muted-foreground hover:text-accent">
            {platformUrl}
          </a>
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-foreground">SAR Controller</span>
          <a
            href="http://localhost:4321" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-accent"
          >
            localhost:4321 <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="http://localhost:4000/openapi/swagger" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            API <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground">Cloud CLIs:</span>
          {providers.map((p) => (
            <span
              key={p.provider}
              title={p.available ? `${p.cli_command} ready` : `${p.cli_command} not available`}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
                p.available
                  ? "text-success bg-success/10 border-success/30"
                  : "text-muted-foreground bg-muted/10 border-border",
              )}
            >
              <ProviderIcon provider={p.provider} />
              {p.provider.toUpperCase()}
              {p.available ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            </span>
          ))}
        </div>
      </div>

      <div className="h-px bg-border/40" />

      {/* Row 2: counts */}
      <div className="flex items-center flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-accent" />
          <strong className="text-foreground">{templates.length}</strong> cloud templates
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5 text-accent" />
          <strong className="text-foreground">{installedLocalCount}</strong> on-prem templates installed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          <strong className="text-foreground">{running}</strong> range{running === 1 ? "" : "s"} running
        </span>
        {building > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <strong className="text-foreground">{building}</strong> building
          </span>
        )}
      </div>
    </div>
  );
}
