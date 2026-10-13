"use client";

/**
 * LotlCampaignPicker — add Living-off-the-Land techniques to a Campaign Designer
 * selection. Pick a library, search/filter, then add checked rows or every
 * matching row. Reports chosen entries up via onAdd; the designer routes them on
 * launch (fleet → bundle path, SSH labs → enterprise runner).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Loader2, Plus, Terminal, CheckSquare, Square, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LotlSelEntry {
  id: string; library: string; name: string; techniqueId: string; executor: string; platforms: string[];
}

interface LibMeta { sourceId: string; displayName: string; platform: string; installed: boolean; count: number; }

export default function LotlCampaignPicker({ selectedIds, onAdd }: { selectedIds: Set<string>; onAdd: (entries: LotlSelEntry[]) => void }) {
  const [libs, setLibs] = useState<LibMeta[]>([]);
  const [library, setLibrary] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);

  useEffect(() => {
    fetch("/api/lotl/libraries").then((r) => r.json()).then((d) => {
      const installed = (d.libraries || []).filter((l: LibMeta) => l.installed);
      setLibs(installed);
      if (installed[0]) setLibrary(installed[0].sourceId);
    }).catch(() => {});
  }, []);

  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!library) return;
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), page_size: "25" });
    if (search) qs.set("search", search);
    const d = await fetch(`/api/lotl/${library}?${qs}`).then((r) => r.json()).catch(() => null);
    if (d) { setItems(d.items || []); setTotal(d.total || 0); setTotalPages(d.totalPages || 1); }
    setLoading(false);
  }, [library, page, search]);
  useEffect(() => { load(); }, [load]);

  const toEntry = (it: any): LotlSelEntry => ({ id: it.id, library: it.library, name: it.name, techniqueId: it.techniqueId || "", executor: it.executor, platforms: it.platforms || [] });

  const addChecked = () => {
    const entries = items.filter((it) => checked.has(it.id)).map(toEntry);
    if (entries.length) onAdd(entries);
    setChecked(new Set());
  };

  // Add every row matching the current library+search by paging through the list.
  const addAllMatching = async () => {
    setAddingAll(true);
    try {
      const all: LotlSelEntry[] = [];
      let p = 1; let pages = 1;
      do {
        const qs = new URLSearchParams({ page: String(p), page_size: "200" });
        if (search) qs.set("search", search);
        const d = await fetch(`/api/lotl/${library}?${qs}`).then((r) => r.json()).catch(() => null);
        if (!d) break;
        pages = d.totalPages || 1;
        for (const it of d.items || []) all.push(toEntry(it));
        p++;
      } while (p <= pages && p <= 40);
      if (all.length) onAdd(all);
    } finally { setAddingAll(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Terminal className="h-4 w-4 text-accent" />
        <span className="text-xs font-semibold text-foreground">Living-off-the-Land techniques</span>
        <select value={library} onChange={(e) => { setLibrary(e.target.value); setPage(1); setChecked(new Set()); }} className="h-7 px-2 text-[11px] rounded border border-border bg-input text-foreground">
          {libs.map((l) => <option key={l.sourceId} value={l.sourceId}>{l.displayName} ({l.count})</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search techniques…" className="w-full h-7 pl-7 pr-2 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </div>
      </div>

      <div className="rounded border border-border divide-y divide-border/50 max-h-56 overflow-y-auto">
        {loading ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground">No techniques match.</div>
        ) : items.map((it) => {
          const already = selectedIds.has(it.id);
          return (
            <button key={it.id} disabled={already} onClick={() => setChecked((prev) => { const n = new Set(prev); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })}
              className={cn("w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]", already ? "opacity-40" : "hover:bg-card-hover")}>
              {checked.has(it.id) ? <CheckSquare className="h-3.5 w-3.5 text-accent shrink-0" /> : <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="flex-1 truncate text-foreground">{it.name}</span>
              <span className="font-mono text-accent shrink-0">{it.techniqueId || "—"}</span>
              <span className="text-muted-foreground shrink-0">{it.executor}</span>
              {already && <span className="text-[9px] text-success shrink-0">added</span>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-muted-foreground">Page {page}/{totalPages} · {total.toLocaleString()} matching</span>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-0.5 rounded border border-border disabled:opacity-40">Prev</button>
        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-0.5 rounded border border-border disabled:opacity-40">Next</button>
        <div className="flex-1" />
        <button onClick={addChecked} disabled={checked.size === 0} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Plus className="h-3 w-3" /> Add {checked.size || ""} checked
        </button>
        <button onClick={addAllMatching} disabled={addingAll || total === 0} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
          {addingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />} Add all {total.toLocaleString()}
        </button>
      </div>
    </div>
  );
}
