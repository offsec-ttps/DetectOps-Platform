"use client";

/**
 * Replay Dataset Library — additive page that lets analysts browse the
 * local Splunk attack_data repository, save datasets, build replay plans,
 * and replay datasets into Splunk via HEC. Does not touch the existing
 * simulation flow or Search API validation logic.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Search, Filter, X, Database, FileText, ExternalLink,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Bookmark, Hammer, Zap,
  ChevronRight, Play, Trash2, Download, Copy, Clock, ScrollText, Layers,
} from "lucide-react";
import HecConfigPanel from "@/components/replay/HecConfigPanel";

// ── Types (mirror server) ──

interface DatasetRow {
  row_id: string;
  dataset_id: string;
  dataset_name: string;
  title: string | null;
  description: string | null;
  platform: string | null;
  log_type: string | null;
  mitre_attack_ids: string[];
  environment: string | null;
  data_file_path: string;
  metadata_file_path: string;
  index: string;
  source: string;
  sourcetype: string;
  replay_supported: boolean;
  build_replay_available: boolean;
  replay_now_available: boolean;
  data_file_exists: boolean;
  data_file_size_bytes: number;
  category: string | null;
  author: string | null;
  date: string | null;
  directory: string | null;
}

interface RepoStatus {
  root: string;
  exists: boolean;
  scannedAt: string | null;
  totalYamlFiles: number;
  totalDatasets: number;
  parseErrors: { file: string; error: string }[];
  facets: {
    platforms: string[];
    categories: string[];
    logTypes: string[];
    environments: string[];
    sourcetypes: string[];
    mitreIds: string[];
  };
}

interface CatalogResponse {
  enabled: boolean;
  rows: DatasetRow[];
  total: number;
  filtered: number;
  page: number;
  pageSize: number;
  status: RepoStatus;
  hec: { splunkHost: string; hecPort: number; tokenConfigured: boolean; ready: boolean };
}

interface SavedItem {
  id: string;
  datasetId: string;
  datasetName: string;
  collection: string;
  notes: string | null;
  createdAt: string;
  metadataPath: string;
  dataFilePath: string;
}

interface ReplayPlan {
  id: string;
  name: string;
  datasetName: string;
  dataFilePath: string;
  index: string;
  source: string;
  sourcetype: string;
  hostOverride: string | null;
  notes: string | null;
  commandPreview: string | null;
  status: string;
  createdAt: string;
  lastExecutedAt: string | null;
}

interface ExecutionRecord {
  id: string;
  datasetName: string;
  status: string;
  bytesSent: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

// ── Helpers ──

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function platformColor(platform: string | null): string {
  const m: Record<string, string> = {
    windows: "text-[#0078D4] border-[#0078D4]/30 bg-[#0078D4]/5",
    linux: "text-warning border-warning/30 bg-warning/5",
    aws: "text-[#FF9900] border-[#FF9900]/30 bg-[#FF9900]/5",
    azure: "text-[#0078D4] border-[#0078D4]/30 bg-[#0078D4]/5",
    m365: "text-[#D83B01] border-[#D83B01]/30 bg-[#D83B01]/5",
    gcp: "text-[#4285F4] border-[#4285F4]/30 bg-[#4285F4]/5",
    network: "text-purple border-purple/30 bg-purple/5",
    kubernetes: "text-info border-info/30 bg-info/5",
    macos: "text-muted border-border bg-muted/5",
  };
  return m[platform || ""] || "text-muted-foreground border-border bg-card";
}

// ══════════════════════════════════════════════
// Main page
// ══════════════════════════════════════════════

export default function ReplayCatalogPage() {
  const [activeTab, setActiveTab] = useState<"catalog" | "saved" | "plans" | "history">("catalog");

  // Catalog state
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<{
    platform: string; category: string; logType: string;
    environment: string; sourcetype: string; mitreId: string;
    replayableOnly: boolean;
  }>({
    platform: "", category: "", logType: "", environment: "",
    sourcetype: "", mitreId: "", replayableOnly: false,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  // Detail drawer
  const [selectedRow, setSelectedRow] = useState<DatasetRow | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Saved + plans + history
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [plans, setPlans] = useState<ReplayPlan[]>([]);
  const [history, setHistory] = useState<ExecutionRecord[]>([]);

  // Build replay form
  const [buildPlan, setBuildPlan] = useState<{
    open: boolean; row: DatasetRow | null;
    name: string; index: string; source: string; sourcetype: string;
    hostOverride: string; notes: string;
  }>({
    open: false, row: null, name: "", index: "", source: "", sourcetype: "", hostOverride: "", notes: "",
  });

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Build query string
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (filters.platform) params.set("platform", filters.platform);
    if (filters.category) params.set("category", filters.category);
    if (filters.logType) params.set("logType", filters.logType);
    if (filters.environment) params.set("environment", filters.environment);
    if (filters.sourcetype) params.set("sourcetype", filters.sourcetype);
    if (filters.mitreId) params.set("mitreId", filters.mitreId);
    if (filters.replayableOnly) params.set("replayableOnly", "true");
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return params.toString();
  }, [debouncedQ, filters, page, pageSize]);

  // Fetch catalog
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/replay/catalog?${queryString}`);
      if (!res.ok) throw new Error(`Catalog API returned ${res.status}`);
      const json: CatalogResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  // Reset page when filters change (not on initial mount)
  useEffect(() => { setPage(1); }, [debouncedQ, filters]);

  // Refresh repo cache
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/replay/refresh", { method: "POST" });
      await fetchCatalog();
    } finally {
      setRefreshing(false);
    }
  };

  // Fetch saved/plans/history when their tabs become active
  const fetchSaved = useCallback(async () => {
    try { const r = await fetch("/api/replay/saved"); if (r.ok) { const d = await r.json(); setSavedItems(d.items || []); } } catch {}
  }, []);
  const fetchPlans = useCallback(async () => {
    try { const r = await fetch("/api/replay/plans"); if (r.ok) { const d = await r.json(); setPlans(d.plans || []); } } catch {}
  }, []);
  const fetchHistory = useCallback(async () => {
    try { const r = await fetch("/api/replay/history?limit=100"); if (r.ok) { const d = await r.json(); setHistory(d.executions || []); } } catch {}
  }, []);

  useEffect(() => {
    if (activeTab === "saved") fetchSaved();
    if (activeTab === "plans") fetchPlans();
    if (activeTab === "history") fetchHistory();
  }, [activeTab, fetchSaved, fetchPlans, fetchHistory]);

  // Toast helper
  const showResult = (type: "success" | "error", message: string) => {
    setActionResult({ type, message });
    setTimeout(() => setActionResult(null), 4000);
  };

  // ── Actions ──

  const handleSaveForLater = async (row: DatasetRow) => {
    setActionLoading(`save-${row.row_id}`);
    try {
      const r = await fetch("/api/replay/saved", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId: row.row_id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showResult("success", `Saved ${row.dataset_name} for later`);
      if (activeTab === "saved") fetchSaved();
    } catch (e: any) {
      showResult("error", `Save failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReplayNow = async (row: DatasetRow) => {
    if (!confirm(`Replay ${row.dataset_name} now? This will send ${fmtBytes(row.data_file_size_bytes)} to Splunk HEC.`)) return;
    setActionLoading(`replay-${row.row_id}`);
    try {
      const r = await fetch("/api/replay/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId: row.row_id }),
      });
      const d = await r.json();
      if (d.success) {
        showResult("success", `Replayed: ${fmtBytes(d.execution.bytesSent)} in ${d.execution.durationMs}ms`);
      } else {
        showResult("error", `Replay failed: ${d.result?.error || d.error || "unknown"}`);
      }
      if (activeTab === "history") fetchHistory();
    } catch (e: any) {
      showResult("error", `Replay error: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const openBuildReplay = (row: DatasetRow) => {
    setBuildPlan({
      open: true, row,
      name: `${row.dataset_name} replay`,
      index: row.index, source: row.source, sourcetype: row.sourcetype,
      hostOverride: "", notes: "",
    });
  };

  const handleBuildReplay = async () => {
    if (!buildPlan.row) return;
    setActionLoading(`build-${buildPlan.row.row_id}`);
    try {
      const r = await fetch("/api/replay/plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId: buildPlan.row.row_id,
          name: buildPlan.name,
          index: buildPlan.index,
          source: buildPlan.source,
          sourcetype: buildPlan.sourcetype,
          hostOverride: buildPlan.hostOverride || null,
          notes: buildPlan.notes,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showResult("success", `Replay plan created`);
      setBuildPlan({ ...buildPlan, open: false });
      if (activeTab === "plans") fetchPlans();
    } catch (e: any) {
      showResult("error", `Build failed: ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunPlan = async (plan: ReplayPlan) => {
    if (!confirm(`Execute plan "${plan.name}"?`)) return;
    setActionLoading(`run-${plan.id}`);
    try {
      const r = await fetch("/api/replay/execute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id, dataFilePath: plan.dataFilePath,
          datasetId: plan.datasetName, datasetName: plan.datasetName,
          index: plan.index, source: plan.source, sourcetype: plan.sourcetype,
          hostOverride: plan.hostOverride,
        }),
      });
      const d = await r.json();
      if (d.success) showResult("success", `Plan executed: ${fmtBytes(d.execution.bytesSent)}`);
      else showResult("error", d.result?.error || d.error || "Failed");
      fetchPlans();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    await fetch(`/api/replay/saved?id=${id}`, { method: "DELETE" });
    fetchSaved();
  };

  const handleDeletePlan = async (id: string) => {
    if (!confirm("Delete this plan?")) return;
    await fetch(`/api/replay/plans?id=${id}`, { method: "DELETE" });
    fetchPlans();
  };

  const handleExportCsv = () => {
    if (!data?.rows) return;
    const headers = ["dataset_id", "dataset_name", "platform", "mitre_attack_ids", "sourcetype", "source", "index", "data_file_path", "data_file_size_bytes"];
    const csv = [
      headers.join(","),
      ...data.rows.map((r) => headers.map((h) => {
        const v = (r as any)[h];
        if (Array.isArray(v)) return `"${v.join(";")}"`;
        return `"${String(v ?? "").replace(/"/g, '""')}"`;
      }).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `replay-catalog-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const facets = data?.status?.facets;
  const totalPages = data ? Math.ceil(data.filtered / pageSize) : 1;
  const hecReady = data?.hec?.ready ?? false;
  const repoExists = data?.status?.exists ?? false;

  // ── Render ──

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Replay Dataset Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and replay curated attack logs from the local Splunk attack_data repository — no live simulation needed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExportCsv} disabled={!data?.rows?.length}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-50">
            <Download className="h-3 w-3" /> Export CSV
          </button>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            {refreshing ? "Scanning..." : "Re-scan repository"}
          </button>
        </div>
      </div>

      {/* Repo / HEC status banner */}
      <div className="grid grid-cols-3 gap-3">
        <div className={cn("rounded-xl border p-3", repoExists ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5")}>
          <div className="flex items-center gap-2">
            {repoExists ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />}
            <span className="text-xs font-semibold text-foreground">attack_data Repo</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate" title={data?.status.root}>{data?.status.root || "(not configured)"}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {data?.status.totalDatasets || 0} datasets · {data?.status.totalYamlFiles || 0} YAML files · {data?.status.parseErrors.length || 0} parse errors
          </p>
        </div>
        <div className={cn("rounded-xl border p-3", hecReady ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
          <div className="flex items-center gap-2">
            {hecReady ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
            <span className="text-xs font-semibold text-foreground">Splunk HEC</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {data?.hec?.splunkHost ? `${data.hec.splunkHost}:${data.hec.hecPort}` : "Not configured"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {data?.hec?.tokenConfigured ? "Token saved" : "Click “Splunk HEC configuration” below to set up"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-foreground">This view</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {data?.filtered || 0} of {data?.total || 0} datasets shown · page {page}/{totalPages || 1}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Last scan: {data?.status.scannedAt ? new Date(data.status.scannedAt).toLocaleTimeString() : "—"}
          </p>
        </div>
      </div>

      {/* HEC config panel — collapsible; auto-expands when not ready */}
      <HecConfigPanel onConfigChanged={fetchCatalog} />

      {/* Toast */}
      {actionResult && (
        <div className={cn("rounded-lg border px-4 py-2.5 text-xs flex items-center gap-2",
          actionResult.type === "success" ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"
        )}>
          {actionResult.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {actionResult.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: "catalog" as const, label: "Catalog", icon: Database, count: data?.total },
          { key: "saved" as const, label: "Saved", icon: Bookmark, count: savedItems.length || undefined },
          { key: "plans" as const, label: "Replay Plans", icon: Hammer, count: plans.length || undefined },
          { key: "history" as const, label: "History", icon: Clock, count: history.length || undefined },
        ]).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={cn("flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            {t.count !== undefined && <span className="text-[10px] text-muted-foreground">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* ═══ CATALOG TAB ═══ */}
      {activeTab === "catalog" && (
        <div className="space-y-3">
          {/* Search + filters */}
          <div className="rounded-xl border border-border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by dataset name, ID, MITRE ID, sourcetype, description..."
                  className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted"
                />
              </div>
              <button
                onClick={() => setFilters({ platform: "", category: "", logType: "", environment: "", sourcetype: "", mitreId: "", replayableOnly: false })}
                className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1.5">
                Clear filters
              </button>
            </div>

            {/* Filter selects */}
            <div className="grid grid-cols-6 gap-2">
              <FilterSelect label="Platform" value={filters.platform} options={facets?.platforms || []}
                onChange={(v) => setFilters({ ...filters, platform: v })} />
              <FilterSelect label="Category" value={filters.category} options={facets?.categories || []}
                onChange={(v) => setFilters({ ...filters, category: v })} />
              <FilterSelect label="Log Type" value={filters.logType} options={facets?.logTypes || []}
                onChange={(v) => setFilters({ ...filters, logType: v })} />
              <FilterSelect label="Environment" value={filters.environment} options={facets?.environments || []}
                onChange={(v) => setFilters({ ...filters, environment: v })} />
              <FilterSelect label="Sourcetype" value={filters.sourcetype} options={facets?.sourcetypes || []}
                onChange={(v) => setFilters({ ...filters, sourcetype: v })} />
              <div>
                <label className="text-[9px] text-muted-foreground">MITRE ID</label>
                <input type="text" value={filters.mitreId} onChange={(e) => setFilters({ ...filters, mitreId: e.target.value })}
                  placeholder="T1059.001" className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={filters.replayableOnly}
                onChange={(e) => setFilters({ ...filters, replayableOnly: e.target.checked })}
                className="rounded border-border" />
              Show only datasets with existing data files (replay-ready)
            </label>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {loading && !data && (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
            )}
            {error && (
              <div className="px-4 py-3 text-xs text-danger bg-danger/5">Error: {error}</div>
            )}
            {data && data.rows.length === 0 && !loading && (
              <div className="text-center py-12 text-xs text-muted-foreground">
                No datasets match your filters. Try clearing them or re-scanning the repository.
              </div>
            )}
            {data && data.rows.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-background/50 text-[10px] text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Dataset</th>
                    <th className="px-3 py-2 text-left font-medium">Platform</th>
                    <th className="px-3 py-2 text-left font-medium">MITRE</th>
                    <th className="px-3 py-2 text-left font-medium">Sourcetype</th>
                    <th className="px-3 py-2 text-left font-medium">Source</th>
                    <th className="px-3 py-2 text-left font-medium">Size</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.row_id} className="border-b border-border/30 hover:bg-card-hover/30 cursor-pointer" onClick={() => setSelectedRow(row)}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {row.data_file_exists ? (
                            <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-danger shrink-0" />
                          )}
                          <div>
                            <p className="text-xs font-medium text-foreground">{row.dataset_name}</p>
                            <p className="text-[9px] text-muted-foreground">{row.category || "—"} · {row.directory || row.dataset_id.slice(0, 12)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {row.platform ? (
                          <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded border", platformColor(row.platform))}>{row.platform}</span>
                        ) : <span className="text-[10px] text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-0.5">
                          {row.mitre_attack_ids.slice(0, 2).map((id) => (
                            <span key={id} className="text-[9px] font-mono text-accent bg-accent/10 rounded px-1">{id}</span>
                          ))}
                          {row.mitre_attack_ids.length > 2 && (
                            <span className="text-[9px] text-muted">+{row.mitre_attack_ids.length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <code className="text-[9px] text-muted-foreground">{row.sourcetype}</code>
                      </td>
                      <td className="px-3 py-2.5"><code className="text-[9px] text-muted-foreground truncate max-w-[120px] inline-block" title={row.source}>{row.source}</code></td>
                      <td className="px-3 py-2.5"><span className="text-[10px] text-muted-foreground">{row.data_file_exists ? fmtBytes(row.data_file_size_bytes) : "—"}</span></td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => handleSaveForLater(row)} disabled={actionLoading !== null}
                            title="Save for later"
                            className="p-1 rounded hover:bg-accent/10 text-muted-foreground hover:text-accent disabled:opacity-30">
                            {actionLoading === `save-${row.row_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bookmark className="h-3 w-3" />}
                          </button>
                          <button onClick={() => handleReplayNow(row)} disabled={actionLoading !== null || !row.replay_now_available || !hecReady}
                            title={!hecReady ? "Configure SPLUNK_HOST and SPLUNK_HEC_TOKEN" : "Replay now"}
                            className="p-1 rounded hover:bg-success/10 text-muted-foreground hover:text-success disabled:opacity-30">
                            {actionLoading === `replay-${row.row_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                          </button>
                          <button onClick={() => openBuildReplay(row)} disabled={actionLoading !== null || !row.build_replay_available}
                            title="Build replay plan"
                            className="p-1 rounded hover:bg-warning/10 text-muted-foreground hover:text-warning disabled:opacity-30">
                            <Hammer className="h-3 w-3" />
                          </button>
                          <button onClick={() => setSelectedRow(row)}
                            className="p-1 rounded hover:bg-card-hover text-muted-foreground hover:text-foreground">
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {data && data.filtered > pageSize && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.filtered)} of {data.filtered}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                  className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-card-hover disabled:opacity-30">
                  Previous
                </button>
                <span className="text-[10px] text-muted-foreground">Page {page} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                  className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-card-hover disabled:opacity-30">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ SAVED TAB ═══ */}
      {activeTab === "saved" && (
        <div className="space-y-2">
          {savedItems.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Bookmark className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No saved datasets yet</p>
              <p className="text-[10px] text-muted mt-1">Click the bookmark icon on any catalog row to save it</p>
            </div>
          )}
          {savedItems.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{item.datasetName}</p>
                <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[600px]">{item.dataFilePath}</p>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded">{item.collection}</span>
                  <span>Saved {new Date(item.createdAt).toLocaleString()}</span>
                  {item.notes && <span>· {item.notes}</span>}
                </div>
              </div>
              <button onClick={() => handleDeleteSaved(item.id)}
                className="p-1 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ═══ PLANS TAB ═══ */}
      {activeTab === "plans" && (
        <div className="space-y-2">
          {plans.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Hammer className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No replay plans yet</p>
              <p className="text-[10px] text-muted mt-1">Click the hammer icon on a catalog row to build a reusable replay plan</p>
            </div>
          )}
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                  <p className="text-[10px] text-muted-foreground">{plan.datasetName}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px]">
                    <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded">index: {plan.index}</span>
                    <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded">source: {plan.source}</span>
                    <span className="bg-accent/10 text-accent px-1.5 py-0.5 rounded">{plan.sourcetype}</span>
                    <span className={cn("px-1.5 py-0.5 rounded",
                      plan.status === "executed" ? "bg-success/10 text-success" : "bg-muted/10 text-muted-foreground"
                    )}>{plan.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleRunPlan(plan)} disabled={actionLoading === `run-${plan.id}` || !hecReady}
                    className="flex items-center gap-1 rounded bg-success/10 border border-success/30 px-2 py-1 text-[10px] font-medium text-success hover:bg-success/20 disabled:opacity-30">
                    {actionLoading === `run-${plan.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Execute
                  </button>
                  <button onClick={() => handleDeletePlan(plan.id)} className="p-1 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {plan.commandPreview && (
                <details className="mt-2">
                  <summary className="text-[10px] text-accent cursor-pointer hover:underline">Show command preview</summary>
                  <pre className="mt-1 p-2 bg-background rounded text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">{plan.commandPreview}</pre>
                </details>
              )}
              {plan.notes && <p className="text-[10px] text-muted-foreground mt-2 italic">{plan.notes}</p>}
              {plan.lastExecutedAt && <p className="text-[9px] text-muted mt-1">Last executed: {new Date(plan.lastExecutedAt).toLocaleString()}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ═══ HISTORY TAB ═══ */}
      {activeTab === "history" && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {history.length === 0 && (
            <div className="text-center py-12">
              <ScrollText className="h-8 w-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No replay history yet</p>
            </div>
          )}
          {history.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50 text-[10px] text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Dataset</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Bytes</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-b border-border/30">
                    <td className="px-3 py-2 text-xs text-foreground">{e.datasetName}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded border",
                        e.status === "success" ? "border-success/30 bg-success/5 text-success" :
                        e.status === "failed" ? "border-danger/30 bg-danger/5 text-danger" :
                        "border-warning/30 bg-warning/5 text-warning"
                      )}>{e.status}</span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{fmtBytes(e.bytesSent)}</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{e.durationMs}ms</td>
                    <td className="px-3 py-2 text-[10px] text-muted-foreground">{new Date(e.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-[10px] text-danger truncate max-w-[200px]" title={e.errorMessage || ""}>{e.errorMessage || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Detail Drawer ── */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedRow(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[520px] h-full bg-card border-l border-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border px-5 py-3 flex items-center justify-between z-10">
              <h3 className="text-sm font-semibold text-foreground">{selectedRow.dataset_name}</h3>
              <button onClick={() => setSelectedRow(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Description */}
              {selectedRow.description && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-xs text-foreground">{selectedRow.description}</p>
                </div>
              )}

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-2">
                <DetailRow label="Dataset ID" value={selectedRow.dataset_id} mono />
                <DetailRow label="Author" value={selectedRow.author || "—"} />
                <DetailRow label="Date" value={selectedRow.date || "—"} />
                <DetailRow label="Environment" value={selectedRow.environment || "—"} />
                <DetailRow label="Platform" value={selectedRow.platform || "—"} />
                <DetailRow label="Log Type" value={selectedRow.log_type || "—"} />
                <DetailRow label="Category" value={selectedRow.category || "—"} />
                <DetailRow label="Directory" value={selectedRow.directory || "—"} />
              </div>

              {/* Splunk routing */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Splunk Routing</p>
                <div className="rounded-lg bg-background border border-border p-2 space-y-1 text-[10px] font-mono">
                  <div><span className="text-muted-foreground">index:</span> <span className="text-accent">{selectedRow.index}</span></div>
                  <div><span className="text-muted-foreground">source:</span> <span className="text-accent">{selectedRow.source}</span></div>
                  <div><span className="text-muted-foreground">sourcetype:</span> <span className="text-accent">{selectedRow.sourcetype}</span></div>
                </div>
              </div>

              {/* MITRE */}
              {selectedRow.mitre_attack_ids.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">MITRE ATT&CK</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedRow.mitre_attack_ids.map((id) => (
                      <a key={id} href={`https://attack.mitre.org/techniques/${id.replace(".", "/")}`} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                        {id} <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Files */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Files</p>
                <div className="space-y-1 text-[10px]">
                  <div className="flex items-start gap-1.5">
                    <FileText className="h-3 w-3 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground">Metadata</p>
                      <p className="font-mono text-foreground break-all">{selectedRow.metadata_file_path}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Database className="h-3 w-3 text-muted-foreground mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground">Data file ({selectedRow.data_file_exists ? fmtBytes(selectedRow.data_file_size_bytes) : "missing"})</p>
                      <p className="font-mono text-foreground break-all">{selectedRow.data_file_path}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Replay readiness */}
              <div className={cn("rounded-lg border p-2", selectedRow.replay_supported && hecReady ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
                <p className="text-[10px] font-medium flex items-center gap-1">
                  {selectedRow.replay_supported && hecReady ? (
                    <><CheckCircle2 className="h-3 w-3 text-success" /> <span className="text-success">Ready to replay</span></>
                  ) : (
                    <><AlertTriangle className="h-3 w-3 text-warning" /> <span className="text-warning">Not ready</span></>
                  )}
                </p>
                {!selectedRow.data_file_exists && <p className="text-[9px] text-muted-foreground mt-0.5">Data file missing</p>}
                {!hecReady && <p className="text-[9px] text-muted-foreground mt-0.5">Configure SPLUNK_HOST and SPLUNK_HEC_TOKEN environment variables</p>}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => handleSaveForLater(selectedRow)} disabled={actionLoading !== null}
                  className="flex items-center justify-center gap-1 rounded-lg bg-accent/10 border border-accent/30 px-2 py-2 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-30">
                  <Bookmark className="h-3 w-3" /> Save
                </button>
                <button onClick={() => handleReplayNow(selectedRow)} disabled={actionLoading !== null || !selectedRow.replay_now_available || !hecReady}
                  className="flex items-center justify-center gap-1 rounded-lg bg-success/10 border border-success/30 px-2 py-2 text-[10px] font-medium text-success hover:bg-success/20 disabled:opacity-30">
                  <Zap className="h-3 w-3" /> Replay Now
                </button>
                <button onClick={() => openBuildReplay(selectedRow)} disabled={actionLoading !== null || !selectedRow.build_replay_available}
                  className="flex items-center justify-center gap-1 rounded-lg bg-warning/10 border border-warning/30 px-2 py-2 text-[10px] font-medium text-warning hover:bg-warning/20 disabled:opacity-30">
                  <Hammer className="h-3 w-3" /> Build
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Build Plan Modal ── */}
      {buildPlan.open && buildPlan.row && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setBuildPlan({ ...buildPlan, open: false })}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[520px] bg-card border border-border rounded-xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Hammer className="h-4 w-4 text-warning" /> Build Replay Plan
              </h3>
              <button onClick={() => setBuildPlan({ ...buildPlan, open: false })}><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
            <p className="text-[10px] text-muted-foreground">Create a reusable replay artifact for {buildPlan.row.dataset_name}. The plan can be edited and executed later without scanning the catalog again.</p>

            <div className="space-y-2">
              <Field label="Plan name" value={buildPlan.name} onChange={(v) => setBuildPlan({ ...buildPlan, name: v })} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="index" value={buildPlan.index} onChange={(v) => setBuildPlan({ ...buildPlan, index: v })} />
                <Field label="source" value={buildPlan.source} onChange={(v) => setBuildPlan({ ...buildPlan, source: v })} />
                <Field label="sourcetype" value={buildPlan.sourcetype} onChange={(v) => setBuildPlan({ ...buildPlan, sourcetype: v })} />
              </div>
              <Field label="Host override (optional)" value={buildPlan.hostOverride} onChange={(v) => setBuildPlan({ ...buildPlan, hostOverride: v })} placeholder="event host UUID" />
              <Field label="Notes" value={buildPlan.notes} onChange={(v) => setBuildPlan({ ...buildPlan, notes: v })} placeholder="why is this replay useful?" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setBuildPlan({ ...buildPlan, open: false })}
                className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card-hover">Cancel</button>
              <button onClick={handleBuildReplay} disabled={actionLoading !== null}
                className="rounded bg-warning/10 border border-warning/30 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-50">
                {actionLoading?.startsWith("build") ? "Building..." : "Create plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[9px] text-muted-foreground">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9px] text-muted-foreground uppercase">{label}</p>
      <p className={cn("text-[11px] text-foreground", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1.5 text-[10px] font-mono text-foreground placeholder:text-muted" />
    </label>
  );
}
