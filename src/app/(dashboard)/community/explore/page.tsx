"use client";

/**
 * Phase 5 — Unified Community Content Explorer
 *
 * Cross-source rule discovery for every NEW community source that writes into
 * the unified community_rules table (MITRE CAR, Microsoft Sentinel, Defender
 * XDR, Google SecOps, Panther, Falco, Wazuh).
 *
 * Legacy sources (SigmaHQ, Elastic, Splunk Security Content) intentionally
 * stay on their dedicated pages — this page is purely additive and never
 * touches their endpoints.
 *
 * Wires:
 *   GET /api/community/unified/search?q&sources&platform&technique&tactic&severity&ruleLanguage&page
 *   GET /api/community/unified/compare?ids=id1,id2,...   (up to 6)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Search, Filter, Layers, X, Loader2, ExternalLink, Shield,
  GitCompareArrows, Tag, ChevronLeft, ChevronRight, Sparkles,
  FileCode2,
} from "lucide-react";

interface SearchItem {
  id: string;
  sourceName: string;
  sourceType: string;
  upstreamRuleId: string;
  title: string;
  description: string;
  severity: string;
  ruleLanguage: string;
  ruleType: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  products: string[];
  sourceUrl: string;
}

interface SearchResponse {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sources: { id: string; name: string; type: string; totalRules: number }[];
}

interface CompareRule {
  id: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  upstreamRuleId: string;
  title: string;
  description: string;
  severity: string;
  ruleLanguage: string;
  ruleType: string;
  detectionLogicRaw: string;
  mitreTechniques: string[];
  mitreTactics: string[];
  platforms: string[];
  tags: string[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-danger bg-danger/15 border-danger/30",
  high: "text-warning bg-warning/15 border-warning/30",
  medium: "text-accent bg-accent/15 border-accent/30",
  low: "text-success bg-success/15 border-success/30",
  info: "text-muted-foreground bg-card-hover border-border",
};

const SOURCE_COLORS: Record<string, string> = {
  "mitre-car":     "text-purple bg-purple/15 border-purple/30",
  sentinel:        "text-accent bg-accent/15 border-accent/30",
  "defender-xdr":  "text-accent bg-accent/15 border-accent/30",
  "google-secops": "text-warning bg-warning/15 border-warning/30",
  panther:         "text-success bg-success/15 border-success/30",
  falco:           "text-danger bg-danger/15 border-danger/30",
  wazuh:           "text-purple bg-purple/15 border-purple/30",
};

function sourceSlugFromType(type: string) {
  if (type === "kql" || type === "sentinel") return "sentinel";
  return type;
}

export default function CommunityExplorePage() {
  const [q, setQ] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [platform, setPlatform] = useState("");
  const [technique, setTechnique] = useState("");
  const [tactic, setTactic] = useState("");
  const [severity, setSeverity] = useState("");
  const [ruleLanguage, setRuleLanguage] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Comparison tray
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareData, setCompareData] = useState<CompareRule[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  // Rule detail panel (opened via ?rule=<id> from Community Content page or row click)
  const searchParams = useSearchParams();
  const [detailRule, setDetailRule] = useState<CompareRule | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openRuleDetail = useCallback(async (ruleId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/community/unified/compare?ids=${ruleId}`);
      if (res.ok) {
        const j = await res.json();
        if (j.rules?.length > 0) setDetailRule(j.rules[0]);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Handle ?rule= param on mount
  useEffect(() => {
    const ruleId = searchParams.get("rule");
    if (ruleId && ruleId.length > 8) openRuleDetail(ruleId);
  }, [searchParams, openRuleDetail]);

  const fetchSearch = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (selectedSources.length) sp.set("sources", selectedSources.join(","));
      if (platform) sp.set("platform", platform);
      if (technique) sp.set("technique", technique);
      if (tactic) sp.set("tactic", tactic);
      if (severity) sp.set("severity", severity);
      if (ruleLanguage) sp.set("ruleLanguage", ruleLanguage);
      sp.set("page", String(page));
      sp.set("pageSize", "25");
      const res = await fetch(`/api/community/unified/search?${sp.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [q, selectedSources, platform, technique, tactic, severity, ruleLanguage, page]);

  useEffect(() => { fetchSearch(); }, [fetchSearch]);

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [q, selectedSources, platform, technique, tactic, severity, ruleLanguage]);

  const toggleSource = (slug: string) => {
    setSelectedSources((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 6) return prev;
      return [...prev, id];
    });
  };

  const openCompare = async () => {
    if (compareIds.length < 2) return;
    setCompareLoading(true);
    setCompareOpen(true);
    try {
      const res = await fetch(`/api/community/unified/compare?ids=${compareIds.join(",")}`);
      if (res.ok) {
        const j = await res.json();
        setCompareData(j.rules);
      }
    } finally {
      setCompareLoading(false);
    }
  };

  const clearFilters = () => {
    setQ(""); setSelectedSources([]); setPlatform(""); setTechnique("");
    setTactic(""); setSeverity(""); setRuleLanguage("");
  };

  const activeFilterCount = [q, platform, technique, tactic, severity, ruleLanguage]
    .filter(Boolean).length + selectedSources.length;

  // Sources facet — derived from API response
  const sourceFacets = useMemo(() => {
    if (!data) return [];
    return data.sources.map((s) => ({
      slug: sourceSlugFromType(s.type),
      name: s.name,
      type: s.type,
      total: s.totalRules,
    }));
  }, [data]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Layers className="h-6 w-6 text-accent" />
            Community Content Explorer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cross-source discovery across MITRE CAR, Sentinel, Defender XDR, Google SecOps, Panther, Falco, and Wazuh.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
            >
              <X className="h-3 w-3" /> Clear filters ({activeFilterCount})
            </button>
          )}
          <button
            onClick={openCompare}
            disabled={compareIds.length < 2}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-30 transition-colors"
          >
            <GitCompareArrows className="h-3 w-3" />
            Compare ({compareIds.length}/6)
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rules by title, description, or upstream id…"
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
        </div>

        {/* Source chips */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sourceFacets.map((s) => {
            const selected = selectedSources.includes(s.slug);
            const colorClass = SOURCE_COLORS[s.slug] ?? "text-foreground bg-card-hover border-border";
            return (
              <button
                key={s.slug}
                onClick={() => toggleSource(s.slug)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                  selected ? colorClass : "text-muted-foreground bg-background border-border hover:bg-card-hover",
                )}
              >
                {s.name} <span className="opacity-60">· {s.total}</span>
              </button>
            );
          })}
        </div>

        {/* Filter row */}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
          <input
            type="text"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="Platform (e.g. windows)"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
            placeholder="Technique (e.g. T1059)"
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <select
            value={tactic}
            onChange={(e) => setTactic(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
          >
            <option value="">All tactics</option>
            <option value="TA0001">Initial Access</option>
            <option value="TA0002">Execution</option>
            <option value="TA0003">Persistence</option>
            <option value="TA0004">Privilege Escalation</option>
            <option value="TA0005">Defense Evasion</option>
            <option value="TA0006">Credential Access</option>
            <option value="TA0007">Discovery</option>
            <option value="TA0008">Lateral Movement</option>
            <option value="TA0009">Collection</option>
            <option value="TA0010">Exfiltration</option>
            <option value="TA0011">Command and Control</option>
            <option value="TA0040">Impact</option>
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          <select
            value={ruleLanguage}
            onChange={(e) => setRuleLanguage(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-accent"
          >
            <option value="">All languages</option>
            <option value="kql">KQL</option>
            <option value="yara-l">YARA-L</option>
            <option value="python">Python (Panther)</option>
            <option value="falco-yaml">Falco YAML</option>
            <option value="wazuh-xml">Wazuh XML</option>
            <option value="car-yaml">MITRE CAR</option>
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-card-hover">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">
              {loading ? "Searching…" : `${data?.total ?? 0} rules`}
            </span>
          </div>
          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded p-1 hover:bg-background disabled:opacity-30"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span>Page {data.page} of {data.totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
                className="rounded p-1 hover:bg-background disabled:opacity-30"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {data && data.items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="h-8 w-8 text-muted mb-3" />
            <p className="text-sm text-muted-foreground">No rules match these filters.</p>
            <p className="text-[10px] text-muted-foreground mt-1">Try clearing filters or syncing more sources.</p>
          </div>
        )}

        <ul className="divide-y divide-border">
          {data?.items.map((item) => {
            const slug = sourceSlugFromType(item.sourceType);
            const sourceColor = SOURCE_COLORS[slug] ?? "text-foreground bg-card-hover border-border";
            const sevColor = SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.info;
            const inCompare = compareIds.includes(item.id);
            return (
              <li key={item.id} className="px-4 py-3 hover:bg-card-hover transition-colors cursor-pointer" onClick={() => openRuleDetail(item.id)}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={inCompare}
                    onChange={() => toggleCompare(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={!inCompare && compareIds.length >= 6}
                    className="mt-1 accent-accent"
                    title="Add to comparison"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", sourceColor)}>
                        {item.sourceName}
                      </span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", sevColor)}>
                        {item.severity || "info"}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-mono">{item.ruleLanguage}</span>
                      {item.ruleType && (
                        <span className="text-[9px] text-muted-foreground">· {item.ruleType}</span>
                      )}
                    </div>
                    <h3 className="mt-1 text-sm font-medium text-foreground truncate">{item.title}</h3>
                    {item.description && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{item.description}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {item.platforms.slice(0, 4).map((p) => (
                        <span key={p} className="rounded bg-background border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {p}
                        </span>
                      ))}
                      {item.mitreTechniques.slice(0, 5).map((t) => (
                        <span key={t} className="rounded bg-accent/10 border border-accent/20 px-1.5 py-0.5 text-[9px] text-accent font-mono">
                          {t}
                        </span>
                      ))}
                      {item.mitreTechniques.length > 5 && (
                        <span className="text-[9px] text-muted-foreground">+{item.mitreTechniques.length - 5}</span>
                      )}
                    </div>
                  </div>
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="Open upstream source"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Floating compare tray */}
      {compareIds.length > 0 && !compareOpen && (
        <div className="fixed bottom-4 right-4 z-40 rounded-xl border border-accent/30 bg-card shadow-lg px-4 py-3 flex items-center gap-3">
          <GitCompareArrows className="h-4 w-4 text-accent" />
          <span className="text-xs text-foreground">{compareIds.length} selected for comparison</span>
          <button
            onClick={openCompare}
            disabled={compareIds.length < 2}
            className="rounded bg-accent/10 border border-accent/30 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-30"
          >
            Compare
          </button>
          <button
            onClick={() => setCompareIds([])}
            className="rounded p-1 text-muted-foreground hover:bg-background"
            title="Clear"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Comparison modal */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-stretch p-4 overflow-auto">
          <div className="m-auto w-full max-w-[1600px] rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[95vh]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card-hover">
              <div className="flex items-center gap-2">
                <GitCompareArrows className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-foreground">
                  Side-by-side Comparison · {compareData.length} rules
                </h2>
              </div>
              <button
                onClick={() => setCompareOpen(false)}
                className="rounded p-1.5 text-muted-foreground hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {compareLoading && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!compareLoading && (
                <div
                  className="grid gap-3 p-4"
                  style={{ gridTemplateColumns: `repeat(${compareData.length}, minmax(360px, 1fr))` }}
                >
                  {compareData.map((rule) => {
                    const slug = sourceSlugFromType(rule.sourceType);
                    const sourceColor = SOURCE_COLORS[slug] ?? "text-foreground bg-card-hover border-border";
                    const sevColor = SEVERITY_COLORS[rule.severity] ?? SEVERITY_COLORS.info;
                    return (
                      <div key={rule.id} className="rounded-lg border border-border bg-background flex flex-col overflow-hidden">
                        <div className="border-b border-border p-3 bg-card-hover">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", sourceColor)}>
                              {rule.sourceName}
                            </span>
                            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", sevColor)}>
                              {rule.severity || "info"}
                            </span>
                          </div>
                          <h3 className="mt-2 text-sm font-semibold text-foreground">{rule.title}</h3>
                          <p className="mt-1 text-[10px] text-muted-foreground font-mono">{rule.upstreamRuleId}</p>
                        </div>
                        <div className="p-3 space-y-3 overflow-auto flex-1">
                          {rule.description && (
                            <div>
                              <p className="text-[9px] uppercase font-semibold text-muted-foreground mb-1">Description</p>
                              <p className="text-[11px] text-foreground leading-relaxed">{rule.description}</p>
                            </div>
                          )}
                          {(rule.mitreTechniques.length > 0 || rule.mitreTactics.length > 0) && (
                            <div>
                              <p className="text-[9px] uppercase font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                                <Shield className="h-2.5 w-2.5" /> MITRE ATT&amp;CK
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {rule.mitreTactics.map((t) => (
                                  <span key={t} className="rounded bg-purple/10 border border-purple/30 px-1.5 py-0.5 text-[9px] text-purple font-mono">{t}</span>
                                ))}
                                {rule.mitreTechniques.map((t) => (
                                  <span key={t} className="rounded bg-accent/10 border border-accent/20 px-1.5 py-0.5 text-[9px] text-accent font-mono">{t}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {rule.platforms.length > 0 && (
                            <div>
                              <p className="text-[9px] uppercase font-semibold text-muted-foreground mb-1">Platforms</p>
                              <div className="flex flex-wrap gap-1">
                                {rule.platforms.map((p) => (
                                  <span key={p} className="rounded bg-background border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">{p}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {rule.tags.length > 0 && (
                            <div>
                              <p className="text-[9px] uppercase font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                                <Tag className="h-2.5 w-2.5" /> Tags
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {rule.tags.slice(0, 12).map((t) => (
                                  <span key={t} className="rounded bg-background border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div>
                            <p className="text-[9px] uppercase font-semibold text-muted-foreground mb-1">
                              Detection Logic · {rule.ruleLanguage}
                            </p>
                            <pre className="rounded bg-card-hover border border-border p-2 text-[9px] font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-auto">
                              {rule.detectionLogicRaw}
                            </pre>
                          </div>
                          {rule.sourceUrl && (
                            <a
                              href={rule.sourceUrl}
                              target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> Open upstream source
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Rule detail panel ── */}
      {(detailRule || detailLoading) && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card-hover">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-foreground">Rule Detail</h2>
              </div>
              <button onClick={() => setDetailRule(null)} className="rounded p-1.5 text-muted-foreground hover:bg-background">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {detailLoading && !detailRule && (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {detailRule && (() => {
                const rule = detailRule;
                const slug = sourceSlugFromType(rule.sourceType);
                const sourceColor = SOURCE_COLORS[slug] ?? "text-foreground bg-card-hover border-border";
                const sevColor = SEVERITY_COLORS[rule.severity] ?? SEVERITY_COLORS.info;
                return (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase", sourceColor)}>
                        {rule.sourceName}
                      </span>
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase", sevColor)}>
                        {rule.severity || "info"}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">{rule.ruleLanguage}</span>
                      {rule.ruleType && <span className="text-[10px] text-muted-foreground">· {rule.ruleType}</span>}
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{rule.title}</h3>
                      <p className="text-[10px] text-muted-foreground font-mono mt-1">{rule.upstreamRuleId}</p>
                    </div>

                    {rule.description && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Description</p>
                        <p className="text-sm text-foreground leading-relaxed">{rule.description}</p>
                      </div>
                    )}

                    {(rule.mitreTechniques.length > 0 || rule.mitreTactics.length > 0) && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                          <Shield className="h-3 w-3" /> MITRE ATT&CK
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {rule.mitreTactics.map((t) => (
                            <span key={t} className="rounded bg-purple/10 border border-purple/30 px-2 py-0.5 text-[10px] text-purple font-mono">{t}</span>
                          ))}
                          {rule.mitreTechniques.map((t) => (
                            <span key={t} className="rounded bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10px] text-accent font-mono">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {rule.platforms.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Platforms</p>
                        <div className="flex flex-wrap gap-1.5">
                          {rule.platforms.map((p) => (
                            <span key={p} className="rounded bg-background border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {rule.tags.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1 flex items-center gap-1">
                          <Tag className="h-3 w-3" /> Tags
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {rule.tags.slice(0, 20).map((t) => (
                            <span key={t} className="rounded bg-background border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">{t}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
                        Detection Logic · {rule.ruleLanguage}
                      </p>
                      <pre className="rounded-lg bg-card-hover border border-border p-3 text-[11px] font-mono text-foreground whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-auto">
                        {rule.detectionLogicRaw}
                      </pre>
                    </div>

                    {rule.sourceUrl && (
                      <a
                        href={rule.sourceUrl}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> View in upstream repository
                      </a>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
