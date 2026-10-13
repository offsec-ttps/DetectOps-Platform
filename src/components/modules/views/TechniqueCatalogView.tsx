"use client";

/**
 * Built-in module view: a curated ATT&CK technique catalogue + "Simulate".
 * Used by category modules that aren't gang-centric (LOTL, Phishing, …). Reads
 * `manifest.contributes.catalog` (technique groups) and runs a chosen group via
 * the generic /api/simulations/run bridge (techniques → atomic tests → runner).
 */

import { useEffect, useState } from "react";
import {
  Crosshair, Loader2, Play, Server, CheckCircle2, XCircle, AlertTriangle, Boxes, Library, ArrowRight, RefreshCw,
  ChevronDown, ChevronRight, Terminal, Monitor, Command, Globe, Search, ExternalLink, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import LotlLibraryBrowser from "@/components/lotl/LotlLibraryBrowser";

// Per-platform visual identity so the library grid is scannable at a glance
// (instead of ten identical blue terminal cards).
const PLATFORM_META: Record<string, { label: string; Icon: any; tone: string; chip: string }> = {
  windows: { label: "Windows", Icon: Monitor, tone: "border-accent/30 bg-accent/10 text-accent", chip: "border-accent/30 bg-accent/10 text-accent" },
  linux: { label: "Linux", Icon: Terminal, tone: "border-warning/30 bg-warning/10 text-warning", chip: "border-warning/30 bg-warning/10 text-warning" },
  macos: { label: "macOS", Icon: Command, tone: "border-muted-foreground/30 bg-muted/20 text-muted-foreground", chip: "border-muted-foreground/30 bg-muted/20 text-muted-foreground" },
  multi: { label: "Cross-platform", Icon: Globe, tone: "border-purple/30 bg-purple/10 text-purple", chip: "border-purple/30 bg-purple/10 text-purple" },
};
const platformMeta = (p: string) => PLATFORM_META[(p || "").toLowerCase()] || PLATFORM_META.multi;
// Libraries whose techniques can be genuinely destructive (gated behind a
// confirm when simulated) — surfaced with a small advisory chip.
const DANGEROUS_LIBS = new Set(["loldrivers", "lottunnels", "sysinternals"]);
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  if (!isFinite(d) || d < 0) return "";
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

interface LotlLibraryCard {
  sourceId: string;
  displayName: string;
  description: string;
  platform: string;
  repoUrl: string;
  installed: boolean;
  count: number;
  syncStatus: string;
  lastSyncAt: string | null;
}

export default function TechniqueCatalogView({ moduleId, sub }: { moduleId: string; sub: string[] }) {
  const [mod, setMod] = useState<any>(null);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [envId, setEnvId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [libraries, setLibraries] = useState<LotlLibraryCard[]>([]);
  const [syncingLib, setSyncingLib] = useState<string | null>(null);
  const [showCurated, setShowCurated] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libPlatform, setLibPlatform] = useState("");

  const loadLibraries = async () => {
    const d = await fetch("/api/lotl/libraries").then((r) => r.ok ? r.json() : { libraries: [] }).catch(() => ({ libraries: [] }));
    setLibraries(d.libraries || []);
  };

  useEffect(() => {
    (async () => {
      const [d, ev] = await Promise.all([
        fetch(`/api/modules/${moduleId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/environment-targets`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]);
      setMod(d); setEnvs(ev?.items || ev?.environments || []); setLoading(false);
      loadLibraries();
    })();
  }, [moduleId]);

  const syncLibrary = async (sourceId: string) => {
    setSyncingLib(sourceId);
    try {
      await fetch(`/api/lotl/${sourceId}/sync`, { method: "POST", headers: { "Content-Type": "application/json" } });
      await loadLibraries();
    } finally { setSyncingLib(null); }
  };

  // Sub-route: /modules/<id>/library/<library> renders the full library browser.
  if (sub[0] === "library" && sub[1]) {
    return <LotlLibraryBrowser library={sub[1]} backHref={`/modules/${moduleId}`} />;
  }

  const run = async (groupName: string, techniques: string[]) => {
    if (!envId) return;
    setRunning(groupName); setErrors((e) => ({ ...e, [groupName]: "" }));
    try {
      const r = await fetch("/api/simulations/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ techniques, environmentId: envId, label: `${mod?.name} · ${groupName}`, sourceRef: `module:${moduleId}`, mode: "simulate-only" }),
      });
      const d = await r.json();
      if (!r.ok) { setErrors((e) => ({ ...e, [groupName]: d.error || "run failed" })); return; }
      setResults((x) => ({ ...x, [groupName]: d }));
    } finally { setRunning(null); }
  };

  if (loading) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!mod || mod.error) return <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Module not found.</div>;

  const catalog: any[] = mod.manifest?.contributes?.catalog || [];
  const installedLibs = libraries.filter((l) => l.installed);
  const totalTechniques = installedLibs.reduce((a, l) => a + l.count, 0);
  // Platform breakdown (over installed libraries) + the filtered view.
  const platformCounts: Record<string, number> = {};
  for (const l of installedLibs) { const k = (l.platform || "multi").toLowerCase(); platformCounts[k] = (platformCounts[k] || 0) + 1; }
  const q = libSearch.trim().toLowerCase();
  const filteredLibs = libraries.filter((l) =>
    (!libPlatform || (l.platform || "multi").toLowerCase() === libPlatform) &&
    (!q || `${l.displayName} ${l.description} ${l.sourceId}`.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Boxes className="h-6 w-6" /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{mod.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mod.description}</p>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">{mod.moduleId} · {mod.category}</div>
        </div>
      </div>

      {/* LOTL reference libraries — primary navigation. Each card opens a full
          browsable catalogue where the analyst selects, groups, and simulates. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Library className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Living-off-the-Land Libraries</h2>
          <span className="text-[11px] text-muted-foreground">open one to browse, group, and simulate</span>
        </div>

        {/* Stats + platform breakdown bar */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
            <span className="text-base font-bold text-foreground leading-none">{installedLibs.length}</span>
            <span className="text-[11px] text-muted-foreground">libraries</span>
          </span>
          <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
            <span className="text-base font-bold text-foreground leading-none">{totalTechniques.toLocaleString()}</span>
            <span className="text-[11px] text-muted-foreground">techniques</span>
          </span>
          <span className="mx-0.5 text-border">·</span>
          {Object.entries(platformCounts).sort((a, b) => b[1] - a[1]).map(([p, n]) => {
            const m = platformMeta(p); const on = libPlatform === p;
            return (
              <button key={p} onClick={() => setLibPlatform(on ? "" : p)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors", on ? m.chip : "border-border bg-card text-muted-foreground hover:text-foreground")}>
                <m.Icon className="h-3.5 w-3.5" /> {m.label} <span className="font-mono opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Filter libraries…" className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-border bg-input text-foreground" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredLibs.map((lib) => {
            const m = platformMeta(lib.platform);
            const dangerous = DANGEROUS_LIBS.has(lib.sourceId.toLowerCase());
            const synced = relativeTime(lib.lastSyncAt);
            return (
              <div key={lib.sourceId} className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-accent/40 hover:shadow-[0_0_40px_rgba(59,130,246,0.08)] transition-all">
                {/* platform accent strip */}
                <span className={cn("absolute inset-x-0 top-0 h-0.5", m.chip.split(" ").find((c) => c.startsWith("bg-")) || "bg-accent/40")} aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", m.tone)}><m.Icon className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{lib.displayName}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className={cn("inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border font-medium", m.chip)}>{m.label}</span>
                        {dangerous && <span title="Contains destructive techniques — gated behind a confirm when simulated" className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-danger/30 bg-danger/10 text-danger font-medium"><ShieldAlert className="h-2.5 w-2.5" /> dangerous</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {lib.installed
                      ? <><div className="text-xl font-bold text-foreground leading-none">{lib.count.toLocaleString()}</div><div className="text-[9px] text-muted-foreground">techniques</div></>
                      : <span className="inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-muted-foreground">not synced</span>}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 flex-1">{lib.description}</p>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  {lib.repoUrl
                    ? <a href={lib.repoUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-accent truncate"><ExternalLink className="h-3 w-3 shrink-0" /> {lib.repoUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "")}</a>
                    : <span />}
                  {synced && <span className="inline-flex items-center gap-1 shrink-0"><RefreshCw className="h-2.5 w-2.5" /> {synced}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {lib.installed ? (
                    <>
                      <a href={`/modules/${moduleId}/library/${lib.sourceId}`} className="flex-1 inline-flex items-center justify-center gap-1 h-8 px-2.5 text-[11px] font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] transition-colors">
                        Browse &amp; simulate <ArrowRight className="h-3 w-3" />
                      </a>
                      <button onClick={() => syncLibrary(lib.sourceId)} disabled={syncingLib === lib.sourceId} title="Re-sync from upstream" className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-card-hover disabled:opacity-50">
                        {syncingLib === lib.sourceId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => syncLibrary(lib.sourceId)} disabled={syncingLib === lib.sourceId} className="flex-1 inline-flex items-center justify-center gap-1 h-8 px-2.5 text-[11px] font-medium rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                      {syncingLib === lib.sourceId ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sync now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {libraries.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border bg-card/30 p-4 text-xs text-muted-foreground">No LOTL libraries registered.</div>}
          {libraries.length > 0 && filteredLibs.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border bg-card/30 p-4 text-xs text-muted-foreground">No libraries match this filter.</div>}
        </div>
      </div>

      {/* Curated ATT&CK quick-run groups — secondary, collapsed by default so
          the page stays LOTL-focused. */}
      {catalog.length > 0 && (
        <div className="rounded-xl border border-border bg-card/40">
          <button onClick={() => setShowCurated((v) => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-card-hover rounded-xl">
            {showCurated ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <Crosshair className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-foreground">Curated ATT&amp;CK quick-run groups</span>
            <span className="text-[11px] text-muted-foreground">Atomic Red Team bundles · {catalog.length}</span>
          </button>
          {showCurated && (
            <div className="px-4 pb-4 pt-3 space-y-3 border-t border-border">
              <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">Target:</span>
                <select value={envId} onChange={(e) => setEnvId(e.target.value)} className="flex-1 min-w-[220px] h-8 px-2 text-xs rounded border border-border bg-input text-foreground">
                  <option value="">Select environment…</option>
                  {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {catalog.map((grp: any) => {
          const byTactic: Record<string, any[]> = {};
          for (const t of grp.techniques || []) (byTactic[t.tactic || "other"] ||= []).push(t);
          const res = results[grp.name];
          return (
            <div key={grp.name} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground flex items-center gap-2"><Crosshair className="h-4 w-4 text-accent" /> {grp.name}</div>
                  {grp.description && <p className="text-[11px] text-muted-foreground mt-0.5">{grp.description}</p>}
                </div>
                <button onClick={() => run(grp.name, (grp.techniques || []).map((t: any) => t.id))} disabled={!envId || running === grp.name}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                  {running === grp.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Simulate
                </button>
              </div>
              <div className="space-y-2">
                {Object.entries(byTactic).map(([tactic, ts]) => (
                  <div key={tactic}>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{tactic.replace(/-/g, " ")}</div>
                    <div className="flex flex-wrap gap-1.5">{ts.map((t) => <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background/40 text-[11px]"><span className="font-mono text-accent">{t.id}</span> <span className="text-muted-foreground">{t.name}</span></span>)}</div>
                  </div>
                ))}
              </div>
              {errors[grp.name] && <div className="text-[11px] text-danger inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {errors[grp.name]}</div>}
              {res && (
                <div className="rounded-lg border border-border bg-background/40 p-2 space-y-1">
                  <div className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">{res.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />} Run {res.status} · {res.stepCount} steps · {res.mappedTechniques?.length}/{(res.mappedTechniques?.length || 0) + (res.droppedTechniques?.length || 0)} mapped</div>
                  {(res.stepResults || []).slice(0, 8).map((s: any, i: number) => <div key={i} className="text-[10px] font-mono text-muted-foreground"><span className={cn("uppercase font-bold", s.status === "ok" ? "text-success" : s.status === "stubbed" ? "text-warning" : "text-danger")}>{s.status}</span> · {(s.notes || s.framework || "").slice(0, 58)}</div>)}
                </div>
              )}
            </div>
          );
        })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
