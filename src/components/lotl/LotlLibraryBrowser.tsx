"use client";

/**
 * LotlLibraryBrowser — browse one Living-off-the-Land library (LOLBAS,
 * GTFOBins, …) with the same UX as the Atomic Test Library: stat cards,
 * debounced search, filter bar, sortable paginated table, and a detail panel.
 *
 * Phase 4 is browse + inspect. Analyst selection → saved groups → simulate is
 * added in Phase 5 (it reuses the row checkboxes scaffolded here).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Loader2, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown, Shield,
  Terminal, AlertTriangle, CheckCircle2, X, CheckSquare, Square, Plus, Server, Trash2, Layers, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LotlItem {
  id: string;
  library: string;
  sourceRef: string;
  name: string;
  description: string;
  command: string;
  executor: string;
  cleanupCommand: string;
  techniqueId: string;
  tactic: string;
  binaryPath: string;
  elevationRequired: boolean;
  riskLevel: string;
  platforms: string[];
  metadata: Record<string, unknown>;
  sourceUrl: string;
}

interface Stats {
  totalTests: number;
  totalTechniques: number;
  executors: { name: string; count: number }[];
  risks: { name: string; count: number }[];
  platforms: string[];
  lastSyncAt: string | null;
  syncStatus: string;
}

const RISK_STYLE: Record<string, string> = {
  high: "border-danger/30 bg-danger/10 text-danger",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-success/30 bg-success/10 text-success",
};

export default function LotlLibraryBrowser({ library, backHref }: { library: string; backHref: string }) {
  const [items, setItems] = useState<LotlItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [displayName, setDisplayName] = useState(library);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [executor, setExecutor] = useState("");
  const [risk, setRisk] = useState("");
  const [platform, setPlatform] = useState("");
  const [elevation, setElevation] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<LotlItem | null>(null);

  // Phase 5 — selection → group → simulate. Tracks ids (not just the visible
  // page) so an analyst can select an entire library across all pages.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");

  // Debounce search input.
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [searchInput]);

  // Shared filter params so the table and "select all matching" agree.
  const filterParams = useCallback(() => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (executor) qs.set("executor", executor);
    if (risk) qs.set("risk", risk);
    if (platform) qs.set("platform", platform);
    if (elevation) qs.set("elevation", elevation);
    return qs;
  }, [search, executor, risk, platform, elevation]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = filterParams();
    qs.set("page", String(page)); qs.set("page_size", "50"); qs.set("sort_by", sortBy); qs.set("sort_dir", sortDir);
    const d = await fetch(`/api/lotl/${library}?${qs}`).then((r) => r.json()).catch(() => null);
    if (d) {
      setItems(d.items || []);
      setTotal(d.total || 0);
      setTotalPages(d.totalPages || 1);
      setDisplayName(d.displayName || library);
      if (d.stats) setStats(d.stats);
    }
    setLoading(false);
  }, [library, page, sortBy, sortDir, filterParams]);

  useEffect(() => { load(); }, [load]);

  // Select every row matching the current filters (across all pages).
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const qs = filterParams();
      qs.set("ids_only", "1");
      const d = await fetch(`/api/lotl/${library}?${qs}`).then((r) => r.json()).catch(() => null);
      if (d?.ids) setPicked((prev) => { const next = new Set(prev); for (const id of d.ids) next.add(id); return next; });
    } finally { setSelectingAll(false); }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await fetch(`/api/lotl/${library}/sync`, { method: "POST", headers: { "Content-Type": "application/json" } });
      setPage(1);
      await load();
    } finally { setSyncing(false); }
  };

  const loadGroups = useCallback(async () => {
    const d = await fetch(`/api/lotl/groups?library=${library}`).then((r) => r.json()).catch(() => ({ groups: [] }));
    setGroups(d.groups || []);
  }, [library]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearPicked = () => setPicked(new Set());

  const saveGroup = async () => {
    if (!groupName.trim() || picked.size === 0) return;
    setSavingGroup(true);
    try {
      const r = await fetch("/api/lotl/groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName.trim(), library, entries: [...picked] }),
      });
      if (r.ok) { setGroupName(""); clearPicked(); await loadGroups(); }
    } finally { setSavingGroup(false); }
  };

  const deleteGroup = async (id: string) => {
    await fetch(`/api/lotl/groups/${id}`, { method: "DELETE" });
    await loadGroups();
  };

  // All simulation runs from the Campaign Designer. Hand the selection off via
  // sessionStorage and navigate there; the designer ingests it into Step 2.
  const openInDesigner = (ids: string[], lib: string) => {
    if (!ids.length) return;
    try { sessionStorage.setItem("lotl.campaignHandoff", JSON.stringify({ ids, library: lib })); } catch { /* ignore */ }
    window.location.href = "/campaign-designer";
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("asc"); }
    setPage(1);
  };

  const empty = !loading && items.length === 0;
  const needsSync = stats?.syncStatus === "never" || (stats?.totalTests === 0);

  const filterChips = useMemo(() => ({
    executors: stats?.executors || [],
    risks: stats?.risks || [],
    platforms: stats?.platforms || [],
  }), [stats]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <a href={backHref} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Libraries</a>
          <span className="text-muted-foreground">/</span>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Terminal className="h-4 w-4 text-accent" /> {displayName}</h2>
        </div>
        <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label="Techniques" value={stats.totalTests} />
          <StatCard label="MITRE IDs" value={stats.totalTechniques} />
          <StatCard label="Executors" value={stats.executors.length} />
          <StatCard label="Last sync" value={stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleDateString() : "never"} small />
        </div>
      )}

      {needsSync && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> This library has not been ingested yet. Click Sync to pull it from the upstream repo.
        </div>
      )}

      {/* Saved groups. All execution happens in the Campaign Designer — select
          techniques or a group here and open them there to pick a server and run. */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-3">
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] text-muted-foreground inline-flex items-center gap-2">
          <Server className="h-3.5 w-3.5 text-accent" /> Simulation runs from the Campaign Designer. Select techniques or a saved group, then open them in the designer to choose a server and launch.
        </div>
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Layers className="h-3.5 w-3.5 text-accent" />
            <span className="text-[11px] font-semibold text-foreground">Saved groups</span>
            <span className="text-[10px] text-muted-foreground">({groups.length})</span>
          </div>
          {groups.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No groups yet. Select techniques below and save a group to reuse.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <div key={g.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 pl-2.5 pr-1.5 py-1 text-[11px]">
                  <span className="text-foreground font-medium">{g.name}</span>
                  <span className="text-muted-foreground">· {g.count}</span>
                  <button onClick={() => openInDesigner(g.entries || [], g.library)} title="Open in Campaign Designer" className="ml-1 p-0.5 rounded hover:text-accent"><ArrowRight className="h-3 w-3" /></button>
                  <button onClick={() => deleteGroup(g.id)} title="Delete group" className="p-0.5 rounded hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name, command, technique…" className="w-full h-9 pl-8 pr-2 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </div>
        <FilterSelect value={executor} onChange={(v) => { setExecutor(v); setPage(1); }} placeholder="Executor" options={filterChips.executors.map((e) => ({ value: e.name, label: `${e.name} (${e.count})` }))} />
        <FilterSelect value={risk} onChange={(v) => { setRisk(v); setPage(1); }} placeholder="Risk" options={filterChips.risks.map((r) => ({ value: r.name, label: `${r.name} (${r.count})` }))} />
        <FilterSelect value={platform} onChange={(v) => { setPlatform(v); setPage(1); }} placeholder="Platform" options={filterChips.platforms.map((p) => ({ value: p, label: p }))} />
        <FilterSelect value={elevation} onChange={(v) => { setElevation(v); setPage(1); }} placeholder="Elevation" options={[{ value: "true", label: "required" }, { value: "false", label: "not required" }]} />
      </div>

      {/* Selection toolbar */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <button onClick={selectAllMatching} disabled={selectingAll || total === 0} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50">
          {selectingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />} Select all {total.toLocaleString()} matching
        </button>
        {picked.size > 0 && (
          <>
            <span className="text-muted-foreground">{picked.size.toLocaleString()} selected</span>
            <button onClick={clearPicked} className="text-muted-foreground hover:text-foreground underline">clear</button>
          </>
        )}
        <span className="ml-auto text-muted-foreground">select techniques, then save a group or simulate below</span>
      </div>

      {/* Table + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="w-8 px-2 py-2">
                  <button onClick={() => { const all = items.every((it) => picked.has(it.id)); setPicked((prev) => { const next = new Set(prev); if (all) items.forEach((it) => next.delete(it.id)); else items.forEach((it) => next.add(it.id)); return next; }); }} title="Select page">
                    {items.length > 0 && items.every((it) => picked.has(it.id)) ? <CheckSquare className="h-3.5 w-3.5 text-accent" /> : <Square className="h-3.5 w-3.5" />}
                  </button>
                </th>
                <SortHeader label="Name" col="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Technique" col="techniqueId" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Executor" col="executor" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Risk" col="riskLevel" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-10 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline" /> Loading…</td></tr>
              ) : empty ? (
                <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No techniques match.</td></tr>
              ) : items.map((it) => (
                <tr key={it.id} onClick={() => setSelected(it)} className={cn("border-b border-border/50 cursor-pointer hover:bg-card-hover", selected?.id === it.id && "bg-accent/10")}>
                  <td className="w-8 px-2 py-2" onClick={(e) => { e.stopPropagation(); togglePick(it.id); }}>
                    {picked.has(it.id) ? <CheckSquare className="h-3.5 w-3.5 text-accent" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <div className="font-medium line-clamp-1">{it.name}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1">{it.description}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-accent">{it.techniqueId || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{it.executor}{it.elevationRequired && <Shield className="inline h-3 w-3 ml-1 text-warning" />}</td>
                  <td className="px-3 py-2"><span className={cn("px-1.5 py-0.5 rounded border text-[10px]", RISK_STYLE[it.riskLevel] || "border-border text-muted-foreground")}>{it.riskLevel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>{total.toLocaleString()} techniques</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 rounded hover:bg-card-hover disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span>Page {page} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 rounded hover:bg-card-hover disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="rounded-xl border border-border bg-card p-4 h-fit sticky top-4">
          {!selected ? (
            <div className="text-xs text-muted-foreground py-8 text-center">Select a technique to inspect its command.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">{selected.name}</div>
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-[11px] text-muted-foreground">{selected.description}</p>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {selected.techniqueId && <span className="px-1.5 py-0.5 rounded border border-border font-mono text-accent">{selected.techniqueId}</span>}
                <span className="px-1.5 py-0.5 rounded border border-border">{selected.executor}</span>
                <span className={cn("px-1.5 py-0.5 rounded border", RISK_STYLE[selected.riskLevel] || "border-border")}>{selected.riskLevel}</span>
                {selected.platforms.map((p) => <span key={p} className="px-1.5 py-0.5 rounded border border-border text-muted-foreground">{p}</span>)}
                {selected.elevationRequired && <span className="px-1.5 py-0.5 rounded border border-warning/30 text-warning inline-flex items-center gap-1"><Shield className="h-3 w-3" /> elevation</span>}
              </div>
              <CommandBlock label="Command" value={selected.command} />
              {selected.cleanupCommand && <CommandBlock label="Cleanup" value={selected.cleanupCommand} />}
              {selected.binaryPath && <div className="text-[11px]"><span className="text-muted-foreground">Binary:</span> <span className="font-mono text-foreground">{selected.binaryPath}</span></div>}
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> upstream source</a>}
            </div>
          )}
        </div>
      </div>

      {/* Selection tray */}
      {picked.size > 0 && (
        <div className="sticky bottom-3 z-10 rounded-xl border border-accent/40 bg-card shadow-lg p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{picked.size} selected</span>
          <button onClick={clearPicked} className="text-[11px] text-muted-foreground hover:text-foreground">clear</button>
          <div className="flex-1" />
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="New group name…" className="h-8 w-44 px-2 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
          <button onClick={saveGroup} disabled={savingGroup || !groupName.trim()} className="inline-flex items-center gap-1 h-8 px-3 text-[11px] font-medium rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
            {savingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Save group
          </button>
          <button onClick={() => openInDesigner([...picked], library)} className="inline-flex items-center gap-1 h-8 px-3 text-[11px] font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
            <ArrowRight className="h-3.5 w-3.5" /> Open in Campaign Designer
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-bold text-foreground", small ? "text-sm mt-1" : "text-xl")}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn("h-9 px-2 text-xs rounded-md border bg-input text-foreground focus:outline-none focus:border-accent", value ? "border-accent/50" : "border-border")}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SortHeader({ label, col, sortBy, sortDir, onSort }: { label: string; col: string; sortBy: string; sortDir: string; onSort: (c: string) => void }) {
  return (
    <th className="px-3 py-2 text-left font-semibold">
      <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label} <ArrowUpDown className={cn("h-3 w-3", sortBy === col ? "text-accent" : "opacity-40")} />
        {sortBy === col && <span className="text-accent text-[9px]">{sortDir}</span>}
      </button>
    </th>
  );
}

function CommandBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <pre className="text-[10px] font-mono text-foreground bg-background/60 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-56">{value}</pre>
    </div>
  );
}
