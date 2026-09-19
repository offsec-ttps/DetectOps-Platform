"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert, Search, Loader2, ChevronRight, FileCode2, Layers, Inbox, Wand2,
  Monitor, Terminal, Apple, Cloud, KeyRound, Container as ContainerIcon, Server,
  Globe, Network as NetworkIcon, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import BulkRegenerateDialog from "@/components/detection-packs/BulkRegenerateDialog";

interface PackRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  severity: string;
  riskScore: number;
  category: string;
  status: string;
  platforms: string[];
  mitreTechniques: string[];
  ruleCount: number;
  simulationCount: number;
  hasIrPlaybook: boolean;
  createdAt: string;
}

interface Stats {
  totalPacks: number;
  byCategory: { name: string; count: number }[];
  bySeverity: { name: string; count: number }[];
  byStatus: { name: string; count: number }[];
  byPlatformBucket: { name: string; count: number }[];
}

const PLATFORM_BUCKETS: Array<{ id: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-danger/15 text-danger",
  high:     "bg-warning/15 text-warning",
  medium:   "bg-info/15 text-info",
  low:      "bg-success/15 text-success",
  info:     "bg-muted/15 text-muted-foreground",
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
  "third-party":   "3P",
  "other":         "Other",
};

export default function DetectionPacksPage() {
  const [rows, setRows] = useState<PackRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [platformBucket, setPlatformBucket] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (severity) params.set("severity", severity);
    if (status) params.set("status", status);
    if (platformBucket) params.set("platformBucket", platformBucket);
    fetch(`/api/detection-packs?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.items || []); if (d.stats) setStats(d.stats); })
      .catch(() => { setRows([]); })
      .finally(() => setLoading(false));
  }, [q, category, severity, status, platformBucket]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-accent" />
            Detection Packs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-generated detection bundles: multi-format rules + ART simulations + L1/L2/L3 IR playbooks. Generated from threat intel reports and community detection rules.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setBulkOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border border-border text-foreground hover:bg-card-hover"
            title="Bulk regenerate matching packs with a fresh LLM run"
          >
            <Wand2 className="h-3 w-3" /> Bulk regenerate
          </button>
          <Link
            href="/detections/packs/queue"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs border border-border text-foreground hover:bg-card-hover"
          >
            Auto-pipeline queue →
          </Link>
        </div>
      </div>
      <BulkRegenerateDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onRegenerated={() => { /* list auto-refreshes via filter effect */ }} />

      {/* Platform chip strip — click to filter */}
      {stats?.byPlatformBucket && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Use cases by platform</span>
            {platformBucket && (
              <button
                onClick={() => setPlatformBucket("")}
                className="ml-auto text-[10px] text-accent hover:underline"
              >clear filter</button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {PLATFORM_BUCKETS.map((b) => {
              const count = stats.byPlatformBucket.find((x) => x.name === b.id)?.count ?? 0;
              const active = platformBucket === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setPlatformBucket(active ? "" : b.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                    active
                      ? "border-accent bg-accent/10 text-accent"
                      : count > 0
                        ? "border-border bg-background/40 text-foreground hover:border-accent/40 hover:bg-card-hover"
                        : "border-border bg-background/20 text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                  title={`${count} pack${count !== 1 ? "s" : ""} covering ${b.label}`}
                >
                  <b.Icon className={cn("h-3.5 w-3.5", active ? "text-accent" : count > 0 ? "text-foreground" : "text-muted-foreground/60")} />
                  <span className="font-medium">{b.label}</span>
                  <span className={cn(
                    "font-mono px-1.5 py-0.5 rounded text-[10px] font-semibold",
                    active
                      ? "bg-accent/20 text-accent"
                      : count > 0
                        ? "bg-foreground/10 text-foreground"
                        : "bg-muted/15 text-muted-foreground/60",
                  )}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <StatCell label="Total" value={String(stats.totalPacks)} />
          <StatCell label="By severity" value={stats.bySeverity.map((s) => `${s.name}:${s.count}`).join(" · ") || "—"} />
          <StatCell label="By status" value={stats.byStatus.map((s) => `${s.name}:${s.count}`).join(" · ") || "—"} />
          <StatCell label="By category" value={stats.byCategory.map((s) => `${CATEGORY_LABELS[s.name] || s.name}:${s.count}`).join(" · ") || "—"} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, description, or source ID…"
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </div>
        <Pill label="Category" value={category} onChange={setCategory} options={["", "web", "network", "os-windows", "os-linux", "os-macos", "cloud", "identity", "email", "third-party", "other"]} format={(v) => CATEGORY_LABELS[v] || v} />
        <Pill label="Severity" value={severity} onChange={setSeverity} options={["", "critical", "high", "medium", "low", "info"]} />
        <Pill label="Status" value={status} onChange={setStatus} options={["", "draft", "test", "tune", "validate", "production", "deprecated"]} />
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No detection packs yet. Click "Generate Detection Pack" on any threat intel report or community rule to create one.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/detections/packs/${r.id}`}
                className="block px-4 py-3 hover:bg-card-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", SEVERITY_COLORS[r.severity] || SEVERITY_COLORS.info)}>
                        {r.severity}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase bg-accent/15 text-accent">
                        {CATEGORY_LABELS[r.category] || r.category}
                      </span>
                      {r.status !== "draft" && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-muted/15 text-muted-foreground">{r.status}</span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">risk {r.riskScore}</span>
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-foreground truncate">{r.name}</h3>
                    {r.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.description}</p>}
                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><FileCode2 className="h-2.5 w-2.5" /> {r.ruleCount} rule{r.ruleCount !== 1 ? "s" : ""}</span>
                      <span className="inline-flex items-center gap-1"><Layers className="h-2.5 w-2.5" /> {r.simulationCount} sim{r.simulationCount !== 1 ? "s" : ""}</span>
                      <span>{r.hasIrPlaybook ? "✓ IRP" : "no IRP"}</span>
                      {r.mitreTechniques.length > 0 && (
                        <span className="font-mono">{r.mitreTechniques.slice(0, 3).join(", ")}{r.mitreTechniques.length > 3 ? ` +${r.mitreTechniques.length - 3}` : ""}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="mt-0.5 text-xs text-foreground truncate" title={value}>{value}</div>
    </div>
  );
}

function Pill({ label, value, onChange, options, format }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; format?: (v: string) => string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs rounded-md border border-border bg-input text-foreground px-2 py-1.5 focus:outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o || "__all"} value={o}>{o ? (format ? format(o) : o) : `All ${label}`}</option>
      ))}
    </select>
  );
}
