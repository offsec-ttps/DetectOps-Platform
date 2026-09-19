"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Atom, Search, Play, ExternalLink, Shield, Tag, Monitor,
  Terminal, Filter, ChevronRight, ChevronLeft, BookOpen, Clock,
  CheckCircle2, Copy, Check, RefreshCw, Download, AlertTriangle,
  ArrowUpDown, ChevronDown, ChevronUp, X, ShieldAlert, Loader2,
  ArrowUp, ArrowDown, Database, Layers, Cpu, Zap, Bell, Info,
} from "lucide-react";

// ── Types ──

interface AtomicTest {
  id: string;
  techniqueId: string;
  techniqueName: string;
  testNumber: number;
  testGuid: string;
  testName: string;
  testDescription: string;
  platforms: string[];
  elevationRequired: boolean;
  executorName: string;
  command: string;
  cleanupCommand: string;
  inputArguments: Record<string, unknown>;
  dependencies: unknown[];
  tactic: string;
  sourceUrl: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  totalTests: number;
  totalTechniques: number;
  tactics: { name: string; count: number }[];
  platforms: string[];
  executors: { name: string; count: number }[];
  lastSyncAt: string | null;
  lastSyncCommit: string | null;
}

interface UpdateInfo {
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  lastSyncAt: string | null;
  lastSyncTests: number;
}

interface SyncResult {
  status: string;
  newCount: number;
  updatedCount: number;
  removedCount: number;
  totalTechniques: number;
  totalTests: number;
  commitSha: string;
  errors: string[];
}

// ── Constants ──

const ALL_TACTICS = [
  "Reconnaissance", "Resource Development", "Initial Access", "Execution",
  "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access",
  "Discovery", "Lateral Movement", "Collection", "Command and Control",
  "Exfiltration", "Impact",
];

const PLATFORM_ICONS: Record<string, string> = {
  windows: "W", linux: "L", macos: "M", "azure-ad": "Az",
  "office-365": "O365", "google-workspace": "GW", containers: "C",
  iaas: "I", saas: "S",
};

// ── Component ──

export default function AtomicTestLibraryPage() {
  // Data state
  const [tests, setTests] = useState<AtomicTest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [tactic, setTactic] = useState("");
  const [platform, setPlatform] = useState("");
  const [executor, setExecutor] = useState("");
  const [elevation, setElevation] = useState<string>("");
  const [sortBy, setSortBy] = useState("techniqueId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // UI state
  const [selectedTest, setSelectedTest] = useState<AtomicTest | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<"cmd" | "cleanup" | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  // Update check state
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [showSyncResult, setShowSyncResult] = useState(false);

  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const [searchInput, setSearchInput] = useState("");

  // Debounced search
  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  };

  // ── Fetch Tests ──
  const fetchTests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (search) params.set("search", search);
      if (tactic) params.set("tactic", tactic);
      if (platform) params.set("platform", platform);
      if (executor) params.set("executor", executor);
      if (elevation) params.set("elevation", elevation);
      params.set("sort_by", sortBy);
      params.set("sort_dir", sortDir);

      const res = await fetch(`/api/atomic-tests?${params}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      setTests(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tests");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, tactic, platform, executor, elevation, sortBy, sortDir]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  // ── Check Updates ──
  const checkUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await fetch("/api/atomic-tests/updates");
      if (res.ok) setUpdateInfo(await res.json());
    } catch { /* ignore */ }
    finally { setCheckingUpdates(false); }
  };

  useEffect(() => {
    if (stats?.lastSyncAt) checkUpdates();
  }, [stats?.lastSyncAt]);

  // ── Sync ──
  const triggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setShowSyncResult(false);
    try {
      const res = await fetch("/api/atomic-tests/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(data);
        setShowSyncResult(true);
        setUpdateInfo(null);
        setPage(1);
        fetchTests();
      } else {
        setError(data.error || "Sync failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync request failed");
    } finally {
      setSyncing(false);
    }
  };

  // ── Copy Command ──
  const handleCopy = (text: string, type: "cmd" | "cleanup") => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(type);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  // ── Sort Toggle ──
  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
    setPage(1);
  };

  // ── Clear Filters ──
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setTactic("");
    setPlatform("");
    setExecutor("");
    setElevation("");
    setSortBy("techniqueId");
    setSortDir("asc");
    setPage(1);
  };

  const hasFilters = search || tactic || platform || executor || elevation;
  const neverSynced = !stats?.lastSyncAt && !loading && tests.length === 0;

  // ── Render ──
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Atomic Test Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete catalog of Atomic Red Team tests synced from GitHub — searchable by technique, tactic, platform, and more
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stats?.lastSyncAt && (
            <button
              onClick={checkUpdates}
              disabled={checkingUpdates}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
            >
              {checkingUpdates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
              Check Updates
            </button>
          )}
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {syncing ? "Syncing…" : neverSynced ? "Import from GitHub" : "Sync from GitHub"}
          </button>
        </div>
      </div>

      {/* Update Available Banner */}
      {updateInfo?.updateAvailable && !syncing && (
        <div className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Updates Available</p>
              <p className="text-xs text-muted-foreground">
                New atomic tests or updates detected upstream since last sync
                {updateInfo.lastSyncAt && (
                  <> ({new Date(updateInfo.lastSyncAt).toLocaleDateString()})</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={triggerSync}
            className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync Now
          </button>
        </div>
      )}

      {/* Sync Result Banner */}
      {showSyncResult && syncResult && (
        <div className="flex items-center justify-between rounded-xl border border-success/30 bg-success/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Sync Complete</p>
              <p className="text-xs text-muted-foreground">
                {syncResult.totalTests} tests across {syncResult.totalTechniques} techniques
                {syncResult.newCount > 0 && <> — <span className="text-success font-medium">+{syncResult.newCount} new</span></>}
                {syncResult.updatedCount > 0 && <>, <span className="text-accent font-medium">{syncResult.updatedCount} updated</span></>}
                {syncResult.removedCount > 0 && <>, <span className="text-danger font-medium">{syncResult.removedCount} removed</span></>}
              </p>
            </div>
          </div>
          <button onClick={() => setShowSyncResult(false)} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Syncing Progress */}
      {syncing && (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <div>
            <p className="text-sm font-medium text-foreground">Syncing Atomic Red Team Library…</p>
            <p className="text-xs text-muted-foreground">
              Fetching all technique YAMLs from GitHub — this may take a minute on first sync
            </p>
          </div>
        </div>
      )}

      {/* Never Synced Empty State */}
      {neverSynced && !syncing && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 mb-4">
            <Atom className="h-8 w-8 text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No Atomic Tests Imported Yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Import the complete Atomic Red Team test library from GitHub.
            This will fetch all technique YAMLs and make them searchable and filterable.
          </p>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            <Download className="h-4 w-4" /> Import from GitHub
          </button>
          <p className="mt-3 text-xs text-muted">
            Source: github.com/redcanaryco/atomic-red-team
          </p>
        </div>
      )}

      {/* Main content (only when tests exist or loading) */}
      {(!neverSynced || loading) && (
        <>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard icon={<Database className="h-4 w-4" />} label="Total Tests" value={String(stats.totalTests)} color="text-foreground" />
              <StatCard icon={<Layers className="h-4 w-4" />} label="Techniques" value={String(stats.totalTechniques)} color="text-accent" />
              <StatCard icon={<Shield className="h-4 w-4" />} label="Tactics" value={String(stats.tactics.length)} color="text-warning" />
              <StatCard icon={<Cpu className="h-4 w-4" />} label="Platforms" value={String(stats.platforms.length)} color="text-success" />
              <StatCard
                icon={<Clock className="h-4 w-4" />}
                label="Last Synced"
                value={stats.lastSyncAt ? timeAgo(stats.lastSyncAt) : "Never"}
                color="text-muted-foreground"
              />
            </div>
          )}

          {/* Search + Filter Bar */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[280px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search by test name, technique ID, description…"
                  value={searchInput}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "flex items-center gap-1.5 h-9 rounded-lg border px-3 text-xs font-medium transition-colors",
                  showFilters ? "border-accent/40 bg-accent/5 text-accent" : "border-border text-muted-foreground hover:bg-card-hover"
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {hasFilters && <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] text-white">{[tactic, platform, executor, elevation].filter(Boolean).length}</span>}
              </button>
              {hasFilters && (
                <button onClick={clearFilters} className="flex items-center gap-1 h-9 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-card-hover transition-colors">
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>

            {/* Expanded Filters */}
            {showFilters && (
              <div className="flex items-end gap-3 flex-wrap rounded-xl border border-border bg-card p-3">
                <FilterSelect
                  label="Tactic"
                  value={tactic}
                  onChange={(v) => { setTactic(v); setPage(1); }}
                  options={stats?.tactics.map((t) => ({ value: t.name, label: `${t.name} (${t.count})` })) || ALL_TACTICS.map((t) => ({ value: t, label: t }))}
                  placeholder="All Tactics"
                />
                <FilterSelect
                  label="Platform"
                  value={platform}
                  onChange={(v) => { setPlatform(v); setPage(1); }}
                  options={(stats?.platforms || []).map((p) => ({ value: p, label: capitalize(p) }))}
                  placeholder="All Platforms"
                />
                <FilterSelect
                  label="Executor"
                  value={executor}
                  onChange={(v) => { setExecutor(v); setPage(1); }}
                  options={stats?.executors.map((e) => ({ value: e.name, label: `${e.name} (${e.count})` })) || []}
                  placeholder="All Executors"
                />
                <FilterSelect
                  label="Elevation Required"
                  value={elevation}
                  onChange={(v) => { setElevation(v); setPage(1); }}
                  options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
                  placeholder="Any"
                />
                <FilterSelect
                  label="Sort By"
                  value={sortBy}
                  onChange={(v) => { setSortBy(v); setPage(1); }}
                  options={[
                    { value: "techniqueId", label: "Technique ID" },
                    { value: "testName", label: "Test Name" },
                    { value: "tactic", label: "Tactic" },
                    { value: "techniqueName", label: "Technique Name" },
                    { value: "executorName", label: "Executor" },
                    { value: "updatedAt", label: "Last Updated" },
                  ]}
                  placeholder="Sort By"
                  noAll
                />
                <button
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  className="flex items-center gap-1 h-8 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-card-hover transition-colors"
                >
                  {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {sortDir === "asc" ? "Asc" : "Desc"}
                </button>
                <FilterSelect
                  label="Per Page"
                  value={String(pageSize)}
                  onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                  options={[{ value: "25", label: "25" }, { value: "50", label: "50" }, { value: "100", label: "100" }, { value: "200", label: "200" }]}
                  placeholder="50"
                  noAll
                />
              </div>
            )}
          </div>

          {/* Result Count + Pagination Info */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {loading ? "Loading…" : `${total.toLocaleString()} tests found`}
              {hasFilters && !loading && ` (filtered)`}
            </p>
            {totalPages > 1 && (
              <p className="text-xs text-muted">
                Page {page} of {totalPages}
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {/* Main Layout */}
          <div className="grid grid-cols-12 gap-4">
            {/* Test List */}
            <div className={cn("space-y-1.5", selectedTest ? "col-span-7" : "col-span-12")}>
              {/* Table Header */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-semibold uppercase text-muted tracking-wide">
                <SortHeader label="Technique" field="techniqueId" span={2} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Test Name" field="testName" span={selectedTest ? 4 : 3} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Tactic" field="tactic" span={2} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <div className={cn(selectedTest ? "col-span-2" : "col-span-2")}>Platforms</div>
                <div className="col-span-1">Executor</div>
                {!selectedTest && <div className="col-span-1">Elevation</div>}
                <div className="col-span-1">Updated</div>
              </div>

              {loading && tests.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-accent" />
                </div>
              ) : (
                tests.map((test) => (
                  <button
                    key={test.id}
                    onClick={() => setSelectedTest(test)}
                    className={cn(
                      "w-full text-left rounded-lg border bg-card px-4 py-2.5 hover:bg-card-hover transition-all group",
                      selectedTest?.id === test.id ? "border-accent/40 bg-card-hover" : "border-border"
                    )}
                  >
                    {/* Mobile layout */}
                    <div className="md:hidden space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{test.techniqueId}</span>
                        <span className="text-xs font-medium text-foreground truncate">{test.testName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <span>{test.tactic}</span>
                        <span>·</span>
                        {test.platforms.map((p) => <span key={p} className="rounded bg-muted/10 px-1 py-0.5">{capitalize(p)}</span>)}
                        <span>·</span>
                        <span>{test.executorName}</span>
                      </div>
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden md:grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-2">
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{test.techniqueId}</span>
                        <span className="ml-1.5 text-[10px] text-muted">#{test.testNumber}</span>
                      </div>
                      <div className={cn("truncate", selectedTest ? "col-span-4" : "col-span-3")}>
                        <span className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">{test.testName}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-[10px] text-muted-foreground">{test.tactic || "—"}</span>
                      </div>
                      <div className={cn("flex gap-1 flex-wrap", selectedTest ? "col-span-2" : "col-span-2")}>
                        {test.platforms.map((p) => (
                          <span key={p} className="rounded bg-muted/10 px-1 py-0.5 text-[9px] font-medium text-muted-foreground">{PLATFORM_ICONS[p] || p}</span>
                        ))}
                      </div>
                      <div className="col-span-1">
                        <span className="text-[10px] text-muted-foreground">{test.executorName || "—"}</span>
                      </div>
                      {!selectedTest && (
                        <div className="col-span-1">
                          {test.elevationRequired ? (
                            <span className="flex items-center gap-0.5 text-[10px] font-medium text-warning"><ShieldAlert className="h-2.5 w-2.5" /> Yes</span>
                          ) : (
                            <span className="text-[10px] text-muted">No</span>
                          )}
                        </div>
                      )}
                      <div className="col-span-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted">{shortDate(test.updatedAt)}</span>
                        <ChevronRight className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </button>
                ))
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3 w-3" /> Previous
                  </button>
                  {paginationRange(page, totalPages).map((p, i) =>
                    p === "..." ? (
                      <span key={`dots-${i}`} className="text-xs text-muted px-1">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={cn(
                          "h-7 w-7 rounded-lg text-xs font-medium transition-colors",
                          page === p ? "bg-accent text-white" : "text-muted-foreground hover:bg-card-hover"
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-30"
                  >
                    Next <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Detail Panel */}
            {selectedTest && (
              <div className="col-span-5">
                <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">{selectedTest.techniqueId}</span>
                        <span className="text-[10px] text-muted">Test #{selectedTest.testNumber}</span>
                        {selectedTest.testGuid && (
                          <span className="text-[10px] text-muted font-mono">{selectedTest.testGuid.slice(0, 8)}</span>
                        )}
                      </div>
                      <h2 className="text-base font-semibold text-foreground mt-2">{selectedTest.testName}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedTest.techniqueName}</p>
                    </div>
                    <button onClick={() => setSelectedTest(null)} className="text-muted hover:text-foreground transition-colors p-1">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Description */}
                  {selectedTest.testDescription && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{selectedTest.testDescription}</p>
                  )}

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <MetaField label="Tactic" value={selectedTest.tactic || "—"} />
                    <MetaField label="Executor" value={selectedTest.executorName || "—"} />
                    <MetaField label="Platforms" value={selectedTest.platforms.map(capitalize).join(", ")} />
                    <MetaField
                      label="Elevation Required"
                      value={selectedTest.elevationRequired ? "Yes" : "No"}
                      highlight={selectedTest.elevationRequired}
                    />
                  </div>

                  {/* Command */}
                  {selectedTest.command && (
                    <CommandBlock
                      title="Command"
                      code={selectedTest.command}
                      copied={copiedCmd === "cmd"}
                      onCopy={() => handleCopy(selectedTest.command, "cmd")}
                    />
                  )}

                  {/* Cleanup Command */}
                  {selectedTest.cleanupCommand && (
                    <CommandBlock
                      title="Cleanup Command"
                      code={selectedTest.cleanupCommand}
                      copied={copiedCmd === "cleanup"}
                      onCopy={() => handleCopy(selectedTest.cleanupCommand, "cleanup")}
                    />
                  )}

                  {/* Input Arguments */}
                  {Object.keys(selectedTest.inputArguments).length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted uppercase mb-2">Input Arguments</p>
                      <div className="space-y-1.5">
                        {Object.entries(selectedTest.inputArguments).map(([key, val]) => {
                          const arg = val as { description?: string; type?: string; default?: string };
                          return (
                            <div key={key} className="rounded-lg border border-border bg-background px-3 py-2">
                              <div className="flex items-center gap-2">
                                <code className="text-[11px] font-mono font-bold text-accent">{key}</code>
                                {arg.type && <span className="text-[9px] text-muted rounded bg-muted/10 px-1 py-0.5">{arg.type}</span>}
                              </div>
                              {arg.description && <p className="text-[10px] text-muted-foreground mt-0.5">{arg.description}</p>}
                              {arg.default !== undefined && (
                                <p className="text-[10px] text-muted mt-0.5">Default: <code className="font-mono text-foreground">{String(arg.default)}</code></p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Dependencies */}
                  {selectedTest.dependencies.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted uppercase mb-2">Dependencies ({selectedTest.dependencies.length})</p>
                      <div className="space-y-1">
                        {selectedTest.dependencies.map((dep, i) => {
                          const d = dep as { description?: string };
                          return (
                            <div key={i} className="rounded-lg border border-border bg-background px-3 py-1.5">
                              <p className="text-[10px] text-muted-foreground">{d.description || `Dependency ${i + 1}`}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <button className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
                      <Play className="h-3.5 w-3.5" /> Execute Test
                    </button>
                    <a
                      href={selectedTest.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" /> Source
                    </a>
                    <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                      <Shield className="h-3 w-3" /> Map Rule
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-muted">{icon}</span>
        <p className="text-[10px] font-semibold text-muted uppercase">{label}</p>
      </div>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options, placeholder, noAll,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  noAll?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted uppercase">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-input-focus focus:outline-none min-w-[130px]"
      >
        {!noAll && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SortHeader({
  label, field, span, sortBy, sortDir, onSort,
}: {
  label: string;
  field: string;
  span: number;
  sortBy: string;
  sortDir: string;
  onSort: (f: string) => void;
}) {
  const active = sortBy === field;
  return (
    <button
      onClick={() => onSort(field)}
      className={cn(`col-span-${span} flex items-center gap-1 hover:text-foreground transition-colors`, active && "text-accent")}
    >
      {label}
      {active ? (sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}
    </button>
  );
}

function MetaField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted uppercase">{label}</p>
      <p className={cn("text-xs font-medium", highlight ? "text-warning" : "text-foreground")}>{value}</p>
    </div>
  );
}

function CommandBlock({ title, code, copied, onCopy }: { title: string; code: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card-hover">
        <span className="text-[10px] font-semibold text-muted uppercase">{title}</span>
        <button onClick={onCopy} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap overflow-auto max-h-[200px]">{code}</pre>
    </div>
  );
}

// ── Helpers ──

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "—";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function paginationRange(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [];
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push("...", total);
  } else if (current >= total - 3) {
    pages.push(1, "...");
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1, "...", current - 1, current, current + 1, "...", total);
  }
  return pages;
}
