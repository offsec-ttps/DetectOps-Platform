"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Library,
  Search,
  Download,
  ExternalLink,
  Star,
  GitBranch,
  Shield,
  Check,
  Tag,
  ArrowRight,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Zap,
} from "lucide-react";

// Splunk rules now fetched from API (no more static rules)

// ── Unified rule interface ──────────────────────────────────────────

interface UnifiedRule {
  id: string;
  title: string;
  source: string;
  level: string;
  author: string;
  description: string;
  tags: string[];
  mitreTechniques: string[];
  logsourceProduct: string;
  importStatus: string;
  filePath?: string;
  detailHref: string;
}

interface SigmaAPIRule {
  id: string;
  title: string;
  status: string;
  level: string;
  tags: string[];
  mitreTechniques: string[];
  logsourceProduct: string;
  logsourceCategory: string;
  filePath: string;
  changeStatus: string;
  importStatus: string;
  author: string;
  date: string;
  modified: string;
}

interface ElasticAPIRule {
  id: string;
  name: string;
  severity: string;
  riskScore: number;
  type: string;
  language: string;
  tags: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  platform: string;
  filePath: string;
  changeStatus: string;
  importStatus: string;
  author: string[];
  updatedDate: string;
}

interface SplunkAPIRule {
  id: string;
  name: string;
  description: string;
  author: string;
  date: string;
  status: string;
  type: string;
  mitreTechniques: string[];
  mitreTactics: string[];
  category: string;
  securityDomain: string;
  filePath: string;
}

interface SummaryResponse {
  totalRules: number;
  importedRules: number;
  lastSyncAt: string | null;
  synced: boolean;
}

// Unified community_rules items (Phase 2-4 sources)
interface UnifiedSearchItem {
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

// Maps source slugs (used in the source filter dropdown) to the human-readable
// source names returned by the unified search API.
const UNIFIED_SOURCE_SLUGS: Record<string, string> = {
  "mitre-car": "MITRE CAR",
  sentinel: "Microsoft Sentinel",
  "defender-xdr": "Microsoft Defender XDR (Hunting)",
  "google-secops": "Google SecOps Chronicle",
  panther: "Panther Analysis",
  falco: "Falco",
  wazuh: "Wazuh Ruleset",
};
const UNIFIED_SLUG_LIST = Object.keys(UNIFIED_SOURCE_SLUGS);

// ── Styles ──────────────────────────────────────────────────────────

const sourceColors: Record<string, string> = {
  SigmaHQ: "text-accent bg-accent/15 border-accent/30",
  "Splunk Security Content": "text-purple bg-purple/15 border-purple/30",
  Splunk: "text-purple bg-purple/15 border-purple/30",
  "Elastic Detection Rules": "text-warning bg-warning/15 border-warning/30",
  Elastic: "text-warning bg-warning/15 border-warning/30",
  "MITRE CAR": "text-purple bg-purple/15 border-purple/30",
  "Microsoft Sentinel": "text-accent bg-accent/15 border-accent/30",
  Sentinel: "text-accent bg-accent/15 border-accent/30",
  "Defender XDR": "text-accent bg-accent/15 border-accent/30",
  "Google SecOps": "text-warning bg-warning/15 border-warning/30",
  "Panther": "text-success bg-success/15 border-success/30",
  "Falco": "text-danger bg-danger/15 border-danger/30",
  "Wazuh": "text-purple bg-purple/15 border-purple/30",
};

const levelColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10",
  high: "text-severity-high bg-severity-high/10",
  medium: "text-severity-medium bg-severity-medium/10",
  low: "text-severity-low bg-severity-low/10",
  informational: "text-info bg-info/10",
};

const importStatusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  available: { label: "Available", color: "text-muted", icon: Download },
  not_imported: { label: "Available", color: "text-muted", icon: Download },
  imported: { label: "Imported", color: "text-success", icon: Check },
  modified: { label: "Modified", color: "text-warning", icon: GitBranch },
  partial: { label: "Partial", color: "text-warning", icon: GitBranch },
};

function sourceLabel(s: string): string {
  if (s === "Splunk Security Content") return "Splunk";
  if (s === "Elastic Detection Rules") return "Elastic";
  if (s === "Microsoft Sentinel") return "Sentinel";
  if (s === "Microsoft Defender XDR (Hunting)") return "Defender XDR";
  if (s === "Google SecOps Chronicle") return "Google SecOps";
  if (s === "Panther Analysis") return "Panther";
  if (s === "Wazuh Ruleset") return "Wazuh";
  return s;
}

// ── Page ────────────────────────────────────────────────────────────

export default function CommunityContentPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // SigmaHQ state
  const [sigmaRules, setSigmaRules] = useState<SigmaAPIRule[]>([]);
  const [sigmaTotal, setSigmaTotal] = useState(0);
  const [sigmaSummary, setSigmaSummary] = useState<SummaryResponse | null>(null);

  // Elastic state
  const [elasticRules, setElasticRules] = useState<ElasticAPIRule[]>([]);
  const [elasticTotal, setElasticTotal] = useState(0);
  const [elasticSummary, setElasticSummary] = useState<SummaryResponse | null>(null);

  // Splunk state
  const [splunkRules, setSplunkRules] = useState<SplunkAPIRule[]>([]);
  const [splunkTotal, setSplunkTotal] = useState(0);
  const [splunkSummary, setSplunkSummary] = useState<SummaryResponse | null>(null);

  // Unified sources state (Phase 2-4: MITRE CAR, Sentinel, Defender XDR, Google SecOps, Panther, Falco, Wazuh)
  const [unifiedItems, setUnifiedItems] = useState<UnifiedSearchItem[]>([]);
  const [unifiedTotal, setUnifiedTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchQuery(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Fetch summaries
  useEffect(() => {
    fetch("/api/community/sigmahq/summary").then((r) => r.json()).then(setSigmaSummary).catch(() => {});
    fetch("/api/community/elastic/summary").then((r) => r.json()).then(setElasticSummary).catch(() => {});
    fetch("/api/community/splunk/summary").then((r) => r.json()).then(setSplunkSummary).catch(() => {});
  }, []);

  // Determine which sources to show
  const needSigma = sourceFilter === "all" || sourceFilter === "SigmaHQ";
  const needElastic = sourceFilter === "all" || sourceFilter === "Elastic";
  const needSplunk = sourceFilter === "all" || sourceFilter === "Splunk";
  // sourceFilter matches a unified slug (e.g. "sentinel", "falco") or "all"
  const needUnified = sourceFilter === "all" || UNIFIED_SLUG_LIST.includes(sourceFilter);

  // Fetch SigmaHQ rules
  const fetchSigmaRules = useCallback(async () => {
    if (!needSigma) {
      setSigmaRules([]); setSigmaTotal(0);
      return;
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: "title",
        sort_dir: "asc",
      });
      if (searchQuery) params.set("text_search", searchQuery);
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (productFilter) params.set("logsource_product", productFilter);

      const res = await fetch(`/api/community/sigmahq/rules?${params}`);
      const data = await res.json();
      setSigmaRules(data.items || []);
      setSigmaTotal(data.total || 0);
    } catch {
      setSigmaRules([]);
      setSigmaTotal(0);
    }
  }, [page, searchQuery, needSigma, levelFilter, productFilter]);

  // Fetch Elastic rules
  const fetchElasticRules = useCallback(async () => {
    if (!needElastic) {
      setElasticRules([]); setElasticTotal(0);
      return;
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: "name",
        sort_dir: "asc",
      });
      if (searchQuery) params.set("text_search", searchQuery);
      if (levelFilter !== "all") params.set("severity", levelFilter);
      if (productFilter) params.set("platform", productFilter);

      const res = await fetch(`/api/community/elastic/rules?${params}`);
      const data = await res.json();
      setElasticRules(data.items || []);
      setElasticTotal(data.total || 0);
    } catch {
      setElasticRules([]);
      setElasticTotal(0);
    }
  }, [page, searchQuery, needElastic, levelFilter, productFilter]);

  // Fetch Splunk rules
  const fetchSplunkRules = useCallback(async () => {
    if (!needSplunk) {
      setSplunkRules([]); setSplunkTotal(0);
      return;
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: "name",
        sort_dir: "asc",
      });
      if (searchQuery) params.set("text_search", searchQuery);
      if (productFilter) params.set("category", productFilter);

      const res = await fetch(`/api/community/splunk/rules?${params}`);
      const data = await res.json();
      setSplunkRules(data.items || []);
      setSplunkTotal(data.total || 0);
    } catch {
      setSplunkRules([]);
      setSplunkTotal(0);
    }
  }, [page, searchQuery, needSplunk, productFilter]);

  // Fetch unified community_rules (all Phase 2-4 sources)
  const fetchUnifiedRules = useCallback(async () => {
    if (!needUnified) {
      setUnifiedItems([]); setUnifiedTotal(0);
      return;
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (searchQuery) params.set("q", searchQuery);
      if (levelFilter !== "all") params.set("severity", levelFilter);
      if (productFilter) params.set("platform", productFilter);
      // If a specific unified source is selected, restrict to just that slug
      if (sourceFilter !== "all" && UNIFIED_SLUG_LIST.includes(sourceFilter)) {
        params.set("sources", sourceFilter);
      }

      const res = await fetch(`/api/community/unified/search?${params}`);
      const data = await res.json();
      setUnifiedItems(data.items || []);
      setUnifiedTotal(data.total || 0);
    } catch {
      setUnifiedItems([]);
      setUnifiedTotal(0);
    }
  }, [page, searchQuery, needUnified, levelFilter, productFilter, sourceFilter]);

  // Load all in parallel
  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSigmaRules(), fetchElasticRules(), fetchSplunkRules(), fetchUnifiedRules()]).finally(() => setLoading(false));
  }, [fetchSigmaRules, fetchElasticRules, fetchSplunkRules, fetchUnifiedRules]);

  // Re-fetch unified rules when background sync completes
  useEffect(() => {
    const handler = () => { fetchUnifiedRules(); };
    window.addEventListener("community-sync-complete", handler);
    return () => window.removeEventListener("community-sync-complete", handler);
  }, [fetchUnifiedRules]);

  // Build unified list
  const unifiedRules: UnifiedRule[] = [];

  // Splunk rules from API
  for (const r of splunkRules) {
    unifiedRules.push({
      id: r.id,
      title: r.name,
      source: "Splunk",
      level: r.type || "medium",
      author: r.author,
      description: r.description,
      tags: [],
      mitreTechniques: r.mitreTechniques,
      logsourceProduct: r.category,
      importStatus: "not_imported",
      filePath: r.filePath,
      detailHref: `/community/splunk/${r.id}`,
    });
  }

  // Elastic rules from API
  for (const r of elasticRules) {
    unifiedRules.push({
      id: r.id,
      title: r.name,
      source: "Elastic",
      level: r.severity,
      author: r.author.join(", "),
      description: "",
      tags: r.tags,
      mitreTechniques: r.mitreTechniques,
      logsourceProduct: r.platform,
      importStatus: r.importStatus,
      filePath: r.filePath,
      detailHref: `/community/elastic/${r.id}`,
    });
  }

  // SigmaHQ rules from API
  for (const r of sigmaRules) {
    unifiedRules.push({
      id: r.id,
      title: r.title,
      source: "SigmaHQ",
      level: r.level,
      author: r.author,
      description: "",
      tags: r.tags,
      mitreTechniques: r.mitreTechniques,
      logsourceProduct: r.logsourceProduct || r.logsourceCategory,
      importStatus: r.importStatus,
      filePath: r.filePath,
      detailHref: `/community/sigmahq/${r.id}`,
    });
  }

  // Phase 2-4 unified community_rules
  for (const r of unifiedItems) {
    // Map source type to the slug used in the [source] dynamic route
    const slug = r.sourceType === "kql" ? "sentinel" : r.sourceType;
    const detailHref = `/community/${slug}/${r.id}`;

    unifiedRules.push({
      id: r.id,
      title: r.title,
      source: r.sourceName,
      level: r.severity || "info",
      author: "",
      description: r.description,
      tags: [],
      mitreTechniques: r.mitreTechniques,
      logsourceProduct: r.platforms.join(", "),
      importStatus: "not_imported",
      detailHref,
    });
  }

  // Compute totals
  const grandTotal = (needSigma ? sigmaTotal : 0)
    + (needElastic ? elasticTotal : 0)
    + (needSplunk ? splunkTotal : 0)
    + (needUnified ? unifiedTotal : 0);
  const totalPages = Math.max(1, Math.ceil(grandTotal / pageSize));

  // Sync all sources — legacy + new Phase 2-4 sources
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // 1. Legacy sources (parallel, foreground — fast enough)
      const [sigmaRes, elasticRes, splunkRes] = await Promise.all([
        fetch("/api/community/sigmahq/sync", { method: "POST" }).then((r) => r.json()),
        fetch("/api/community/elastic/sync", { method: "POST" }).then((r) => r.json()),
        fetch("/api/community/splunk/sync", { method: "POST" }).then((r) => r.json()),
      ]);

      const parts: string[] = [];
      if (sigmaRes.status === "completed") {
        parts.push(`SigmaHQ: ${sigmaRes.newCount} new, ${sigmaRes.modifiedCount} mod — ${sigmaRes.totalAfterSync} total`);
      } else {
        parts.push(`SigmaHQ: failed (${sigmaRes.error})`);
      }
      if (elasticRes.status === "completed") {
        parts.push(`Elastic: ${elasticRes.newCount} new, ${elasticRes.modifiedCount} mod — ${elasticRes.totalAfterSync} total`);
      } else {
        parts.push(`Elastic: failed (${elasticRes.error})`);
      }
      if (splunkRes.status === "completed") {
        parts.push(`Splunk: ${splunkRes.newCount} new, ${splunkRes.modifiedCount} mod — ${splunkRes.totalAfterSync} total`);
      } else if (splunkRes.status === "started" || splunkRes.status === "running") {
        parts.push(`Splunk: sync started (runs in background)`);
      } else {
        parts.push(`Splunk: failed (${splunkRes.error})`);
      }

      // 2. Phase 2-4 sources — fire via refresh-all (runs with concurrency=2
      // and can take minutes for large repos). Fire-and-forget: the response
      // is streamed back in the background, and the SourceRegistryStrip auto-
      // refreshes its counts when complete.
      parts.push("New sources: syncing in background…");
      setSyncResult(parts.join(" | "));

      // Fire the new-source refresh WITHOUT awaiting — it runs in background
      fetch("/api/community/refresh-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concurrency: 2 }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data?.results) return;
          const newParts: string[] = [];
          for (const r of data.results) {
            if (r.ok) {
              newParts.push(`${r.name}: ${r.newCount ?? 0} new, ${r.modifiedCount ?? 0} mod — ${r.totalAfterSync ?? 0} total`);
            } else {
              newParts.push(`${r.name}: failed (${r.errorMessage})`);
            }
          }
          setSyncResult((prev) =>
            (prev || "").replace("New sources: syncing in background…",
              `New sources: ${newParts.join(" | ") || "done (no sources)"}`)
          );
          // Trigger SourceRegistryStrip re-fetch via a custom event
          window.dispatchEvent(new Event("community-sync-complete"));
        })
        .catch(() => {
          setSyncResult((prev) =>
            (prev || "").replace("New sources: syncing in background…", "New sources: refresh failed")
          );
        });

      // Refresh legacy summaries
      fetch("/api/community/sigmahq/summary").then((r) => r.json()).then(setSigmaSummary).catch(() => {});
      fetch("/api/community/elastic/summary").then((r) => r.json()).then(setElasticSummary).catch(() => {});
      fetch("/api/community/splunk/summary").then((r) => r.json()).then(setSplunkSummary).catch(() => {});
      setPage(1);
    } catch (err) {
      setSyncResult(`Error: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Community Content</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and import detection rules from all community sources — SigmaHQ, Elastic, Splunk, Sentinel, MITRE CAR, Defender XDR, Google SecOps, Panther, Falco, and Wazuh
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync All Sources"}
        </button>
      </div>

      {syncResult && (
        <div className={cn("rounded-lg border p-3 text-sm", syncResult.includes("failed") ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success")}>
          {syncResult}
        </div>
      )}

      {/* Phase 1: Additional sources from the source registry (purely additive) */}
      <SourceRegistryStrip />

      {/* Source Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Link href="/community/sigmahq" className="group rounded-xl border border-border bg-card p-4 hover:border-accent/40 hover:bg-card-hover transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-accent/15">
                <Shield className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">SigmaHQ</p>
                <p className="text-xs text-muted">
                  {sigmaSummary?.synced ? `${sigmaSummary.totalRules.toLocaleString()} rules` : "Not synced"} · {sigmaSummary?.importedRules || 0} imported
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted group-hover:text-accent transition-colors" />
          </div>
        </Link>

        <Link href="/community/splunk" className="group rounded-xl border border-border bg-card p-4 hover:border-purple/40 hover:bg-card-hover transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-purple/15">
                <Library className="h-5 w-5 text-purple" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-purple transition-colors">Splunk Security Content</p>
                <p className="text-xs text-muted">
                  {splunkSummary?.synced ? `${splunkSummary.totalRules.toLocaleString()} detections` : "Not synced"} · {splunkSummary?.importedRules || 0} imported
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted group-hover:text-purple transition-colors" />
          </div>
        </Link>

        <Link href="/community/elastic" className="group rounded-xl border border-border bg-card p-4 hover:border-warning/40 hover:bg-card-hover transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-warning/15">
                <Zap className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-warning transition-colors">Elastic Detection Rules</p>
                <p className="text-xs text-muted">
                  {elasticSummary?.synced ? `${elasticSummary.totalRules.toLocaleString()} rules` : "Not synced"} · {elasticSummary?.importedRules || 0} imported
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted group-hover:text-warning transition-colors" />
          </div>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search rules by name, technique, or tag…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" />
          <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
            <option value="all">All Sources</option>
            <option value="SigmaHQ">SigmaHQ</option>
            <option value="Splunk">Splunk</option>
            <option value="Elastic">Elastic</option>
            <option value="mitre-car">MITRE CAR</option>
            <option value="sentinel">Microsoft Sentinel</option>
            <option value="defender-xdr">Defender XDR</option>
            <option value="google-secops">Google SecOps</option>
            <option value="panther">Panther</option>
            <option value="falco">Falco</option>
            <option value="wazuh">Wazuh</option>
          </select>
          <select value={levelFilter} onChange={(e) => { setLevelFilter(e.target.value); setPage(1); }}
            className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
            <option value="all">All Levels</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="informational">Informational</option>
          </select>
          <input
            type="text"
            placeholder="Platform (e.g. windows)"
            value={productFilter}
            onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}
            className="h-9 w-44 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
          />
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{grandTotal.toLocaleString()} rules found across all sources</p>
        {totalPages > 1 && <p className="text-sm text-muted">Page {page} of {totalPages}</p>}
      </div>

      {/* Rules list */}
      {loading && page === 1 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      ) : unifiedRules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Shield className="h-12 w-12 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No rules found</h3>
          <p className="text-sm text-muted-foreground">
            {sigmaSummary?.synced || elasticSummary?.synced ? "Try adjusting your filters." : "Click \"Sync All Sources\" to fetch rules from GitHub."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {unifiedRules.map((rule) => {
            const statusCfg = importStatusConfig[rule.importStatus] || importStatusConfig.not_imported;
            const StatusIcon = statusCfg.icon;
            const srcLabel = sourceLabel(rule.source);

            return (
              <Link
                key={`${rule.source}-${rule.id}`}
                href={rule.detailHref}
                className="group block rounded-xl border border-border bg-card p-4 hover:bg-card-hover hover:border-accent/30 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground group-hover:text-accent transition-colors truncate">
                        {rule.title}
                      </h3>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold shrink-0", sourceColors[srcLabel] || sourceColors[rule.source])}>
                        {srcLabel}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0", levelColors[rule.level] || "text-muted bg-muted/10")}>
                        {rule.level}
                      </span>
                    </div>

                    {rule.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-1">{rule.description}</p>
                    )}

                    <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-muted">
                      {rule.mitreTechniques.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          {rule.mitreTechniques.slice(0, 3).map((t) => (
                            <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                          ))}
                          {rule.mitreTechniques.length > 3 && <span>+{rule.mitreTechniques.length - 3}</span>}
                        </div>
                      )}
                      {rule.logsourceProduct && (
                        <span className="rounded bg-background px-1.5 py-0.5 text-[10px]">{rule.logsourceProduct}</span>
                      )}
                      <span>by {rule.author}</span>
                      {rule.filePath && (
                        <span className="text-[10px] text-muted truncate max-w-[200px]">{rule.filePath}</span>
                      )}
                    </div>

                    {rule.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {rule.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                            <Tag className="h-2.5 w-2.5" />{tag}
                          </span>
                        ))}
                        {rule.tags.length > 5 && <span className="text-[10px] text-muted">+{rule.tags.length - 5}</span>}
                      </div>
                    )}
                  </div>

                  <div className="ml-4 flex flex-col items-end gap-2 shrink-0">
                    <div className={cn("flex items-center gap-1.5 text-xs font-medium", statusCfg.color)}>
                      <StatusIcon className="h-3.5 w-3.5" />
                      {statusCfg.label}
                    </div>
                    <span className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground group-hover:bg-accent group-hover:text-white transition-colors">
                      <ExternalLink className="h-3 w-3" /> View Details
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-30">
            <ChevronLeft className="h-3 w-3" /> Previous
          </button>
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", p === page ? "bg-accent text-white" : "text-muted-foreground hover:bg-card")}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-30">
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Phase 1: Source Registry strip (additive, non-breaking)
// Lists detection sources beyond the main SigmaHQ/Elastic/Splunk trio.
// New sources are gated by feature flags and only appear when enabled.
// ────────────────────────────────────────────────────────────────────

interface RegistrySource {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string;
  url: string;
  enabled: boolean;
  registered: boolean;
  totalRules: number;
  lastSyncAt: string | null;
}

function SourceRegistryStrip() {
  const [sources, setSources] = useState<RegistrySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<Record<string, string>>({});

  const fetchSources = useCallback(() => {
    fetch("/api/community/registry")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d || !d.flags?.expansion) return;
        const additional = (d.sources as RegistrySource[]).filter(
          (s) => !["sigmahq", "elastic", "splunk"].includes(s.id),
        );
        setSources(additional);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // Re-fetch counts when "Sync All Sources" background job finishes
  useEffect(() => {
    const handler = () => fetchSources();
    window.addEventListener("community-sync-complete", handler);
    return () => window.removeEventListener("community-sync-complete", handler);
  }, [fetchSources]);

  const handleSyncOne = async (sourceId: string) => {
    setSyncingId(sourceId);
    setSyncMsg((prev) => ({ ...prev, [sourceId]: "syncing…" }));
    try {
      const res = await fetch(`/api/community/unified/${sourceId}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.status === "completed") {
        setSyncMsg((prev) => ({
          ...prev,
          [sourceId]: `${data.newCount ?? 0} new, ${data.modifiedCount ?? 0} modified — ${data.totalAfterSync ?? 0} total`,
        }));
        fetchSources(); // refresh counts
      } else {
        setSyncMsg((prev) => ({ ...prev, [sourceId]: `failed: ${data.error || data.message || res.status}` }));
      }
    } catch (e: any) {
      setSyncMsg((prev) => ({ ...prev, [sourceId]: `error: ${e.message}` }));
    } finally {
      setSyncingId(null);
    }
  };

  if (loading || sources.length === 0) return null;

  const totalSynced = sources.filter((s) => s.registered).length;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Additional Detection Sources
        </p>
        <span className="text-[9px] text-muted-foreground">
          {totalSynced}/{sources.length} synced · {sources.reduce((a, s) => a + s.totalRules, 0).toLocaleString()} rules
        </span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {sources.map((s) => {
          const isSyncing = syncingId === s.id;
          const msg = syncMsg[s.id];
          return (
            <div
              key={s.id}
              className="group rounded-lg border border-border bg-background/50 hover:bg-card-hover hover:border-accent/30 transition-colors p-2.5"
            >
              <Link href={`/community/${s.id}`} className="block">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground group-hover:text-accent">
                    {s.name}
                  </span>
                  <span className={cn(
                    "text-[8px] font-medium px-1 py-0.5 rounded border",
                    s.registered && s.totalRules > 0
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-muted/10 text-muted-foreground border-border",
                  )}>
                    {s.registered && s.totalRules > 0 ? s.totalRules.toLocaleString() : "not synced"}
                  </span>
                </div>
                <p className="text-[9px] text-muted-foreground line-clamp-2">{s.description}</p>
                <p className="text-[8px] text-muted mt-1 uppercase">{s.category}</p>
              </Link>
              <div className="flex items-center justify-between mt-1.5">
                <Link href={`/community/${s.id}`} className={cn("text-[8px] font-medium", s.registered && s.totalRules > 0 ? "text-accent hover:underline" : "text-muted-foreground")}>
                  Browse rules →
                </Link>
                <button
                  onClick={(e) => { e.preventDefault(); handleSyncOne(s.id); }}
                  disabled={isSyncing || syncingId !== null}
                  className={cn(
                    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-medium transition-colors",
                    isSyncing
                      ? "text-accent"
                      : "text-muted-foreground hover:text-accent hover:bg-accent/10",
                    "disabled:opacity-40",
                  )}
                >
                  {isSyncing ? (
                    <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Syncing…</>
                  ) : (
                    <><RefreshCw className="h-2.5 w-2.5" /> Sync</>
                  )}
                </button>
              </div>
              {msg && (
                <p className={cn(
                  "text-[8px] mt-1 leading-tight",
                  msg.includes("failed") || msg.includes("error") ? "text-danger" : "text-success",
                )}>
                  {msg}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
