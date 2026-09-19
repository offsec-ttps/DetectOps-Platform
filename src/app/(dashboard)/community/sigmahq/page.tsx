"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Search, Filter, Download, RefreshCw, Shield, Tag, ChevronLeft,
  ChevronRight, Loader2, ExternalLink, AlertTriangle, CheckCircle,
  Sparkles, Pencil, Trash2, ArrowUpDown,
} from "lucide-react";

interface SigmaRuleRow {
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

interface RulesResponse {
  items: SigmaRuleRow[];
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

const levelColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10",
  high: "text-severity-high bg-severity-high/10",
  medium: "text-severity-medium bg-severity-medium/10",
  low: "text-severity-low bg-severity-low/10",
  informational: "text-info bg-info/10",
};

const changeStatusBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "", color: "", icon: CheckCircle },
};

const statusColors: Record<string, string> = {
  stable: "text-success bg-success/10",
  test: "text-accent bg-accent/10",
  experimental: "text-warning bg-warning/10",
  deprecated: "text-danger bg-danger/10",
  unsupported: "text-muted bg-muted/10",
};

export default function SigmaHQRulesPage() {
  const [rules, setRules] = useState<SigmaRuleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Filters
  const [textSearch, setTextSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [changeFilter, setChangeFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [techniqueFilter, setTechniqueFilter] = useState("");
  const [sortBy, setSortBy] = useState("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/community/sigmahq/summary");
      const data: SummaryResponse = await res.json();
      setSummary(data);
    } catch {
      /* ignore */
    }
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
      if (levelFilter) params.set("level", levelFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (changeFilter) params.set("change_status", changeFilter);
      if (productFilter) params.set("logsource_product", productFilter);
      if (techniqueFilter) params.set("mitre_technique", techniqueFilter);

      const res = await fetch(`/api/community/sigmahq/rules?${params}`);
      const data: RulesResponse = await res.json();
      setRules(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, textSearch, levelFilter, statusFilter, changeFilter, productFilter, techniqueFilter, sortBy, sortDir]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setTextSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/community/sigmahq/sync", { method: "POST" });
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
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
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
            <span className="text-sm text-foreground font-medium">SigmaHQ</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">SigmaHQ Sigma Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary?.synced
              ? `${summary.totalRules.toLocaleString()} rules · ${summary.importedRules} imported · Last synced ${summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "never"}`
              : "Not yet synced — click Sync to fetch rules from SigmaHQ"}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync from GitHub"}
        </button>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className={cn(
          "rounded-lg border p-3 text-sm",
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
            placeholder="Search by title, description, or tag…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>
        <select value={levelFilter} onChange={(e) => { setLevelFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Levels</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="informational">Informational</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Statuses</option>
          <option value="stable">Stable</option>
          <option value="test">Test</option>
          <option value="experimental">Experimental</option>
          <option value="deprecated">Deprecated</option>
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
          placeholder="Product (e.g. windows)"
          value={productFilter}
          onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}
          className="h-9 w-40 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
        />
        <input
          type="text"
          placeholder="MITRE (e.g. T1003)"
          value={techniqueFilter}
          onChange={(e) => { setTechniqueFilter(e.target.value); setPage(1); }}
          className="h-9 w-36 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
        />
      </div>

      {/* Results count + pagination info */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{total.toLocaleString()} rules found</p>
        <p className="text-sm text-muted">Page {page} of {totalPages || 1}</p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Shield className="h-12 w-12 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No rules found</h3>
          <p className="text-sm text-muted-foreground">
            {summary?.synced ? "Try adjusting your filters." : "Click \"Sync from GitHub\" to fetch SigmaHQ rules."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted w-8"></th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("title")}>
                  <span className="flex items-center gap-1">Rule Name <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("level")}>
                  <span className="flex items-center gap-1">Level <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">MITRE</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Product</th>
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
                        "bg-severity-critical": rule.level === "critical",
                        "bg-severity-high": rule.level === "high",
                        "bg-severity-medium": rule.level === "medium",
                        "bg-severity-low": rule.level === "low",
                        "bg-info": rule.level === "informational",
                      })} />
                    </td>
                    <td className="px-4 py-3 max-w-[350px]">
                      <Link href={`/community/sigmahq/${rule.id}`} className="group-hover:text-accent transition-colors">
                        <p className="text-sm font-medium text-foreground group-hover:text-accent truncate">{rule.title}</p>
                        <p className="text-[10px] text-muted truncate mt-0.5">{rule.filePath}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", levelColors[rule.level] || "text-muted bg-muted/10")}>
                        {rule.level}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", statusColors[rule.status] || "text-muted bg-muted/10")}>
                        {rule.status}
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
                      <span className="text-xs text-muted-foreground">{rule.logsourceProduct || rule.logsourceCategory || "—"}</span>
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
                        <Link href={`/community/sigmahq/${rule.id}`} className="rounded p-1 hover:bg-background" title="View Detail">
                          <ExternalLink className="h-3.5 w-3.5 text-muted" />
                        </Link>
                        <a href={`/api/community/sigmahq/rules/${rule.id}/download`} className="rounded p-1 hover:bg-background" title="Download YAML">
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
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-30"
          >
            <ChevronLeft className="h-3 w-3" /> Previous
          </button>
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) {
              p = i + 1;
            } else if (page <= 4) {
              p = i + 1;
            } else if (page >= totalPages - 3) {
              p = totalPages - 6 + i;
            } else {
              p = page - 3 + i;
            }
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  p === page ? "bg-accent text-white" : "text-muted-foreground hover:bg-card"
                )}
              >
                {p}
              </button>
            );
          })}
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-30"
          >
            Next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
