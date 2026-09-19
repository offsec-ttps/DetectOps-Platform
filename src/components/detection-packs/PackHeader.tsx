"use client";

import { ShieldAlert, Activity, Layers, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-danger/15 text-danger border-danger/40",
  high:     "bg-warning/15 text-warning border-warning/40",
  medium:   "bg-info/15 text-info border-info/40",
  low:      "bg-success/15 text-success border-success/40",
  info:     "bg-muted/15 text-muted-foreground border-border",
};

const CATEGORY_LABELS: Record<string, string> = {
  "web":           "Web",
  "network":       "Network",
  "os-windows":    "Windows",
  "os-linux":      "Linux",
  "os-macos":      "macOS",
  "cloud":         "Cloud",
  "identity":      "Identity",
  "email":         "Email",
  "third-party":   "Third-Party",
  "other":         "Other",
};

const STATUS_COLORS: Record<string, string> = {
  draft:      "bg-muted/15 text-muted-foreground border-border",
  test:       "bg-info/15 text-info border-info/40",
  tune:       "bg-warning/15 text-warning border-warning/40",
  validate:   "bg-purple/15 text-purple border-purple/40",
  production: "bg-success/15 text-success border-success/40",
  deprecated: "bg-muted/15 text-muted-foreground border-border line-through",
};

interface Props {
  name: string;
  description: string;
  severity: string;
  riskScore: number;
  category: string;
  status: string;
  platforms: string[];
  dataSources: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  sourceType: string;
  sourceTable: string;
  sourceRefId: string;
  createdAt: string;
  rightActions?: React.ReactNode;
}

export default function PackHeader(p: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", SEVERITY_COLORS[p.severity] || SEVERITY_COLORS.info)}>
              {p.severity}
            </span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border border-accent/30 bg-accent/10 text-accent">
              {CATEGORY_LABELS[p.category] || p.category}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", STATUS_COLORS[p.status] || STATUS_COLORS.draft)}>
              {p.status}
            </span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-mono border border-border bg-muted/10 text-muted-foreground inline-flex items-center gap-1">
              <Activity className="h-2.5 w-2.5" /> risk {p.riskScore}/100
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">{p.name}</h1>
          {p.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{p.description}</p>
          )}
        </div>
        {p.rightActions && (
          <div className="flex-shrink-0">{p.rightActions}</div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <FactCell icon={<ShieldAlert className="h-3 w-3" />} label="MITRE techniques">
          {p.mitreTechniques.length === 0
            ? <span className="text-muted-foreground">none</span>
            : (
              <div className="flex flex-wrap gap-1">
                {p.mitreTechniques.slice(0, 8).map((t) => (
                  <a key={t} href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}/`} target="_blank" rel="noreferrer"
                    className="font-mono text-[10px] text-accent hover:underline">{t}</a>
                ))}
                {p.mitreTechniques.length > 8 && <span className="text-[10px] text-muted-foreground">+{p.mitreTechniques.length - 8}</span>}
              </div>
            )
          }
        </FactCell>
        <FactCell icon={<Layers className="h-3 w-3" />} label="Tactics">
          {p.mitreTactics.length === 0
            ? <span className="text-muted-foreground">none</span>
            : <span>{p.mitreTactics.slice(0, 4).join(", ")}{p.mitreTactics.length > 4 ? ` +${p.mitreTactics.length - 4}` : ""}</span>
          }
        </FactCell>
        <FactCell icon={<Layers className="h-3 w-3" />} label="Platforms">
          {p.platforms.length === 0
            ? <span className="text-muted-foreground">none</span>
            : <span className="font-mono">{p.platforms.slice(0, 4).join(", ")}{p.platforms.length > 4 ? ` +${p.platforms.length - 4}` : ""}</span>
          }
        </FactCell>
        <FactCell icon={<Activity className="h-3 w-3" />} label="Data sources">
          {p.dataSources.length === 0
            ? <span className="text-muted-foreground">none</span>
            : <span>{p.dataSources.slice(0, 3).join(", ")}{p.dataSources.length > 3 ? ` +${p.dataSources.length - 3}` : ""}</span>
          }
        </FactCell>
      </div>

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground border-t border-border pt-2">
        <span>Generated from</span>
        <SourceLink sourceType={p.sourceType} sourceTable={p.sourceTable} sourceRefId={p.sourceRefId} />
        <ChevronRight className="h-3 w-3" />
        <span>{new Date(p.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

function FactCell({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xs text-foreground">{children}</div>
    </div>
  );
}

function SourceLink({ sourceType, sourceTable, sourceRefId }: { sourceType: string; sourceTable: string; sourceRefId: string }) {
  // Best-effort deep link to the underlying source
  const href = sourceTable === "ThreatIntelReport" ? `/threat-intel/${sourceRefId}`
             : sourceTable === "CommunitySigmaRule" ? `/community/sigmahq?ruleId=${sourceRefId}`
             : sourceTable === "CommunityElasticRule" ? `/community/elastic?ruleId=${sourceRefId}`
             : sourceTable === "SplunkDetection" ? `/community/splunk?ruleId=${sourceRefId}`
             : null;
  const label = `${sourceTable} · ${sourceRefId.slice(0, 8)}`;
  return href
    ? <Link href={href} className="text-accent hover:underline font-mono">{label}</Link>
    : <span className="font-mono">{label}</span>;
}
