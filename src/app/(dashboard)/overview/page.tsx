"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Shield, Target, Clock, Activity, Eye, Compass, Brain, Zap,
  AlertTriangle, ArrowRight, Loader2, Database, Flame, FileCode2,
  CheckCircle2, XCircle, GitBranch, Plug as PlugIcon, ShieldCheck, ShieldAlert,
  Monitor, Cloud, Globe, Server, Lock, Network, BarChart3,
} from "lucide-react";

interface OverviewData {
  totalRules: number;
  sources: {
    splunk: { total: number; verified: number }; sigma: { total: number };
    elastic: { total: number }; custom: { total: number };
    community: { total: number; bySource: { name: string; count: number }[] };
  };
  techniques: { covered: number; baseCovered: number; simulatable: number; validated: number };
  freshness: { lastSyncAt: string | null; days: number | null; sources: { name: string; lastSyncAt: string | null; totalRules: number }[] };
  platforms: { name: string; count: number }[];
  splunkTypes: { name: string; count: number }[];
  splunkStatuses: { name: string; count: number }[];
  splunkDomains: { name: string; count: number }[];
  atomicTests: number;
  simulations: { total: number; success: number; failure: number; error: number; running: number };
  recentSimulations: { id: string; techniques: string[]; target: string; status: string; durationMs: number; startedAt: string; detections: { detected: number; total: number } | null }[];
  reports: { total: number; byStatus: { status: string; count: number }[]; pushed: number };
  integrations: { total: number; connected: number; enabled: number; list: { name: string; type: string; connected: boolean; enabled: boolean }[] };
  attackCoverage: number;
  threatIntel: {
    counts: { threats: number; articles: number; indicators: number; sources: number };
    categories: { name: string; count: number }[];
    severities: { name: string; count: number }[];
    actors: { name: string; count: number }[];
    nations: { name: string; count: number }[];
    sectors: { name: string; count: number }[];
  };
}

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  Windows: Monitor, Linux: Server, AWS: Cloud, "Azure / M365": Cloud, GCP: Cloud,
  macOS: Monitor, Network: Network, "Cloud / SaaS": Globe, Web: Globe,
  Application: FileCode2, Containers: Database, Other: Shield,
};
const PLATFORM_COLORS: Record<string, string> = {
  Windows: "bg-blue-500", Linux: "bg-orange-500", AWS: "bg-amber-500", "Azure / M365": "bg-sky-500",
  GCP: "bg-red-400", macOS: "bg-gray-400", Network: "bg-cyan-500", "Cloud / SaaS": "bg-indigo-400",
  Web: "bg-green-500", Application: "bg-purple-400", Containers: "bg-teal-500", Other: "bg-gray-500",
};


/** Platform buckets the API normalizes into — the denominator for "Platform Coverage". */
const TRACKED_PLATFORMS = Object.keys(PLATFORM_ICONS).length;

const oodaPhases = [
  { phase: "Observe", icon: Eye, color: "text-info", bg: "bg-info/10 border-info/30" },
  { phase: "Orient", icon: Compass, color: "text-purple", bg: "bg-purple/10 border-purple/30" },
  { phase: "Decide", icon: Brain, color: "text-warning", bg: "bg-warning/10 border-warning/30" },
  { phase: "Act", icon: Zap, color: "text-success", bg: "bg-success/10 border-success/30" },
];

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/overview").then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>;
  if (!data) return <div className="text-center py-32 text-muted-foreground">Failed to load overview data.</div>;

  const maxPlatformCount = Math.max(...data.platforms.map((p) => p.count), 1);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Detection Engineering Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real-time detection coverage, threat intelligence, simulation results, and security gap analysis
        </p>
      </div>

      {/* ═══ Top Metric Cards ═══ */}
      <div className="grid grid-cols-5 gap-3">
        <MetricCard icon={<Shield className="h-5 w-5 text-accent" />} label="Total Detection Rules" value={data.totalRules.toLocaleString()} sub={`${data.sources.splunk.total.toLocaleString()} Splunk · ${data.sources.sigma.total.toLocaleString()} Sigma · ${data.sources.elastic.total.toLocaleString()} Elastic · ${data.sources.community.total.toLocaleString()} other`} />
        <MetricCard icon={<Target className="h-5 w-5 text-purple" />} label="ATT&CK Coverage" value={`${data.attackCoverage}%`} sub={`${data.techniques.covered} techniques with a rule (${data.techniques.baseCovered} base)`} />
        <MetricCard icon={<Zap className="h-5 w-5 text-warning" />} label="Simulations Run" value={String(data.simulations.total)} sub={`${data.simulations.success} success · ${data.simulations.failure} failure`} />
        <MetricCard icon={<ShieldCheck className="h-5 w-5 text-success" />} label="Simulate + Detect" value={String(data.techniques.validated)} sub={`of ${data.techniques.simulatable} techniques you can simulate`} />
        <MetricCard icon={<GitBranch className="h-5 w-5 text-purple" />} label="Reports Pushed" value={String(data.reports.pushed)} sub={`${data.reports.total} total reports`} />
      </div>

      {/* ═══ SECTION 1: Community Content & Platform Distribution ═══ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Source breakdown */}
        <div className="col-span-4 rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Community Content Sources</h2>
          <div className="space-y-2">
            {[
              { name: "Splunk Security Content", count: data.sources.splunk.total, color: "bg-green-500", icon: Database },
              { name: "SigmaHQ Rules", count: data.sources.sigma.total, color: "bg-blue-500", icon: Shield },
              { name: "Elastic Detection Rules", count: data.sources.elastic.total, color: "bg-yellow-500", icon: Zap },
              { name: "Other Communities", count: data.sources.community.total, color: "bg-cyan-500", icon: Globe },
              { name: "Custom Detections", count: data.sources.custom.total, color: "bg-purple-500", icon: FileCode2 },
            ].map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", s.color + "/10")}>
                  <s.icon className={cn("h-4 w-4", s.color.replace("bg-", "text-"))} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{s.name}</p>
                    <p className="text-xs font-bold text-foreground">{s.count.toLocaleString()}</p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
                    <div className={cn("h-full rounded-full", s.color)} style={{ width: `${Math.max(2, (s.count / data.totalRules) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {data.sources.community.bySource.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="text-[10px] font-semibold text-muted uppercase mb-1">Inside &ldquo;Other Communities&rdquo;</p>
              <div className="flex flex-wrap gap-1">
                {data.sources.community.bySource.map((b) => (
                  <span key={b.name} className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] text-muted-foreground">
                    {b.name} <span className="font-bold text-foreground">{b.count.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted uppercase font-semibold">Total</span>
            <span className="text-sm font-bold text-foreground">{data.totalRules.toLocaleString()}</span>
          </div>
          {data.freshness.days !== null && (
            <p className="text-[9px] text-muted">
              Last content sync {data.freshness.days === 0 ? "today" : `${data.freshness.days}d ago`}
              {data.freshness.days > 30 && <span className="text-warning font-semibold"> · stale</span>}
            </p>
          )}
        </div>

        {/* Platform distribution */}
        <div className="col-span-8 rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Platform Distribution</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {data.platforms.map((p) => {
              const Icon = PLATFORM_ICONS[p.name] || Shield;
              const barColor = PLATFORM_COLORS[p.name] || "bg-gray-500";
              return (
                <div key={p.name} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted shrink-0" />
                  <span className="text-xs text-muted-foreground w-24 shrink-0 truncate">{p.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted/20 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${(p.count / maxPlatformCount) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono font-bold text-foreground w-12 text-right">{p.count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ SECTION 2: Threat Intelligence Summary ═══ */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <h2 className="text-sm font-semibold text-foreground">Threat Intelligence</h2>
            {data.threatIntel?.counts.threats > 0 ? (
              <span className="rounded-full bg-success/10 text-success border border-success/30 px-2 py-0.5 text-[9px] font-semibold">
                {data.threatIntel.counts.threats} Threats · {data.threatIntel.counts.articles} Articles · {data.threatIntel.counts.indicators} IoCs
              </span>
            ) : (
              <span className="rounded-full bg-warning/10 text-warning border border-warning/30 px-2 py-0.5 text-[9px] font-semibold">Sync Needed</span>
            )}
          </div>
          {data.threatIntel?.sectors.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto">
              {data.threatIntel.sectors.slice(0, 8).map((s: any) => (
                <span key={s.name} className="rounded-full px-2 py-0.5 text-[9px] text-muted-foreground hover:text-foreground hover:bg-card-hover whitespace-nowrap">
                  {s.name} ({s.count})
                </span>
              ))}
            </div>
          )}
        </div>

        {data.threatIntel?.categories.length > 0 ? (
          <>
            <div className="grid grid-cols-7 gap-2">
              {data.threatIntel.categories.map((cat: any) => {
                const catColor: Record<string, string> = {
                  APT: "text-danger", SUPPLY_CHAIN: "text-purple", MALWARE: "text-warning",
                  RANSOMWARE: "text-red-400", VULNERABILITY: "text-accent", ZERO_DAY: "text-pink-400", PHISHING: "text-orange-400",
                };
                return (
                  <div key={cat.name} className="rounded-lg border border-border bg-background p-3 text-center">
                    <p className={cn("text-lg font-bold", catColor[cat.name] || "text-foreground")}>{cat.count}</p>
                    <p className="text-[9px] text-muted-foreground uppercase font-semibold mt-0.5">{cat.name.replace("_", " ")}</p>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase mb-1">Top Threat Actors</p>
                <div className="space-y-0.5">
                  {data.threatIntel.actors.slice(0, 5).map((a: any) => (
                    <div key={a.name} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground truncate">{a.name}</span>
                      <span className="font-bold text-foreground">{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase mb-1">Attribution by Nation</p>
                <div className="space-y-0.5">
                  {data.threatIntel.nations.slice(0, 5).map((n: any) => (
                    <div key={n.name} className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">{n.name}</span>
                      <span className="font-bold text-foreground">{n.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-xs text-muted-foreground">Go to Threat Intel Ingestion and click "Sync All Feeds" to collect threat intelligence data.</p>
          </div>
        )}
      </div>

      {/* ═══ SECTION 3: Simulation & Detection Status ═══ */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">Simulation & Detection Status</h2>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> {data.simulations.success} Success</span>
            <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-danger" /> {data.simulations.failure} Failure</span>
            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> {data.simulations.error} Error</span>
            <span className="text-muted font-semibold">{data.simulations.total} Total</span>
          </div>
        </div>

        {data.recentSimulations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-card-hover text-[10px] font-semibold uppercase text-muted tracking-wider">
                  <th className="px-4 py-2 text-left">Technique(s)</th>
                  <th className="px-4 py-2 text-left">Target</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Duration</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Detections</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSimulations.map((sim) => (
                  <tr key={sim.id} className="border-t border-border-subtle hover:bg-card-hover transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {sim.techniques.map((t) => (
                          <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{sim.target.replace("attack-range-", "")}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        sim.status === "success" ? "bg-success/10 text-success" :
                        sim.status === "failure" ? "bg-danger/10 text-danger" :
                        sim.status === "running" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"
                      )}>
                        {sim.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{sim.durationMs > 0 ? `${(sim.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(sim.startedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {sim.detections ? (
                        <span className={cn("font-medium", sim.detections.detected > 0 ? "text-success" : "text-danger")}>
                          {sim.detections.detected}/{sim.detections.total} detected
                        </span>
                      ) : (
                        <span className="text-muted">not validated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No simulations run yet. Use Campaign Designer to execute ART simulations.
          </div>
        )}
      </div>

      {/* ═══ SECTION 4: Security Gap Analysis ═══ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Coverage bars */}
        <div className="col-span-7 rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold text-foreground">Security Gap Analysis</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: "MITRE ATT&CK Coverage", value: data.attackCoverage, max: 100, color: "bg-accent" },
              { label: "Simulatable Techniques Covered", value: data.techniques.simulatable > 0 ? Math.round((data.techniques.validated / data.techniques.simulatable) * 100) : 0, max: 100, color: "bg-success" },
              { label: "Simulation Success Rate", value: data.simulations.total > 0 ? Math.round((data.simulations.success / data.simulations.total) * 100) : 0, max: 100, color: "bg-purple" },
              // Freshness decays from 100% on sync day to 0% at 90 days stale.
              { label: "Content Freshness", value: data.freshness.days === null ? 0 : Math.max(0, Math.round((1 - Math.min(data.freshness.days, 90) / 90) * 100)), max: 100, color: "bg-blue-500" },
              { label: "Platform Coverage", value: Math.min(100, Math.round((data.platforms.length / TRACKED_PLATFORMS) * 100)), max: 100, color: "bg-cyan-500" },
            ].map((m) => (
              <div key={m.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className={cn("font-bold", m.value >= 70 ? "text-success" : m.value >= 40 ? "text-warning" : "text-danger")}>{m.value}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", m.color)} style={{ width: `${m.value}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Gap indicators */}
          <div className="border-t border-border pt-3 grid grid-cols-3 gap-2">
            {[
              { label: "Simulatable, no rule", value: Math.max(0, data.techniques.simulatable - data.techniques.validated), color: "text-danger" },
              { label: "Failed simulations", value: data.simulations.failure + data.simulations.error, color: "text-warning" },
              { label: "Rules, no atomic test", value: Math.max(0, data.techniques.covered - data.techniques.validated), color: "text-muted" },
            ].map((g) => (
              <div key={g.label} className="rounded-lg border border-border bg-background p-2 text-center">
                <p className={cn("text-lg font-bold", g.color)}>{g.value}</p>
                <p className="text-[9px] text-muted-foreground">{g.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Detection type / domain breakdown */}
        <div className="col-span-5 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Splunk Detection Types</h2>
            <div className="space-y-1.5">
              {data.splunkTypes.map((t) => (
                <div key={t.name} className="flex items-center justify-between text-xs">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold",
                    t.name === "TTP" ? "bg-danger/10 text-danger" :
                    t.name === "Anomaly" ? "bg-warning/10 text-warning" :
                    t.name === "Hunting" ? "bg-accent/10 text-accent" :
                    "bg-success/10 text-success"
                  )}>{t.name}</span>
                  <span className="text-foreground font-bold">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Security Domains</h2>
            <div className="space-y-1.5">
              {data.splunkDomains.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{d.name}</span>
                  <span className="text-foreground font-bold">{d.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ SECTION 5: Integrated Tools ═══ */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <PlugIcon className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Integrated Tools</h2>
          <span className="text-[10px] text-muted">{data.integrations.connected} connected · {data.integrations.enabled} enabled</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data.integrations.list.length > 0 ? data.integrations.list.map((intg) => (
            <span key={intg.name} className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              intg.connected ? "border-success/30 bg-success/5 text-success" :
              intg.enabled ? "border-accent/30 bg-accent/5 text-accent" :
              "border-border bg-card text-muted-foreground"
            )}>
              <span className={cn("h-2 w-2 rounded-full", intg.connected ? "bg-success" : intg.enabled ? "bg-accent" : "bg-muted")} />
              {intg.name}
              <span className="text-[9px] text-muted uppercase">{intg.type}</span>
            </span>
          )) : (
            <span className="text-xs text-muted-foreground">No integrations configured. Go to System &gt; Integrations to connect your tools.</span>
          )}
        </div>
      </div>

      {/* ═══ OODA Cycle (kept) ═══ */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3">OODA Cycle Status</h2>
        <div className="flex items-center gap-3">
          {oodaPhases.map((phase, i) => {
            const counts = [
              data.threatIntel?.counts.threats ?? 0, // Observe — threat intel ingested
              data.reports.total,                    // Orient  — reports/use cases modeled
              data.simulations.total,                // Decide  — simulations/tests run
              data.techniques.validated,             // Act     — techniques both simulated and covered
            ];
            const labels = [
              "threat intel reports",
              "use cases modeled",
              "simulations executed",
              "techniques covered",
            ];
            return (
              <React.Fragment key={phase.phase}>
                {i > 0 && <ArrowRight className="h-4 w-4 text-muted shrink-0" />}
                <div className={cn("flex-1 rounded-lg border p-3", phase.bg)}>
                  <div className="flex items-center gap-2">
                    <phase.icon className={cn("h-4 w-4", phase.color)} />
                    <span className={cn("text-sm font-semibold", phase.color)}>{phase.phase}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">{counts[i]}</span> {labels[i]}
                  </p>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">{icon}</div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
      <p className="text-[9px] text-muted uppercase font-semibold mt-1">{label}</p>
    </div>
  );
}

