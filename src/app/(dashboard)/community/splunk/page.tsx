"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  Search, Download, RefreshCw, Shield, Tag, ChevronLeft,
  ChevronRight, Loader2, ExternalLink, Sparkles, Pencil, Trash2,
  ArrowUpDown, CheckCircle, Flame, ShieldCheck,
} from "lucide-react";

interface SplunkRuleRow {
  id: string;
  detectionId: string;
  name: string;
  description: string;
  author: string;
  date: string;
  status: string;
  type: string;
  mitreTechniques: string[];
  mitreTactics: string[];
  analyticStories: string[];
  securityDomain: string;
  category: string;
  filePath: string;
  sourceUrl: string;
  verified?: boolean;
  verifiedAt?: string;
  verifiedTechnique?: string;
}

interface RulesResponse {
  items: SplunkRuleRow[];
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

const typeColors: Record<string, string> = {
  TTP: "text-danger bg-danger/10",
  Anomaly: "text-warning bg-warning/10",
  Hunting: "text-accent bg-accent/10",
  Correlation: "text-success bg-success/10",
};

const statusColors: Record<string, string> = {
  production: "bg-success/10 text-success",
  experimental: "bg-warning/10 text-warning",
  deprecated: "bg-muted/10 text-muted",
};

const changeStatusBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "", color: "", icon: CheckCircle },
};

export default function SplunkRulesPage() {
  const [rules, setRules] = useState<SplunkRuleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [textSearch, setTextSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tacticFilter, setTacticFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [techniqueFilter, setTechniqueFilter] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/community/splunk/summary");
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
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (tacticFilter) params.set("tactic", tacticFilter);
      if (domainFilter) params.set("security_domain", domainFilter);
      if (techniqueFilter) params.set("mitre_technique", techniqueFilter);

      const res = await fetch(`/api/community/splunk/rules?${params}`);
      const data: RulesResponse = await res.json();
      setRules(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, textSearch, typeFilter, statusFilter, categoryFilter, tacticFilter, domainFilter, techniqueFilter, sortBy, sortDir]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRules(); }, [fetchRules]);

  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => { setTextSearch(searchInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  const pollSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/community/splunk/sync");
      const data = await res.json();
      if (data.status === "completed") {
        setSyncing(false);
        setSyncResult(`Sync complete: ${data.newCount} new, ${data.modifiedCount} modified, ${data.deletedCount} deleted — ${data.totalAfterSync} total`);
        fetchSummary();
        fetchRules();
        return true;
      } else if (data.status === "failed") {
        setSyncing(false);
        setSyncResult(`Sync failed: ${data.error || "Unknown error"}`);
        return true;
      }
      return false; // still running
    } catch {
      return false;
    }
  }, [fetchSummary, fetchRules]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/community/splunk/sync", { method: "POST" });
      const data = await res.json();
      if (data.status === "started" || data.status === "running") {
        // Poll for completion
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const done = await pollSyncStatus();
          if (done && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }, 3000);
      } else if (data.status === "completed") {
        setSyncResult(`Sync complete: ${data.newCount} new, ${data.modifiedCount} modified, ${data.deletedCount} deleted — ${data.totalAfterSync} total`);
        setSyncing(false);
        fetchSummary();
        fetchRules();
      } else {
        setSyncResult(`Sync failed: ${data.error || "Unknown error"}`);
        setSyncing(false);
      }
    } catch (err) {
      setSyncResult(`Sync error: ${err}`);
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
            <span className="text-sm text-foreground font-medium">Splunk Security Content</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Splunk Security Content</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary?.synced
              ? `${summary.totalRules.toLocaleString()} detections · Last synced ${summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "never"}`
              : "Not yet synced — click Sync to fetch detections from Splunk Security Content"}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-purple px-4 py-2 text-sm font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50"
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
            placeholder="Search by name, description, technique, or analytic story…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Types</option>
          <option value="TTP">TTP</option>
          <option value="Anomaly">Anomaly</option>
          <option value="Hunting">Hunting</option>
          <option value="Correlation">Correlation</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Statuses</option>
          <option value="production">Production</option>
          <option value="experimental">Experimental</option>
          <option value="deprecated">Deprecated</option>
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Categories</option>
          <option value="endpoint">Endpoint</option>
          <option value="cloud">Cloud</option>
          <option value="application">Application</option>
          <option value="network">Network</option>
          <option value="web">Web</option>
        </select>
        <select value={domainFilter} onChange={(e) => { setDomainFilter(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="">All Domains</option>
          <option value="endpoint">Endpoint</option>
          <option value="access">Access</option>
          <option value="network">Network</option>
          <option value="threat">Threat</option>
        </select>
        <input
          type="text"
          placeholder="Tactic"
          value={tacticFilter}
          onChange={(e) => { setTacticFilter(e.target.value); setPage(1); }}
          className="h-9 w-32 rounded-lg border border-border bg-input px-3 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
        />
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
        <p className="text-sm text-muted">{total.toLocaleString()} detections found</p>
        <p className="text-sm text-muted">Page {page} of {totalPages || 1}</p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-purple" />
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Flame className="h-12 w-12 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">No detections found</h3>
          <p className="text-sm text-muted-foreground">
            {summary?.synced ? "Try adjusting your filters." : "Click \"Sync from GitHub\" to fetch Splunk Security Content detections."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted w-8"></th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Detection Name <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Type</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">MITRE</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("category")}>
                  <span className="flex items-center gap-1">Category <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Domain</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted cursor-pointer" onClick={() => toggleSort("date")}>
                  <span className="flex items-center gap-1">Date <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted w-16">Tested</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="group border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-3">
                    <div className={cn("h-2.5 w-2.5 rounded-full", {
                      "bg-danger": rule.type === "TTP",
                      "bg-warning": rule.type === "Anomaly",
                      "bg-accent": rule.type === "Hunting",
                      "bg-success": rule.type === "Correlation",
                    })} />
                  </td>
                  <td className="px-4 py-3 max-w-[350px]">
                    <Link href={`/community/splunk/${rule.id}`} className="group-hover:text-accent transition-colors">
                      <p className="text-sm font-medium text-foreground group-hover:text-purple truncate">{rule.name}</p>
                      <p className="text-[10px] text-muted truncate mt-0.5">{rule.author}</p>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", typeColors[rule.type] || "text-muted bg-muted/10")}>
                      {rule.type}
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
                      {rule.mitreTechniques.length > 3 && <span className="text-[10px] text-muted">+{rule.mitreTechniques.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground capitalize">{rule.category}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground capitalize">{rule.securityDomain}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted">{rule.date}</span>
                  </td>
                  <td className="px-4 py-3">
                    {rule.verified ? (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-success" title={`Verified against ${rule.verifiedTechnique || "simulation"}${rule.verifiedAt ? ` on ${new Date(rule.verifiedAt).toLocaleDateString()}` : ""}`}>
                        <ShieldCheck className="h-3.5 w-3.5" /> Working
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/community/splunk/${rule.id}`} className="rounded p-1 hover:bg-background" title="View Detail">
                        <ExternalLink className="h-3.5 w-3.5 text-muted" />
                      </Link>
                      {rule.sourceUrl && (
                        <a href={rule.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded p-1 hover:bg-background" title="View on GitHub">
                          <Download className="h-3.5 w-3.5 text-muted" />
                        </a>
                      )}
                    </div>
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
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            let p: number;
            if (totalPages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= totalPages - 3) p = totalPages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", p === page ? "bg-purple text-white" : "text-muted-foreground hover:bg-card")}>
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
