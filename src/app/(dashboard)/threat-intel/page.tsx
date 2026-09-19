"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Radar, Globe, Shield, Search, RefreshCw, Loader2,
  ChevronRight, ChevronDown, ChevronLeft, ExternalLink, Download, Eye,
  FileText, CheckCircle2,
  Copy, Check, Zap, Hash, Lock, BarChart3,
  Sparkles, X, AlertTriangle, ArrowUpRight,
} from "lucide-react";
import Link from "next/link";
import GeneratePlaybookButton from "@/components/threat-intel/GeneratePlaybookButton";
import GenerateDetectionPackButton from "@/components/detection-packs/GenerateButton";

// ── IoC type labels and icons ──
const IOC_META: Record<string, { label: string; icon: string; color: string }> = {
  url: { label: "URLs", icon: "URL", color: "text-blue-400 bg-blue-400/10" },
  domain: { label: "Domains", icon: "DNS", color: "text-cyan-400 bg-cyan-400/10" },
  sha256: { label: "SHA-256", icon: "SHA", color: "text-orange-400 bg-orange-400/10" },
  filename: { label: "Filenames", icon: "FILE", color: "text-yellow-400 bg-yellow-400/10" },
  ipv4: { label: "IPv4 Addresses", icon: "IP", color: "text-green-400 bg-green-400/10" },
  md5: { label: "MD5 Hashes", icon: "MD5", color: "text-purple-400 bg-purple-400/10" },
  email: { label: "Emails", icon: "@", color: "text-pink-400 bg-pink-400/10" },
  cve: { label: "CVEs", icon: "CVE", color: "text-red-400 bg-red-400/10" },
  sha1: { label: "SHA-1", icon: "SHA1", color: "text-amber-400 bg-amber-400/10" },
  registry: { label: "Registry Keys", icon: "REG", color: "text-gray-400 bg-gray-400/10" },
};

const SEV_COLORS: Record<string, string> = {
  CRITICAL: "bg-severity-critical/10 text-severity-critical border-severity-critical/30",
  HIGH: "bg-severity-high/10 text-severity-high border-severity-high/30",
  MEDIUM: "bg-severity-medium/10 text-severity-medium border-severity-medium/30",
  LOW: "bg-severity-low/10 text-severity-low border-severity-low/30",
};
const CAT_COLORS: Record<string, string> = {
  APT: "bg-danger/10 text-danger", SUPPLY_CHAIN: "bg-purple/10 text-purple",
  MALWARE: "bg-warning/10 text-warning", RANSOMWARE: "bg-red-400/10 text-red-400",
  VULNERABILITY: "bg-accent/10 text-accent", ZERO_DAY: "bg-pink-400/10 text-pink-400",
  PHISHING: "bg-orange-400/10 text-orange-400",
};

export default function ThreatIntelPage() {
  const [tab, setTab] = useState<"dashboard" | "threats" | "articles" | "indicators" | "sources" | "vendors">("dashboard");
  const [stats, setStats] = useState<any>(null);
  const [threats, setThreats] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [indicators, setIndicators] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sevFilter, setSevFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threatTab, setThreatTab] = useState("overview");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const [configuringVendor, setConfiguringVendor] = useState<string | null>(null);
  const [vendorKey, setVendorKey] = useState("");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const handleSearch = (v: string) => {
    setSearchInput(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setSearch(v); setPage(1); }, 400);
  };

  const fetchStats = () => fetch("/api/threat-intel/stats").then((r) => r.json()).then(setStats).catch(() => {});

  useEffect(() => { fetchStats().finally(() => setLoading(false)); }, []);

  // Data fetchers
  const fetchThreats = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize), view: "threats" });
    if (search) p.set("search", search);
    if (catFilter) p.set("category", catFilter);
    if (sevFilter) p.set("severity", sevFilter);
    if (sourceFilter) p.set("source", sourceFilter);
    const res = await fetch(`/api/threat-intel?${p}`);
    if (res.ok) { const d = await res.json(); setThreats(d.items); setTotal(d.total); setTotalPages(d.totalPages || 1); }
  }, [page, pageSize, search, catFilter, sevFilter, sourceFilter]);

  const fetchVendors = useCallback(async () => {
    const res = await fetch("/api/threat-intel/vendors");
    if (res.ok) { const d = await res.json(); setVendors(d.items || []); }
  }, []);

  const fetchArticles = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize), view: "articles" });
    if (search) p.set("search", search);
    const res = await fetch(`/api/threat-intel?${p}`);
    if (res.ok) { const d = await res.json(); setArticles(d.items); setTotal(d.total); setTotalPages(d.totalPages || 1); }
  }, [page, pageSize, search]);

  const fetchIndicators = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search) p.set("search", search);
    if (catFilter) p.set("type", catFilter);
    const res = await fetch(`/api/threat-intel/indicators?${p}`);
    if (res.ok) { const d = await res.json(); setIndicators(d.items); setTotal(d.total); setTotalPages(d.totalPages || 1); }
  }, [page, pageSize, search, catFilter]);

  useEffect(() => {
    if (tab === "threats") fetchThreats();
    else if (tab === "articles") fetchArticles();
    else if (tab === "indicators") fetchIndicators();
    else if (tab === "vendors") fetchVendors();
  }, [tab, fetchThreats, fetchArticles, fetchIndicators, fetchVendors]);

  const triggerSync = async () => {
    setSyncing(true);
    await fetch("/api/threat-intel/sync", { method: "POST" });
    const poll = setInterval(async () => {
      const res = await fetch("/api/threat-intel/sync");
      if (res.ok) { const d = await res.json(); setSyncStatus(d); if (d.status !== "running") { clearInterval(poll); setSyncing(false); fetchStats(); } }
    }, 5000);
  };

  const handleCopy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Threat Intelligence Ingestion</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats ? `${stats.counts.activeSources} feeds · ${stats.counts.articles.toLocaleString()} articles · ${stats.counts.indicators.toLocaleString()} IoCs · ${stats.counts.threats} threat reports` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats?.lastSync && <span className="text-[10px] text-muted">Last: {new Date(stats.lastSync.completedAt).toLocaleString()}</span>}
          <button onClick={triggerSync} disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? "Syncing…" : "Sync All Feeds"}
          </button>
        </div>
      </div>

      {syncing && syncStatus && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span className="text-xs text-muted-foreground">Processing feeds — {syncStatus.articlesFound || 0} articles, {syncStatus.indicatorsFound || 0} IoCs</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {[
          { key: "dashboard", label: "Dashboard", icon: BarChart3 },
          { key: "threats", label: `Threats (${stats?.counts.threats || 0})`, icon: Shield },
          { key: "articles", label: `Articles (${stats?.counts.articles?.toLocaleString() || 0})`, icon: FileText },
          { key: "indicators", label: `IoCs (${stats?.counts.indicators?.toLocaleString() || 0})`, icon: Hash },
          { key: "vendors", label: "Third-Party Vendors", icon: Radar },
          { key: "sources", label: `Sources (${stats?.counts.sources || 0})`, icon: Globe },
        ].map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key as any); setPage(1); setCatFilter(""); setSevFilter(""); setExpandedId(null); }}
            className={cn("flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            )}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {tab === "dashboard" && stats && (
        <div className="space-y-4">
          {/* Top row — key metrics */}
          <div className="grid grid-cols-5 gap-3">
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-2xl font-bold text-danger">{stats.counts.threats}</p><p className="text-[9px] text-muted uppercase font-semibold mt-1">Threat Reports</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-2xl font-bold text-accent">{stats.counts.articles.toLocaleString()}</p><p className="text-[9px] text-muted uppercase font-semibold mt-1">Articles Collected</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-2xl font-bold text-warning">{stats.counts.indicators.toLocaleString()}</p><p className="text-[9px] text-muted uppercase font-semibold mt-1">Indicators (IoCs)</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-2xl font-bold text-success">{stats.counts.activeSources}</p><p className="text-[9px] text-muted uppercase font-semibold mt-1">Active Feed Sources</p></div>
            <div className="rounded-xl border border-border bg-card p-4"><p className="text-2xl font-bold text-purple">{stats.actors.length}</p><p className="text-[9px] text-muted uppercase font-semibold mt-1">Threat Actors Tracked</p></div>
          </div>

          {/* IoC Overview — full breakdown */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Indicators of Compromise — Overview</h3>
            <div className="grid grid-cols-5 gap-3">
              {Object.entries(stats.iocSummary || {}).map(([type, count]) => {
                const meta = IOC_META[type] || { label: type, icon: type.toUpperCase(), color: "text-muted bg-muted/10" };
                return (
                  <div key={type} className="rounded-lg border border-border bg-background p-3 flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold", meta.color)}>
                      {meta.icon}
                    </div>
                    <div>
                      <p className="text-lg font-bold text-foreground">{(count as number).toLocaleString()}</p>
                      <p className="text-[9px] text-muted-foreground uppercase">{meta.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-4">
            {/* Daily collection chart */}
            <div className="col-span-8 rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Daily Article Collection (30 days)</h3>
              {(stats.dailyArticleCounts || []).length > 0 ? (
                <div className="flex items-end gap-0.5 h-28">
                  {(stats.dailyArticleCounts || []).slice(-30).map((d: any) => {
                    const max = Math.max(1, ...stats.dailyArticleCounts.map((x: any) => x.count));
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${d.date}: ${d.count} articles`}>
                        <div className="w-full rounded-t bg-accent/60 group-hover:bg-accent transition-colors" style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }} />
                        {stats.dailyArticleCounts.length <= 14 && <p className="text-[7px] text-muted mt-0.5 rotate-45">{d.date.slice(5)}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-28 text-xs text-muted-foreground">Sync feeds to see collection data</div>
              )}
            </div>

            {/* Source categories */}
            <div className="col-span-4 rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Source Distribution</h3>
              {(stats.sourceCategories || []).map((c: any) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{c.name}</span>
                  <span className="font-bold text-foreground">{c.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Threat categories */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Threat Categories</h3>
              {(stats.categories || []).length > 0 ? stats.categories.map((c: any) => (
                <div key={c.name} className="flex items-center justify-between">
                  <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold", CAT_COLORS[c.name] || "bg-muted/10 text-muted")}>{c.name.replace("_", " ")}</span>
                  <span className="text-xs font-bold text-foreground">{c.count}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">Sync Threadlinqs to populate</p>}
            </div>

            {/* Top actors */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Top Threat Actors</h3>
              {(stats.actors || []).slice(0, 10).map((a: any) => (
                <div key={a.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate">{a.name}</span>
                  <span className="font-bold text-foreground">{a.count}</span>
                </div>
              ))}
              {(stats.actors || []).length === 0 && <p className="text-xs text-muted-foreground">Sync to populate</p>}
            </div>

            {/* Top sources by articles */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Top Sources</h3>
              {(stats.topSources || []).slice(0, 10).map((s: any) => (
                <div key={s.name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate">{s.name}</span>
                  <span className="font-bold text-foreground">{s.articleCount}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top articles by IoC count */}
          {(stats.topArticlesByIoc || []).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Top Articles by IoC Count</h3>
              <div className="space-y-1">
                {stats.topArticlesByIoc.slice(0, 8).map((a: any) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-card-hover transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground truncate">{a.sourceName}</span>
                      <span className="text-xs font-medium text-foreground group-hover:text-accent truncate">{a.title}</span>
                    </div>
                    <span className="text-xs font-bold text-warning shrink-0 ml-2">{a.iocCount} IoCs</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Sectors */}
          {(stats.sectors || []).length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Targeted Sectors</h3>
              <div className="flex flex-wrap gap-1.5">
                {stats.sectors.slice(0, 30).map((s: any) => (
                  <span key={s.name} className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] text-muted-foreground">
                    {s.name} <span className="font-bold text-foreground ml-0.5">{s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "dashboard" && loading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}

      {/* ═══ THREATS (unified from all sources) ═══ */}
      {tab === "threats" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="text" placeholder="Search threats, actors, techniques…" value={searchInput} onChange={(e) => handleSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
            </div>
            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:outline-none">
              <option value="">All Sources</option>
              <option value="threadlinqs">Threadlinqs</option>
              <option value="rss">RSS / Blog Feeds</option>
            </select>
            <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:outline-none">
              <option value="">All Categories</option>
              {["APT", "SUPPLY_CHAIN", "MALWARE", "RANSOMWARE", "VULNERABILITY", "ZERO_DAY", "PHISHING", "THREAT_INTEL"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sevFilter} onChange={(e) => { setSevFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:outline-none">
              <option value="">All Severities</option>
              {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-xs text-muted">{total} results</span>
          </div>

          {threats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
              <Shield className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No threats yet. Click "Sync All Feeds" to pull from Threadlinqs and RSS sources.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {threats.map((t) => {
                const isExpanded = expandedId === t.id;
                return (
                  <div key={t.id} className={cn("rounded-xl border bg-card overflow-hidden", t.severityLevel === "CRITICAL" ? "border-severity-critical/20" : t.severityLevel === "HIGH" ? "border-severity-high/20" : "border-border")}>
                    <button onClick={() => { setExpandedId(isExpanded ? null : t.id); setThreatTab("overview"); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover transition-colors text-left">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-muted">{t.threatId}</span>
                          <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold", SEV_COLORS[t.severityLevel] || "")}>{t.severityLevel}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold", CAT_COLORS[t.category] || "bg-muted/10 text-muted")}>{t.category?.replace("_", " ")}</span>
                          {t.cvssScore > 0 && <span className="text-[10px] text-muted font-mono">CVSS {t.cvssScore}</span>}
                          {t.threatActor && <span className="text-[10px] text-danger font-medium">{t.threatActor}</span>}
                          {t.nationState && <span className="text-[10px] text-muted">{t.nationState}</span>}
                          <span className="text-[10px] text-muted">{t.mitreTechniques?.length || 0} techniques · {t.detectionCount || t.detections?.length || 0} detections</span>
                          {t.sourceVendor && (
                            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold", t.sourceVendor === "threadlinqs" ? "bg-purple/10 text-purple" : "bg-accent/10 text-accent")}>
                              {t.sourceVendor === "threadlinqs" ? "Threadlinqs" : "RSS"}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border">
                        <div className="px-4 py-2 border-b border-border bg-background/50 flex items-center justify-end gap-2 flex-wrap">
                          <GenerateDetectionPackButton sourceType="ti" threatIntelReportId={t.id} size="sm" />
                          <GeneratePlaybookButton report={t} />
                        </div>
                        <div className="flex items-center border-b border-border bg-card-hover overflow-x-auto">
                          {["overview", "detections", "indicators", "mitre", "timeline", "refs"].map((st) => (
                            <button key={st} onClick={() => setThreatTab(st)}
                              className={cn("px-4 py-2 text-[10px] font-semibold uppercase border-b-2 -mb-px transition-colors whitespace-nowrap",
                                threatTab === st ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
                              )}>{st}</button>
                          ))}
                        </div>

                        <div className="px-4 py-4 space-y-3 bg-background">
                          {threatTab === "overview" && (
                            <>
                              <p className="text-xs text-muted-foreground leading-relaxed">{t.summary}</p>
                              {t.description && t.description !== t.summary && (
                                <details className="text-xs text-muted-foreground">
                                  <summary className="cursor-pointer text-accent hover:underline">Full Description</summary>
                                  <p className="mt-2 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-auto">{t.description}</p>
                                </details>
                              )}
                              <div className="grid grid-cols-4 gap-3 text-xs">
                                {[["Actor", t.threatActor], ["Nation", t.nationState], ["Motivation", t.motivation], ["Confidence", t.attributionConfidence]].map(([l, v]) => (
                                  <div key={l}><p className="text-[9px] text-muted uppercase font-semibold">{l}</p><p className="text-foreground">{v || "Unknown"}</p></div>
                                ))}
                              </div>
                              {t.targetSectors?.length > 0 && (
                                <div><p className="text-[9px] text-muted uppercase font-semibold mb-1">Sectors</p><div className="flex flex-wrap gap-1">{t.targetSectors.map((s: string) => <span key={s} className="rounded bg-muted/10 px-1.5 py-0.5 text-[9px] text-muted-foreground">{s}</span>)}</div></div>
                              )}
                              {t.affected?.length > 0 && (
                                <div><p className="text-[9px] text-muted uppercase font-semibold mb-1">Affected Products</p>{t.affected.map((a: any, i: number) => {
                                  const vers = a.versions ? (Array.isArray(a.versions) ? a.versions : (a.versions.vulnerable || [])) : [];
                                  return <span key={i} className="mr-2 text-xs text-muted-foreground">{a.vendor} {a.product}{vers.length > 0 ? ` (${vers.join(", ")})` : ""}</span>;
                                })}</div>
                              )}
                              {t.remediation && (t.remediation.immediate?.length > 0 || t.remediation.long_term?.length > 0) && (
                                <div><p className="text-[9px] text-muted uppercase font-semibold mb-1">Remediation</p>
                                  {t.remediation.immediate?.map((r: string, i: number) => <p key={i} className="text-[10px] text-muted-foreground">• {r}</p>)}
                                </div>
                              )}
                            </>
                          )}

                          {threatTab === "detections" && (
                            <div className="space-y-2">
                              <p className="text-[10px] text-muted">{(t.detections || []).length} detection rules</p>
                              {(t.detections || []).map((det: any) => (
                                <div key={det.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold text-accent uppercase">{det.detection_type}</span>
                                      <p className="text-xs font-medium text-foreground truncate">{det.name}</p>
                                    </div>
                                    <button onClick={() => handleCopy(det.query || det.kql_query || det.sigma_rule || "", det.id)} className="text-muted hover:text-foreground">
                                      {copiedId === det.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                                    </button>
                                  </div>
                                  {/* Show all available query types */}
                                  {det.query && <div><p className="text-[9px] text-muted mb-0.5">SPL</p><pre className="rounded bg-[#0d1117] p-2 text-[10px] text-green-400 font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">{det.query}</pre></div>}
                                  {det.kql_query && <div><p className="text-[9px] text-muted mb-0.5">KQL</p><pre className="rounded bg-[#0d1117] p-2 text-[10px] text-blue-400 font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">{det.kql_query}</pre></div>}
                                  {det.sigma_rule && <div><p className="text-[9px] text-muted mb-0.5">Sigma</p><pre className="rounded bg-[#0d1117] p-2 text-[10px] text-yellow-400 font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">{det.sigma_rule}</pre></div>}
                                  <div className="flex items-center gap-3 text-[9px] text-muted">
                                    <span>Severity: {det.severity}</span><span>Confidence: {det.confidence}</span>
                                    {det.data_sources?.length > 0 && <span>Sources: {det.data_sources.join(", ")}</span>}
                                    {det.mitre_mapping?.length > 0 && <span>MITRE: {det.mitre_mapping.join(", ")}</span>}
                                  </div>
                                  {det.tuning_notes && <p className="text-[9px] text-muted-foreground italic">{det.tuning_notes}</p>}
                                </div>
                              ))}
                              {(t.detections || []).length === 0 && <p className="text-xs text-muted-foreground">No detection rules available for this threat.</p>}
                            </div>
                          )}

                          {threatTab === "indicators" && (
                            <div className="space-y-3">
                              {Object.entries(t.iocs || {}).map(([cat, items]) => {
                                if (!items || !(items as any[]).length) return null;
                                return (
                                  <div key={cat}>
                                    <p className="text-[10px] font-semibold text-muted uppercase mb-1">{cat} ({(items as any[]).length})</p>
                                    <div className="space-y-1">
                                      {(items as any[]).map((ioc: any, i: number) => (
                                        <div key={i} className="flex items-center gap-2 rounded bg-background px-2 py-1.5 text-[10px]">
                                          <span className={cn("rounded px-1 py-0.5 text-[9px] font-mono font-bold shrink-0", IOC_META[ioc.type]?.color || "text-accent bg-accent/10")}>{ioc.type || cat}</span>
                                          <span className="font-mono text-foreground truncate flex-1">{ioc.value}</span>
                                          {ioc.context && <span className="text-muted truncate max-w-[200px]">{ioc.context}</span>}
                                          <button onClick={() => handleCopy(ioc.value, `ioc-${cat}-${i}`)} className="text-muted hover:text-foreground shrink-0">
                                            {copiedId === `ioc-${cat}-${i}` ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                              {Object.values(t.iocs || {}).every((v) => !(v as any[])?.length) && <p className="text-xs text-muted-foreground">No indicators available.</p>}
                            </div>
                          )}

                          {threatTab === "mitre" && (
                            <div className="space-y-1">
                              <p className="text-[10px] text-muted">{(t.mitreTechniques || []).length} techniques</p>
                              <div className="grid grid-cols-2 gap-1">
                                {(t.mitreTechniques || []).map((m: any, i: number) => (
                                  <div key={i} className="flex items-center gap-2 rounded bg-background px-2 py-1.5 text-[10px]">
                                    <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono font-bold text-accent shrink-0">{m.technique_id}</span>
                                    <span className="text-foreground truncate flex-1">{m.technique}</span>
                                    <span className="text-muted shrink-0 text-[9px]">{m.tactic}</span>
                                  </div>
                                ))}
                              </div>
                              {(t.mitreTechniques || []).length === 0 && <p className="text-xs text-muted-foreground">No MITRE ATT&CK mappings.</p>}
                            </div>
                          )}

                          {threatTab === "timeline" && (
                            <div className="space-y-1.5">
                              {(t.timeline || []).map((ev: any, i: number) => (
                                <div key={i} className="flex gap-3 text-[10px]">
                                  <span className="text-muted font-mono shrink-0 w-20">{ev.date}</span>
                                  <div className="flex-1">
                                    <span className="text-muted-foreground">{ev.event}</span>
                                    {ev.key && <span className="ml-2 text-[9px] text-accent font-medium">[{ev.key}]</span>}
                                  </div>
                                </div>
                              ))}
                              {(t.timeline || []).length === 0 && <p className="text-xs text-muted-foreground">No timeline data.</p>}
                            </div>
                          )}

                          {threatTab === "refs" && (
                            <div className="space-y-1">
                              {(t.references || []).map((ref: any, i: number) => (
                                <a key={i} href={ref.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-[10px] text-accent hover:underline py-0.5">
                                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{ref.title || ref.url}</span>
                                  {ref.type && <span className="text-[9px] text-muted shrink-0">({ref.type})</span>}
                                </a>
                              ))}
                              {(t.references || []).length === 0 && <p className="text-xs text-muted-foreground">No references.</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Threats pagination */}
          <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      {/* ═══ ARTICLES ═══ */}
      {tab === "articles" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input type="text" placeholder="Search articles…" value={searchInput} onChange={(e) => handleSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{total.toLocaleString()} articles</p>
            <p className="text-xs text-muted">Page {page} of {totalPages}</p>
          </div>
          {articles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
              <FileText className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No articles. Sync feeds to collect.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {articles.map((a) => {
                const isExpArticle = expandedId === a.id;
                return (
                  <div key={a.id} className="rounded-lg border border-border bg-card overflow-hidden">
                    <button onClick={() => setExpandedId(isExpArticle ? null : a.id)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-card-hover transition-colors text-left">
                      {isExpArticle ? <ChevronDown className="h-3 w-3 text-muted shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{a.title}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                          {a.source?.name && <span className="font-medium">{a.source.name}</span>}
                          {a.source?.category && <span className="rounded bg-muted/10 px-1 py-0.5 text-[8px] uppercase">{a.source.category}</span>}
                          {a.publishedAt && <span>{new Date(a.publishedAt).toLocaleDateString()}</span>}
                          {a.iocCount > 0 && <span className="text-warning font-bold">{a.iocCount} IoCs</span>}
                        </div>
                      </div>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded p-1 hover:bg-accent/10 text-muted hover:text-accent transition-colors" title="View Article">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </button>
                    {isExpArticle && (
                      <div className="border-t border-border bg-background px-4 py-3 space-y-2">
                        {a.summary && <p className="text-xs text-muted-foreground leading-relaxed">{a.summary}</p>}
                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Source</p><p className="text-foreground">{a.source?.name || "Unknown"}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Category</p><p className="text-foreground capitalize">{a.source?.category || "—"}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Published</p><p className="text-foreground">{a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : "—"}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">IoCs Extracted</p><p className="text-foreground font-bold">{a.iocCount}</p></div>
                        </div>
                        {a.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {a.tags.slice(0, 10).map((t: string) => <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">{t}</span>)}
                          </div>
                        )}
                        <a href={a.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-[10px] font-medium text-accent hover:bg-accent/20 transition-colors">
                          <ExternalLink className="h-3 w-3" /> View Full Article
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      {/* ═══ INDICATORS ═══ */}
      {tab === "indicators" && (
        <div className="space-y-3">
          {/* IoC summary cards at top */}
          {stats?.iocSummary && (
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(stats.iocSummary).slice(0, 5).map(([type, count]) => {
                const meta = IOC_META[type] || { label: type, icon: type, color: "text-muted bg-muted/10" };
                return (
                  <button key={type} onClick={() => { setCatFilter(catFilter === type ? "" : type); setPage(1); }}
                    className={cn("rounded-lg border p-2 text-center transition-colors", catFilter === type ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-card-hover")}>
                    <span className={cn("text-[9px] font-bold", meta.color.split(" ")[0])}>{meta.icon}</span>
                    <p className="text-sm font-bold text-foreground">{(count as number).toLocaleString()}</p>
                    <p className="text-[8px] text-muted uppercase">{meta.label}</p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="text" placeholder="Search by IP, domain, hash, CVE…" value={searchInput} onChange={(e) => handleSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
            </div>
            <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}
              className="h-9 rounded-lg border border-border bg-input px-3 text-xs text-foreground focus:outline-none">
              <option value="">All Types</option>
              {Object.keys(IOC_META).map((t) => <option key={t} value={t}>{IOC_META[t].label}</option>)}
            </select>
            <span className="text-xs text-muted">{total.toLocaleString()}</span>
          </div>

          {indicators.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
              <Hash className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No indicators found.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {indicators.map((ioc) => {
                const meta = IOC_META[ioc.type] || { icon: ioc.type, label: ioc.type, color: "text-muted bg-muted/10" };
                const isExp = expandedId === ioc.id;
                return (
                  <div key={ioc.id} className="rounded-lg border border-border bg-card overflow-hidden">
                    <button onClick={() => setExpandedId(isExp ? null : ioc.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card-hover transition-colors text-left">
                      {isExp ? <ChevronDown className="h-3 w-3 text-muted shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted shrink-0" />}
                      <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0", meta.color)}>{meta.icon}</span>
                      <span className="font-mono text-xs text-foreground truncate flex-1">{ioc.value}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {ioc.actorNames?.length > 0 && (
                          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[9px] font-semibold text-danger">{ioc.actorNames[0]}</span>
                        )}
                        {ioc.techniqueCount > 0 && (
                          <span className="text-[9px] text-accent font-mono">{ioc.techniqueCount} MITRE</span>
                        )}
                        <span className="text-[9px] text-muted">{ioc.sightings}x</span>
                        <span className="text-[9px] text-muted-foreground">{ioc.sourceName || ""}</span>
                        <button onClick={(e) => { e.stopPropagation(); handleCopy(ioc.value, ioc.id); }} className="text-muted hover:text-foreground">
                          {copiedId === ioc.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    </button>
                    {isExp && (
                      <div className="border-t border-border bg-background px-4 py-3 space-y-2">
                        <div className="grid grid-cols-5 gap-3 text-[10px]">
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Type</p><p className="text-foreground">{meta.label}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Confidence</p><p className="text-foreground capitalize">{ioc.confidence}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Sightings</p><p className="text-foreground font-bold">{ioc.sightings}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">First Seen</p><p className="text-foreground">{new Date(ioc.firstSeen).toLocaleDateString()}</p></div>
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Last Seen</p><p className="text-foreground">{new Date(ioc.lastSeen).toLocaleDateString()}</p></div>
                        </div>
                        {ioc.context && <div><p className="text-muted uppercase font-semibold text-[9px]">Context</p><p className="text-[10px] text-muted-foreground leading-relaxed">{ioc.context}</p></div>}
                        {ioc.actorNames?.length > 0 && (
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Linked Threat Actors</p>
                            <div className="flex gap-1 mt-0.5">{ioc.actorNames.map((a: string) => <span key={a} className="rounded bg-danger/10 px-1.5 py-0.5 text-[9px] font-semibold text-danger">{a}</span>)}</div>
                          </div>
                        )}
                        {ioc.mitreTechniques?.length > 0 && (
                          <div><p className="text-muted uppercase font-semibold text-[9px]">MITRE Techniques</p>
                            <div className="flex gap-1 mt-0.5">{ioc.mitreTechniques.map((t: string) => <span key={t} className="rounded bg-accent/10 px-1 py-0.5 text-[9px] font-mono font-bold text-accent">{t}</span>)}</div>
                          </div>
                        )}
                        {ioc.articleTitle && (
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Reference Article</p>
                            <a href={ioc.articleUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline flex items-center gap-1 mt-0.5">
                              <ExternalLink className="h-2.5 w-2.5" /> {ioc.articleTitle}
                            </a>
                            {ioc.sourceName && <p className="text-[9px] text-muted mt-0.5">Source: {ioc.sourceName} ({ioc.sourceCategory})</p>}
                          </div>
                        )}
                        {ioc.sourceRef && ioc.sourceRef !== ioc.articleUrl && (
                          <div><p className="text-muted uppercase font-semibold text-[9px]">Source URL</p>
                            <a href={ioc.sourceRef} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline flex items-center gap-1 mt-0.5">
                              <ExternalLink className="h-2.5 w-2.5" /> {ioc.sourceRef}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      {/* ═══ THIRD-PARTY VENDORS ═══ */}
      {tab === "vendors" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Third-Party Threat Intelligence Vendors</p>
              <p className="text-[10px] text-muted-foreground">Connect your own API keys to fetch enriched threat intelligence from third-party vendors</p>
            </div>
            <button onClick={fetchVendors} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {vendors.map((v) => {
              const isConfiguring = configuringVendor === v.name;
              return (
                <div key={v.name} className={cn("rounded-xl border bg-card overflow-hidden transition-all",
                  v.connected ? "border-success/20" : v.configured ? "border-accent/20" : "border-border"
                )}>
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{v.name}</p>
                          {v.connected && <span className="h-2 w-2 rounded-full bg-success" />}
                        </div>
                        <span className="rounded bg-muted/10 px-1.5 py-0.5 text-[8px] font-semibold text-muted-foreground uppercase">{v.category?.replace("_", " ")}</span>
                      </div>
                      {v.configured && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold",
                          v.connected ? "bg-success/10 text-success" : v.enabled ? "bg-accent/10 text-accent" : "bg-muted/10 text-muted"
                        )}>
                          {v.connected ? "Connected" : v.enabled ? "Enabled" : "Configured"}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed line-clamp-2">{v.description}</p>
                    {v.threatCount > 0 && (
                      <p className="text-[10px] text-accent font-medium mt-1">{v.threatCount} threats synced</p>
                    )}
                    {v.lastSyncAt && (
                      <p className="text-[9px] text-muted mt-0.5">Last sync: {new Date(v.lastSyncAt).toLocaleString()}</p>
                    )}
                    {v.lastError && <p className="text-[9px] text-danger mt-0.5 truncate">{v.lastError}</p>}
                  </div>

                  <div className="flex items-center border-t border-border">
                    <button onClick={() => { setConfiguringVendor(isConfiguring ? null : v.name); setVendorKey(v.apiKey === "••••••••" ? "" : v.apiKey || ""); }}
                      className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors border-r border-border",
                        isConfiguring ? "text-accent bg-accent/5" : "text-muted-foreground hover:bg-card-hover"
                      )}>
                      <Globe className="h-3 w-3" /> {v.configured ? "Configure" : "Set Up"}
                    </button>
                    <button disabled={!v.configured} onClick={() => {/* trigger vendor-specific sync */}}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30">
                      <Zap className="h-3 w-3" /> Sync
                    </button>
                  </div>

                  {isConfiguring && (
                    <div className="border-t border-border bg-background p-4 space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted uppercase">Auth Method</label>
                        <p className="text-xs text-foreground capitalize">{v.authMethod?.replace("_", " ") || "API Key"}</p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted uppercase">API URL</label>
                        <p className="text-xs text-muted-foreground font-mono">{v.apiUrl}</p>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-muted uppercase">API Key / Token</label>
                        <div className="relative">
                          <input type={showSecrets ? "text" : "password"} value={vendorKey} onChange={(e) => setVendorKey(e.target.value)}
                            placeholder="Enter your API key…"
                            className="h-8 w-full rounded-lg border border-border bg-input px-3 pr-8 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                          <button onClick={() => setShowSecrets(!showSecrets)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground">
                            {showSecrets ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={async () => {
                          setVendorSaving(true);
                          await fetch("/api/threat-intel/vendors", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: v.name, apiUrl: v.apiUrl, apiKey: vendorKey, authMethod: v.authMethod, enabled: true }),
                          });
                          await fetchVendors();
                          setVendorSaving(false);
                          setConfiguringVendor(null);
                        }} disabled={vendorSaving || !vendorKey}
                          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                          {vendorSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Save & Enable
                        </button>
                        <button onClick={() => setConfiguringVendor(null)}
                          className="rounded-lg border border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ SOURCES ═══ */}
      {tab === "sources" && <SourcesTab />}
    </div>
  );
}

function SourcesTab() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "bulk">("single");
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addCategory, setAddCategory] = useState("independent");
  const [bulkText, setBulkText] = useState("");
  const [addResult, setAddResult] = useState<{ added: number; duplicates: number; errors: string[] } | null>(null);
  const [adding, setAdding] = useState(false);

  const fetchSources = () => fetch("/api/threat-intel/sources").then((r) => r.json()).then((d) => setSources(d.items || [])).catch(() => {});
  useEffect(() => { fetchSources().finally(() => setLoading(false)); }, []);

  const seedSources = async () => {
    setSeeding(true);
    await fetch("/api/threat-intel/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seed" }) });
    await fetchSources();
    setSeeding(false);
  };

  const addSingle = async () => {
    if (!addUrl) return;
    setAdding(true); setAddResult(null);
    const existingUrls = new Set(sources.map((s) => s.feedUrl));
    if (existingUrls.has(addUrl)) {
      setAddResult({ added: 0, duplicates: 1, errors: [] });
      setAdding(false); return;
    }
    try {
      await fetch("/api/threat-intel/sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName || new URL(addUrl).hostname, feedUrl: addUrl, category: addCategory, type: "rss" }),
      });
      setAddResult({ added: 1, duplicates: 0, errors: [] });
      setAddName(""); setAddUrl("");
      await fetchSources();
    } catch (e) { setAddResult({ added: 0, duplicates: 0, errors: [String(e)] }); }
    setAdding(false);
  };

  const addBulk = async () => {
    if (!bulkText.trim()) return;
    setAdding(true); setAddResult(null);
    const existingUrls = new Set(sources.map((s) => s.feedUrl));
    let added = 0, duplicates = 0;
    const errors: string[] = [];

    // Parse input — supports one URL per line, JSON array, or comma-separated
    let urls: string[] = [];
    const trimmed = bulkText.trim();
    if (trimmed.startsWith("[")) {
      try { urls = JSON.parse(trimmed); } catch { errors.push("Invalid JSON array"); }
    } else {
      urls = trimmed.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
    }

    for (const url of urls) {
      if (!url.startsWith("http")) { errors.push(`Invalid URL: ${url.slice(0, 50)}`); continue; }
      if (existingUrls.has(url)) { duplicates++; continue; }
      try {
        await fetch("/api/threat-intel/sources", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: new URL(url).hostname, feedUrl: url, category: addCategory, type: "rss" }),
        });
        existingUrls.add(url);
        added++;
      } catch { errors.push(`Failed: ${url.slice(0, 50)}`); }
    }
    setAddResult({ added, duplicates, errors });
    setBulkText("");
    await fetchSources();
    setAdding(false);
  };

  const catCounts: Record<string, number> = {};
  for (const s of sources) catCounts[s.category] = (catCounts[s.category] || 0) + 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{sources.length} feed sources</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(!showAdd)}
            className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              showAdd ? "border-accent/40 bg-accent/5 text-accent" : "border-border text-muted-foreground hover:bg-card-hover"
            )}>
            <Globe className="h-3 w-3" /> Add Sources
          </button>
          <button onClick={seedSources} disabled={seeding}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
            {seeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {sources.length === 0 ? "Load Built-in Sources" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Add sources panel */}
      {showAdd && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setAddMode("single")} className={cn("rounded-lg px-3 py-1 text-[10px] font-medium transition-colors", addMode === "single" ? "bg-accent text-white" : "text-muted-foreground hover:bg-card-hover")}>Single URL</button>
            <button onClick={() => setAddMode("bulk")} className={cn("rounded-lg px-3 py-1 text-[10px] font-medium transition-colors", addMode === "bulk" ? "bg-accent text-white" : "text-muted-foreground hover:bg-card-hover")}>Bulk Import</button>
            <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)} className="h-7 rounded-lg border border-border bg-input px-2 text-[10px] text-foreground focus:outline-none ml-auto">
              {["independent", "vendor", "research", "cert", "media", "government"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {addMode === "single" ? (
            <div className="flex items-center gap-2">
              <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Source name (optional)"
                className="h-8 w-40 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:outline-none" />
              <input type="text" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="RSS/Atom feed URL *"
                className="h-8 flex-1 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:outline-none font-mono" />
              <button onClick={addSingle} disabled={adding || !addUrl}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Add
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"Paste URLs — one per line, comma-separated, or JSON array:\nhttps://example.com/feed/\nhttps://blog.example.com/rss.xml"} rows={4}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted focus:outline-none font-mono resize-y" />
              <button onClick={addBulk} disabled={adding || !bulkText.trim()}
                className="flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-[10px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Import All
              </button>
            </div>
          )}

          {addResult && (
            <div className={cn("rounded-lg border px-3 py-2 text-[10px]",
              addResult.added > 0 ? "border-success/30 bg-success/5 text-success" : addResult.duplicates > 0 ? "border-warning/30 bg-warning/5 text-warning" : "border-danger/30 bg-danger/5 text-danger"
            )}>
              {addResult.added > 0 && <span>{addResult.added} source{addResult.added !== 1 ? "s" : ""} added. </span>}
              {addResult.duplicates > 0 && <span>{addResult.duplicates} duplicate{addResult.duplicates !== 1 ? "s" : ""} skipped. </span>}
              {addResult.errors.length > 0 && <span>{addResult.errors.length} error{addResult.errors.length !== 1 ? "s" : ""}: {addResult.errors[0]}</span>}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
          <span key={cat} className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-medium text-muted-foreground">{cat} <span className="font-bold text-foreground">{count}</span></span>
        ))}
      </div>
      {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
      : sources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
          <Globe className="h-8 w-8 text-muted mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Click &quot;Load Built-in Sources&quot; to seed 174+ security feeds, or add your own.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {sources.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full shrink-0", s.active ? "bg-success" : "bg-muted")} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                <div className="flex items-center gap-2 text-[9px] text-muted">
                  {s.articleCount > 0 && <span>{s.articleCount} articles</span>}
                  {s.indicatorCount > 0 && <span>{s.indicatorCount} IoCs</span>}
                  {s.lastFetchedAt && <span>{new Date(s.lastFetchedAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <span className="rounded bg-muted/10 px-1 py-0.5 text-[8px] text-muted-foreground uppercase shrink-0">{s.category}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPageChange: (p: number) => void; onPageSizeChange?: (size: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between pt-3">
      <div className="flex items-center gap-3">
        <p className="text-[10px] text-muted">Page {page} of {totalPages} ({total.toLocaleString()} total)</p>
        {onPageSizeChange && (
          <select value={pageSize} onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
            className="h-7 rounded-lg border border-border bg-input px-1.5 text-[10px] text-foreground focus:outline-none">
            {[20, 50, 100, 200].map((s) => <option key={s} value={s}>{s} per page</option>)}
          </select>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30">
            <ChevronLeft className="h-3 w-3" /> Prev
          </button>
          {paginationRange(page, totalPages).map((p, i) =>
            p === "..." ? <span key={`d${i}`} className="text-[10px] text-muted px-1">…</span> : (
              <button key={p} onClick={() => onPageChange(p as number)}
                className={cn("h-7 w-7 rounded-lg text-[10px] font-medium transition-colors",
                  page === p ? "bg-accent text-white" : "text-muted-foreground hover:bg-card-hover"
                )}>{p}</button>
            )
          )}
          <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30">
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function paginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}
