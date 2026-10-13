"use client";

/**
 * Built-in module view: the "APT Simulation" library — a geo/sector lens over
 * Atomic Red Team tests, imported from CyberGeoOps. Analysts browse named APT
 * groups two ways:
 *   • By origin country  (APT attribution: China / Russia / Iran / N.Korea …)
 *   • By targeted sector (the "domain" facet: Government / Defense / Financial …)
 * then open a group, pick its atomics, and run them through the SAME atomic
 * path the Campaign Designer uses (each atomic is an ART test resolved by GUID).
 *
 * Reads /api/apt/facets, /api/apt/groups, /api/apt/groups/[name]. Selection is
 * handed to the Campaign Designer via sessionStorage["apt.campaignHandoff"].
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Globe, Loader2, Crosshair, Factory, ArrowRight, ArrowLeft, Search, Terminal,
  ChevronRight, Shield, Flag, Layers, Play, CheckSquare, Square, ExternalLink,
  BookOpen, Wrench, FlaskConical, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "@/components/shared/PlatformBadge";
import { APT_RESOURCES, groupReferences } from "@/config/apt-sim/resources";

// ─── small helpers ───────────────────────────────────────────────────────────
// ISO-ish origin code → flag emoji (regional indicators). Unknown codes fall
// back to a globe so the UI never shows a broken glyph.
function flag(code: string): string {
  const c = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🌐";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
const TYPE_TONE: Record<string, string> = {
  apt: "text-danger border-danger/30 bg-danger/10",
  ransomware: "text-warning border-warning/30 bg-warning/10",
  campaign: "text-accent border-accent/30 bg-accent/10",
  criminal: "text-purple border-purple/30 bg-purple/10",
};

interface Facets {
  totals: { groups: number; countries: number; sectors: number };
  countries: { name: string; code: string; groups: number; atomics: number }[];
  sectors: { name: string; groups: number }[];
  actorTypes: { name: string; groups: number }[];
}
interface GroupItem {
  name: string; mitreId: string; originCountry: string; originCode: string;
  actorType: string; aliases: string[]; primarySectors: string[]; sectors: string[];
  tactics: string[]; atomicCount: number;
}
interface AtomicItem {
  atomicTestId: string | null; testGuid: string; techniqueId: string; techniqueName: string;
  testName: string; testNumber: number | null; platform: string; platforms: string[]; executor: string; tactic: string;
  command: string; cleanupCommand: string; description: string; elevationRequired: boolean; runnable: boolean;
}

export default function AptCatalogView({ moduleId }: { moduleId: string; sub: string[] }) {
  const router = useRouter();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [mode, setMode] = useState<"country" | "sector">("country");
  const [country, setCountry] = useState("");
  const [sector, setSector] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [active, setActive] = useState<string | null>(null);     // open group name
  const [topView, setTopView] = useState<"groups" | "plans" | "resources">("groups");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [meta, setMeta] = useState<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });

  useEffect(() => {
    fetch("/api/apt/facets").then((r) => r.ok ? r.json() : null).then(setFacets).catch(() => {});
  }, []);

  // Changing a filter / page size resets to page 1.
  useEffect(() => { setPage(1); }, [country, sector, type, q, pageSize]);

  useEffect(() => {
    setLoadingGroups(true);
    const p = new URLSearchParams();
    if (country) p.set("country", country);
    if (sector) p.set("sector", sector);
    if (type) p.set("type", type);
    if (q) p.set("q", q);
    p.set("page", String(page));
    p.set("page_size", String(pageSize));
    const t = setTimeout(() => {
      fetch(`/api/apt/groups?${p}`).then((r) => r.ok ? r.json() : { items: [] })
        .then((d) => { setGroups(d.items || []); setMeta({ total: d.total || 0, totalPages: d.totalPages || 1 }); })
        .catch(() => { setGroups([]); setMeta({ total: 0, totalPages: 1 }); })
        .finally(() => setLoadingGroups(false));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [country, sector, type, q, page, pageSize]);

  if (active) return <GroupDetail name={active} moduleId={moduleId} onBack={() => setActive(null)} />;

  const facetItems = mode === "country"
    ? (facets?.countries || []).map((c) => ({ key: c.name, label: c.name, badge: c.code, count: c.groups }))
    : (facets?.sectors || []).map((s) => ({ key: s.name, label: s.name, badge: "", count: s.groups }));
  const activeFacet = mode === "country" ? country : sector;
  const setFacet = (v: string) => {
    if (mode === "country") { setCountry(v); setSector(""); } else { setSector(v); setCountry(""); }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-danger/30 bg-danger/10 text-danger"><Globe className="h-6 w-6" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">APT Simulation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Atomic emulation of named APT groups, by origin country and targeted sector. Each atomic is an Atomic Red Team test — run them through the same path as the Campaign Designer.
          </p>
          {facets && (
            <div className="mt-1 text-[11px] text-muted-foreground font-mono">
              {facets.totals.groups} groups · {facets.totals.countries} origin countries · {facets.totals.sectors} sectors
            </div>
          )}
        </div>
      </div>

      {/* Top navigation: groups / emulation plans / resources */}
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {([["groups", "Groups", Crosshair], ["plans", "Emulation Plans", FlaskConical], ["resources", "Resources", BookOpen]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTopView(k)} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md", topView === k ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {topView === "plans" && <PlansView />}
      {topView === "resources" && <ResourcesView />}

      {topView === "groups" && <>
      {/* Facet mode + type + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          <button onClick={() => { setMode("country"); setSector(""); }} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md", mode === "country" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Flag className="h-3.5 w-3.5" /> By country</button>
          <button onClick={() => { setMode("sector"); setCountry(""); }} className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md", mode === "sector" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Factory className="h-3.5 w-3.5" /> By sector</button>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 px-2 text-xs rounded-md border border-border bg-input text-foreground">
          <option value="">All actor types</option>
          {(facets?.actorTypes || []).map((t) => <option key={t.name} value={t.name}>{t.name} ({t.groups})</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search group or alias…" className="w-full h-9 pl-8 pr-3 text-xs rounded-md border border-border bg-input text-foreground" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-4">
        {/* Facet rail */}
        <div className="rounded-xl border border-border bg-card p-2 h-fit max-h-[560px] overflow-auto">
          <button onClick={() => setFacet("")} className={cn("w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md", !activeFacet ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground hover:text-foreground")}>
            <span>All groups</span><span className="font-mono">{facets?.totals.groups ?? ""}</span>
          </button>
          {facetItems.map((f) => (
            <button key={f.key} onClick={() => setFacet(f.key)} className={cn("w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-md", activeFacet === f.key ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground hover:text-foreground")}>
              <span className="truncate flex items-center gap-1.5">{mode === "country" && <span>{flag(f.badge)}</span>}{f.label}</span>
              <span className="font-mono shrink-0">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Group grid */}
        <div className="min-w-0">
          {loadingGroups ? (
            <div className="p-8 flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading groups…</div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">No APT groups match this filter.</div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  {meta.total} group{meta.total === 1 ? "" : "s"}{activeFacet ? ` · ${mode === "country" ? "origin" : "targeting"}: ${activeFacet}` : ""}
                  {meta.total > 0 && <> · showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, meta.total)}</>}
                </div>
                <label className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                  Per page
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-7 px-1.5 rounded-md border border-border bg-input text-foreground">
                    {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {groups.map((g) => (
                  <button key={g.name} onClick={() => setActive(g.name)} className="group text-left rounded-xl border border-border bg-card p-4 hover:border-accent/40 hover:bg-card-hover transition-all">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate flex items-center gap-1.5">
                          <span className="text-base leading-none">{flag(g.originCode)}</span>{g.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{g.originCountry || "Unattributed"}{g.mitreId ? ` · ${g.mitreId}` : ""}</div>
                      </div>
                      <span className={cn("text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border shrink-0", TYPE_TONE[g.actorType] || "text-muted-foreground border-border bg-muted/10")}>{g.actorType}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.primarySectors.slice(0, 3).map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/10 text-muted-foreground">{s}</span>)}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground inline-flex items-center gap-1"><Terminal className="h-3 w-3" /> {g.atomicCount} atomics</span>
                      <span className="text-accent inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">Open <ArrowRight className="h-3 w-3" /></span>
                    </div>
                  </button>
                ))}
              </div>
              {meta.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2 text-xs">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed">
                    <ArrowLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <span className="text-muted-foreground px-1">Page <b className="text-foreground">{page}</b> of {meta.totalPages}</span>
                  <button onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={page >= meta.totalPages}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-card-hover disabled:opacity-40 disabled:cursor-not-allowed">
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

// ─── Emulation Plans view (CTID / ATT&CK-Eval, referential + runnable) ────────
function PlansView() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/apt/plans").then((r) => r.ok ? r.json() : null).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const runPlan = async (key: string, name: string) => {
    setRunning(key);
    try {
      const d = await fetch(`/api/apt/plans/${encodeURIComponent(key)}`).then((r) => r.ok ? r.json() : null);
      const ids: string[] = d?.atomicTestIds || [];
      if (!ids.length) return;
      try { sessionStorage.setItem("apt.campaignHandoff", JSON.stringify({ group: name, atomicTestIds: ids, count: ids.length })); } catch { /* ignore */ }
      router.push("/campaign-designer");
    } finally { setRunning(null); }
  };

  if (loading) return <div className="p-8 flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading emulation plans…</div>;
  const sections: [string, string, any[]][] = [
    ["MITRE CTID — Full Emulation Plans", "Intel-driven plans that replay a breach end-to-end. Technique coverage parsed from each plan's own YAML.", data?.bySource?.["ctid-full"] || []],
    ["ATT&CK Evaluations (ael)", "The adversary plans used in the public ATT&CK Evaluations — realistic, multi-stage benchmarks.", data?.bySource?.["attack-eval"] || []],
    ["CTID — Micro Emulation Plans", "Small, behavior-focused plans to run à la carte or bolt onto a full campaign.", data?.bySource?.["ctid-micro"] || []],
  ];
  return (
    <div className="space-y-5">
      {sections.map(([title, blurb, plans]) => (
        <div key={title}>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-[11px] text-muted-foreground mb-2">{blurb}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {plans.map((p: any) => (
              <div key={p.key} className="rounded-xl border border-border bg-card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{[p.actor, p.origin].filter(Boolean).join(" · ") || "behavior plan"}</div>
                  </div>
                  {p.round && <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent shrink-0">{p.round}</span>}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-3 flex-1">{p.description}</p>
                {p.sectors?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{p.sectors.slice(0, 3).map((s: string) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/10 text-muted-foreground">{s}</span>)}</div>}
                <div className="mt-2 text-[10px] text-muted-foreground font-mono">
                  {p.techniqueCount > 0 ? `${p.techniqueCount} techniques · ${p.stepCount} steps · ${p.atomicCount} atomics` : "reference plan"}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <a href={p.repoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent inline-flex items-center gap-1 hover:underline"><ExternalLink className="h-3 w-3" /> Repo</a>
                  {p.runnable ? (
                    <button onClick={() => runPlan(p.key, p.name)} disabled={running === p.key} className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-2.5 py-1.5 hover:bg-[#60a5fa] disabled:opacity-50">
                      {running === p.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run plan
                    </button>
                  ) : (
                    <a href={p.referenceUrl || p.repoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><Link2 className="h-3 w-3" /> Reference</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Resources view (referential open-source links from the research doc) ─────
function ResourcesView() {
  const ICONS = [FlaskConical, Wrench, Shield, FlaskConical];
  return (
    <div className="space-y-5">
      <p className="text-[11px] text-muted-foreground">Curated open-source resources for building & running the APT simulation lab — emulation plans, BAS tooling, threat intelligence, and instrumented ranges. For authorized defensive / purple-team use only.</p>
      {APT_RESOURCES.map((grp, i) => {
        const Icon = ICONS[i % ICONS.length];
        return (
          <div key={grp.title}>
            <h2 className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-accent" /> {grp.title}</h2>
            <p className="text-[11px] text-muted-foreground mb-2">{grp.blurb}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {grp.items.map((r) => (
                <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer" className="group rounded-lg border border-border bg-card p-3 hover:border-accent/40 hover:bg-card-hover transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{r.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-accent shrink-0" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{r.description}</p>
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Group detail: profile + selectable atomics → Campaign Designer ───────────
function GroupDetail({ name, moduleId, onBack }: { name: string; moduleId: string; onBack: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [tactic, setTactic] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());   // atomicTestId set

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ page_size: "1000" });
    if (q) p.set("q", q); if (platform) p.set("platform", platform); if (tactic) p.set("tactic", tactic);
    const t = setTimeout(() => {
      fetch(`/api/apt/groups/${encodeURIComponent(name)}?${p}`).then((r) => r.ok ? r.json() : null)
        .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [name, q, platform, tactic]);

  const items: AtomicItem[] = data?.items || [];
  const runnableIds = useMemo(() => items.filter((i) => i.runnable && i.atomicTestId).map((i) => i.atomicTestId as string), [items]);
  const allPicked = runnableIds.length > 0 && runnableIds.every((id) => picked.has(id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked((s) => { if (allPicked) return new Set(); return new Set(runnableIds); });

  const platforms = useMemo(() => [...new Set(items.flatMap((i) => i.platforms))].filter(Boolean).sort(), [items]);
  const tactics = useMemo(() => [...new Set(items.map((i) => i.tactic).filter(Boolean))].sort(), [items]);

  // Hand the full selection to the Campaign Designer as an APT atomic selection
  // (atomic_tests ids). The designer launches it through /api/apt/campaign-simulate,
  // which runs EVERY selected atomic and scores prevention + detection — not the
  // native one-test-per-technique flow.
  const openInDesigner = () => {
    const atomicTestIds = items.filter((i) => i.atomicTestId && picked.has(i.atomicTestId)).map((i) => i.atomicTestId as string);
    if (!atomicTestIds.length) return;
    try {
      sessionStorage.setItem("apt.campaignHandoff", JSON.stringify({
        group: name, originCountry: data?.group?.originCountry || "", atomicTestIds, count: atomicTestIds.length,
      }));
    } catch { /* ignore */ }
    router.push("/campaign-designer");
  };

  // Unique ATT&CK techniques spanned by the current selection (shown in the tray).
  const pickedTechniques = useMemo(() => {
    const s = new Set<string>();
    for (const a of items) if (a.atomicTestId && picked.has(a.atomicTestId) && a.techniqueId) s.add(a.techniqueId);
    return s.size;
  }, [items, picked]);

  const g = data?.group;
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> All APT groups</button>

      {loading && !data ? (
        <div className="p-8 flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading {name}…</div>
      ) : !g ? (
        <div className="p-8 text-sm text-danger">Group not found.</div>
      ) : (
        <>
          {/* Profile */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl leading-none">{flag(g.originCode)}</span>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2">{g.name}
                  <span className={cn("text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded border", TYPE_TONE[g.actorType] || "text-muted-foreground border-border bg-muted/10")}>{g.actorType}</span>
                </h1>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span className="inline-flex items-center gap-1"><Flag className="h-3 w-3" /> Origin: <b className="text-foreground">{g.originCountry || "Unattributed"}</b></span>
                  {g.mitreId && <span className="ml-3 font-mono">{g.mitreId}</span>}
                  {g.aliases?.length > 0 && <span className="ml-3">aka {g.aliases.slice(0, 5).join(", ")}</span>}
                </div>
                {g.primarySectors?.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1 inline-flex items-center gap-1"><Factory className="h-3 w-3" /> Targeted sectors</div>
                    <div className="flex flex-wrap gap-1">{g.sectors.slice(0, 12).map((s: string) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/10 text-muted-foreground">{s}</span>)}</div>
                  </div>
                )}
                {g.tactics?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 items-center">
                    <span className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1"><Layers className="h-3 w-3" /> Tactics</span>
                    {g.tactics.map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 bg-accent/5 text-accent">{t}</span>)}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] uppercase text-muted-foreground inline-flex items-center gap-1"><Link2 className="h-3 w-3" /> References</span>
                  {groupReferences({ name: g.name, mitreId: g.mitreId }).map((ref) => (
                    <a key={ref.url} href={ref.url} target="_blank" rel="noopener noreferrer" title={ref.description} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/10 text-muted-foreground hover:text-accent hover:border-accent/40 inline-flex items-center gap-1">
                      {ref.name} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Atomics toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5"><Terminal className="h-4 w-4 text-accent" /> Atomics
              <span className="text-[11px] text-muted-foreground font-normal">{data.runnable}/{data.total} runnable</span>
            </div>
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter technique / test…" className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-border bg-input text-foreground" />
            </div>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 px-2 text-xs rounded-md border border-border bg-input text-foreground">
              <option value="">All platforms</option>{platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={tactic} onChange={(e) => setTactic(e.target.value)} className="h-8 px-2 text-xs rounded-md border border-border bg-input text-foreground">
              <option value="">All tactics</option>{tactics.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Atomics table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/5 text-[11px] text-muted-foreground">
              <button onClick={toggleAll} className="inline-flex items-center gap-1.5 hover:text-foreground">
                {allPicked ? <CheckSquare className="h-3.5 w-3.5 text-accent" /> : <Square className="h-3.5 w-3.5" />} Select all runnable ({runnableIds.length})
              </button>
            </div>
            <div className="max-h-[440px] overflow-auto divide-y divide-border">
              {items.map((a) => {
                const id = a.atomicTestId || a.testGuid;
                const on = a.atomicTestId ? picked.has(a.atomicTestId) : false;
                return (
                  <div key={id} className={cn("flex items-start gap-2.5 px-3 py-2 text-xs", !a.runnable && "opacity-50")}>
                    <button disabled={!a.runnable} onClick={() => a.atomicTestId && toggle(a.atomicTestId)} className="mt-0.5 shrink-0 disabled:cursor-not-allowed">
                      {on ? <CheckSquare className="h-4 w-4 text-accent" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-accent">{a.techniqueId}</span>
                        <span className="text-foreground font-medium">{a.testName}</span>
                        {!a.runnable && <span className="text-[9px] uppercase text-warning border border-warning/30 bg-warning/10 rounded px-1">not in local ART</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>{a.techniqueName}</span>
                        {(a.platforms?.length ? a.platforms : a.platform ? [a.platform] : []).length > 0 && <PlatformBadges platforms={a.platforms?.length ? a.platforms : [a.platform]} size="xs" />}
                        {a.executor && <span className="font-mono">{a.executor}</span>}
                        {a.tactic && <span>{a.tactic}</span>}
                        {a.elevationRequired && <span className="text-warning">elevated</span>}
                      </div>
                      {a.command && <pre className="mt-1 text-[10px] text-muted-foreground/80 font-mono whitespace-pre-wrap break-all line-clamp-2 bg-background/40 rounded px-2 py-1 border border-border">{a.command}</pre>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Selection tray */}
      {picked.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-card shadow-lg px-4 py-3">
          <div className="text-xs text-foreground"><b>{picked.size}</b> atomic test{picked.size === 1 ? "" : "s"} selected from <b>{name}</b> · {pickedTechniques} technique{pickedTechniques === 1 ? "" : "s"}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPicked(new Set())} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">Clear</button>
            <button onClick={openInDesigner} className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md bg-accent text-white px-3 py-2 hover:bg-[#60a5fa]">
              <Play className="h-3.5 w-3.5" /> Open in Campaign Designer <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
