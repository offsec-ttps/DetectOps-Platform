"use client";

/**
 * Generic source list page for unified community sources.
 *
 * Handles: mitre-car, sentinel, defender-xdr, google-secops, panther, falco, wazuh.
 * Legacy sources (splunk, elastic) have their own dedicated pages under
 * /community/splunk and /community/elastic — this route won't fire for those
 * because Next.js prefers static routes over dynamic ones.
 * SigmaHQ also has its own at /community/sigmahq.
 */

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import {
  Search, RefreshCw, Shield, Tag, ChevronLeft, ChevronRight,
  Loader2, ExternalLink, Sparkles, Pencil, Trash2, Check,
  ArrowUpDown, FileCode2,
} from "lucide-react";

const UNIFIED_SOURCES: Record<string, { name: string; color: string; accentColor: string; description: string }> = {
  "mitre-car":     { name: "MITRE CAR",                       color: "text-purple bg-purple/15 border-purple/30",   accentColor: "text-purple", description: "MITRE Cyber Analytics Repository — analytic rationale, ATT&CK mapping, and tool-specific implementations." },
  sentinel:        { name: "Microsoft Sentinel",               color: "text-accent bg-accent/15 border-accent/30",   accentColor: "text-accent", description: "Microsoft Sentinel detection rules and hunting queries (KQL)." },
  "defender-xdr":  { name: "Microsoft Defender XDR",           color: "text-accent bg-accent/15 border-accent/30",   accentColor: "text-accent", description: "Microsoft Defender XDR advanced hunting queries (KQL)." },
  "google-secops": { name: "Google SecOps Chronicle",          color: "text-warning bg-warning/15 border-warning/30", accentColor: "text-warning", description: "Google SecOps Chronicle detection rules (YARA-L)." },
  panther:         { name: "Panther Analysis",                 color: "text-success bg-success/15 border-success/30", accentColor: "text-success", description: "Panther detection rules and policies (Python + YAML)." },
  falco:           { name: "Falco",                            color: "text-danger bg-danger/15 border-danger/30",   accentColor: "text-danger", description: "Falco runtime security rules for containers and hosts." },
  wazuh:           { name: "Wazuh Ruleset",                    color: "text-purple bg-purple/15 border-purple/30",   accentColor: "text-purple", description: "Wazuh HIDS XML rules — host log correlation, file integrity, vulnerability detection." },
};

const severityColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10",
  high: "text-severity-high bg-severity-high/10",
  medium: "text-severity-medium bg-severity-medium/10",
  low: "text-severity-low bg-severity-low/10",
  info: "text-info bg-info/10",
};

const changeBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "", color: "", icon: Check },
};

interface RuleRow {
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
  items: RuleRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SyncSummary {
  totalRules: number;
  changeStatusCounts: Record<string, number>;
  lastSyncAt: string | null;
}

export default function UnifiedSourcePage() {
  const params = useParams();
  const source = params.source as string;
  const meta = UNIFIED_SOURCES[source];

  // If not a unified source, let the 404 propagate (sigmahq is handled by its own route)
  if (!meta) notFound();

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [techniqueFilter, setTechniqueFilter] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setTextSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/community/unified/${source}/summary`);
      if (res.ok) setSummary(await res.json());
    } catch {}
  }, [source]);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        sources: source,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (textSearch) sp.set("q", textSearch);
      if (severityFilter) sp.set("severity", severityFilter);
      if (platformFilter) sp.set("platform", platformFilter);
      if (techniqueFilter) sp.set("technique", techniqueFilter);

      const res = await fetch(`/api/community/unified/search?${sp}`);
      const data: SearchResponse = await res.json();
      setRules(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [source, page, textSearch, severityFilter, platformFilter, techniqueFilter]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/community/unified/${source}/sync`, { method: "POST" });
      const data = await res.json();
      if (data.status === "completed") {
        setSyncResult(`Sync complete: ${data.newCount} new, ${data.modifiedCount} modified, ${data.deletedCount} deleted — ${data.totalAfterSync} total`);
        fetchSummary();
        fetchRules();
      } else {
        setSyncResult(`Sync failed: ${data.error || data.message}`);
      }
    } catch (err) {
      setSyncResult(`Sync error: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/community" className="text-sm text-muted hover:text-accent transition-colors">Community</Link>
            <span className="text-muted">/</span>
            <span className={cn("text-sm font-medium", meta.accentColor)}>{meta.name}</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">{meta.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary && summary.totalRules > 0
              ? `${summary.totalRules.toLocaleString()} rules · Last synced ${summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "never"}`
              : meta.description}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50",
            meta.accentColor.replace("text-", "bg-"),
            `hover:opacity-90`,
          )}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync from GitHub"}
        </button>
      </div>

      {syncResult && (
        <div className={cn("rounded-lg border p-3 text-sm",
          syncResult.includes("failed") || syncResult.includes("error")
            ? "border-danger/30 bg-danger/5 text-danger"
            : "border-success/30 bg-success/5 text-success"
        )}>
          {syncResult}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by title, description, or rule id…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>
        <select value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
        <input
          type="text"
          placeholder="Platform (e.g. windows)"
          value={platformFilter}
          onChange={(e) => { setPlatformFilter(e.target.value); setPage(1); }}
          className="h-9 w-40 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
        />
        <input
          type="text"
          placeholder="MITRE (e.g. T1059)"
          value={techniqueFilter}
          onChange={(e) => { setTechniqueFilter(e.target.value); setPage(1); }}
          className="h-9 w-36 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
        />
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{total.toLocaleString()} rules found</p>
        <p className="text-sm text-muted">Page {page} of {totalPages || 1}</p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className={cn("h-8 w-8 animate-spin", meta.accentColor)} />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Shield className="h-12 w-12 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No rules found</h3>
          <p className="text-sm text-muted-foreground">
            {summary && summary.totalRules > 0 ? "Try adjusting your filters." : `Click "Sync from GitHub" to fetch ${meta.name} rules.`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted w-8"></th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Rule Name</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Severity</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Language</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">MITRE</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Platforms</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="group border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-3">
                    <div className={cn("h-2.5 w-2.5 rounded-full", {
                      "bg-severity-critical": rule.severity === "critical",
                      "bg-severity-high": rule.severity === "high",
                      "bg-severity-medium": rule.severity === "medium",
                      "bg-severity-low": rule.severity === "low",
                      "bg-info": rule.severity === "info" || !rule.severity,
                    })} />
                  </td>
                  <td className="px-4 py-3 max-w-[400px]">
                    <Link href={`/community/${source}/${rule.id}`} className="block group-hover:text-accent transition-colors">
                      <p className={cn("text-sm font-medium text-foreground truncate", `group-hover:${meta.accentColor}`)}>{rule.title}</p>
                      {rule.description && (
                        <p className="text-[10px] text-muted truncate mt-0.5">{rule.description.slice(0, 100)}</p>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                      severityColors[rule.severity] || "text-muted bg-muted/10")}>
                      {rule.severity || "info"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-card-hover px-2 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                      {rule.ruleLanguage}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {rule.mitreTechniques.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                      ))}
                      {rule.mitreTechniques.length > 3 && (
                        <span className="text-[10px] text-muted">+{rule.mitreTechniques.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {rule.platforms.slice(0, 2).map((p) => (
                        <span key={p} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/community/${source}/${rule.id}`}
                      className={cn("flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors",
                        `group-hover:bg-${meta.accentColor.replace("text-", "")} group-hover:text-white group-hover:border-transparent hover:bg-card-hover`
                      )}
                    >
                      <ExternalLink className="h-3 w-3" /> View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-30">
            <ChevronLeft className="h-3 w-3" /> Previous
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  p === page
                    ? cn(meta.accentColor.replace("text-", "bg-"), "text-white")
                    : "text-muted-foreground hover:bg-card"
                )}>
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
