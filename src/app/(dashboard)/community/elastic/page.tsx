"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Search, Download, RefreshCw, Shield, Tag, ChevronLeft,
  ChevronRight, Loader2, ExternalLink, Sparkles, Pencil, Trash2,
  ArrowUpDown, CheckCircle, Zap,
} from "lucide-react";

interface ElasticRuleRow {
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

interface RulesResponse {
  items: ElasticRuleRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SummaryResponse {
  totalRules: number;
  importedRules: number;
  lastSyncAt: string | null;
  synced: boolean;
}

const severityColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10",
  high: "text-severity-high bg-severity-high/10",
  medium: "text-severity-medium bg-severity-medium/10",
  low: "text-severity-low bg-severity-low/10",
};

const changeStatusBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "", color: "", icon: CheckCircle },
};

const typeColors: Record<string, string> = {
  query: "text-accent bg-accent/10",
  eql: "text-purple bg-purple/10",
  threshold: "text-warning bg-warning/10",
  machine_learning: "text-info bg-info/10",
};

export default function ElasticRulesPage() {
  const [rules, setRules] = useState<ElasticRuleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [textSearch, setTextSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [changeFilter, setChangeFilter] = useState("");
  const [techniqueFilter, setTechniqueFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/community/elastic/summary");
      setSummary(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      if (textSearch) params.set("text_search", textSearch);
      if (severityFilter) params.set("severity", severityFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (platformFilter) params.set("platform", platformFilter);
      if (changeFilter) params.set("change_status", changeFilter);
      if (techniqueFilter) params.set("mitre_technique", techniqueFilter);

      const res = await fetch(`/api/community/elastic/rules?${params}`);
      const data: RulesResponse = await res.json();
      setRules(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, textSearch, severityFilter, typeFilter, platformFilter, changeFilter, techniqueFilter, sortBy, sortDir]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setTextSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/community/elastic/sync", { method: "POST" });
      const data = await res.json();
      if (data.status === "completed") {
        setSyncResult(`Sync complete: ${data.newCount} new, ${data.modifiedCount} modified, ${data.deletedCount} deleted — ${data.totalAfterSync} total`);
        fetchSummary();
        fetchRules();
      } else {
        setSyncResult(`Sync failed: ${data.error}`);
      }
    } catch (err) {
      setSyncResult(`Sync error: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/community" className="text-sm text-muted hover:text-accent transition-colors">Community</Link>
            <span className="text-muted">/</span>
            <span className="text-sm text-foreground font-medium">Elastic Detection Rules</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Elastic Detection Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary?.synced
              ? `${summary.totalRules.toLocaleString()} rules · ${summary.importedRules} imported · Last synced ${summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "never"}`
              : "Not yet synced — click Sync to fetch rules from Elastic"}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-medium text-white hover:bg-warning/90 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync from GitHub"}
        </button>
      </div>

      {syncResult && (
        <div className={cn("rounded-lg border p-3 text-sm", syncResult.includes("failed") || syncResult.includes("error") ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success")}>
          {syncResult}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by name, description, or tag…"
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
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Types</option>
          <option value="query">Query (KQL)</option>
          <option value="eql">EQL</option>
          <option value="threshold">Threshold</option>
          <option value="machine_learning">Machine Learning</option>
        </select>
        <select value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Platforms</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
          <option value="macos">macOS</option>
          <option value="cross-platform">Cross-Platform</option>
          <option value="network">Network</option>
          <option value="integrations">Integrations</option>
          <option value="ml">ML</option>
        </select>
        <select value={changeFilter} onChange={(e) => { setChangeFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Changes</option>
          <option value="new">New</option>
          <option value="modified">Modified</option>
          <option value="deleted">Deleted</option>
          <option value="unchanged">Unchanged</option>
        </select>
        <input
          type="text"
          placeholder="MITRE (e.g. T1003)"
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
          <Loader2 className="h-8 w-8 animate-spin text-warning" />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Zap className="h-12 w-12 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No rules found</h3>
          <p className="text-sm text-muted-foreground">
            {summary?.synced ? "Try adjusting your filters." : "Click \"Sync from GitHub\" to fetch Elastic Detection Rules."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted w-8"></th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Rule Name <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("severity")}>
                  <span className="flex items-center gap-1">Severity <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Type</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">MITRE</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Platform</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Change</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const changeCfg = changeStatusBadge[rule.changeStatus] || changeStatusBadge.unchanged;
                return (
                  <tr key={rule.id} className="group border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3">
                      <div className={cn("h-2.5 w-2.5 rounded-full", {
                        "bg-severity-critical": rule.severity === "critical",
                        "bg-severity-high": rule.severity === "high",
                        "bg-severity-medium": rule.severity === "medium",
                        "bg-severity-low": rule.severity === "low",
                      })} />
                    </td>
                    <td className="px-4 py-3 max-w-[350px]">
                      <Link href={`/community/elastic/${rule.id}`} className="group-hover:text-accent transition-colors">
                        <p className="text-sm font-medium text-foreground group-hover:text-accent truncate">{rule.name}</p>
                        <p className="text-[10px] text-muted truncate mt-0.5">{rule.filePath}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", severityColors[rule.severity] || "text-muted bg-muted/10")}>
                        {rule.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", typeColors[rule.type] || "text-muted bg-muted/10")}>
                        {rule.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {rule.mitreTechniques.slice(0, 3).map((t) => (
                          <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                        ))}
                        {rule.mitreTechniques.length > 3 && <span className="text-[10px] text-muted">+{rule.mitreTechniques.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground capitalize">{rule.platform}</span>
                    </td>
                    <td className="px-4 py-3">
                      {changeCfg.label && (
                        <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", changeCfg.color)}>
                          <changeCfg.icon className="h-2.5 w-2.5" />
                          {changeCfg.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/community/elastic/${rule.id}`} className="rounded p-1 hover:bg-background" title="View Detail">
                          <ExternalLink className="h-3.5 w-3.5 text-muted" />
                        </Link>
                        <a href={`/api/community/elastic/rules/${rule.id}/download`} className="rounded p-1 hover:bg-background" title="Download TOML">
                          <Download className="h-3.5 w-3.5 text-muted" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", p === page ? "bg-warning text-white" : "text-muted-foreground hover:bg-card")}>
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
