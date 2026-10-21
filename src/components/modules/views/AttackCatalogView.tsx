"use client";

/**
 * Built-in module view for the hybrid attack libraries (Container & Orchestration,
 * Cloud, Active Directory, Hacktools). Presents EVERY use case in the module as a
 * single sortable / filterable TABLE — the same listing style as the Atomic Test
 * Library ("Atomics Execution"): one row per Atomic Red Team test (a use case),
 * with its technique, tactic, domain, platforms and executor. A row expands to the
 * real command the Campaign Designer will execute. Analysts tick the use cases
 * they want and "Open in Campaign Designer", which hands the selection into the
 * Designer's normal technique flow (Step 2) where the environment is chosen and
 * the run happens — identical to every other simulation path. Techniques with no
 * atomic in the local library are still listed (for coverage) but are not selectable.
 *
 * All four attack libraries share this component, so they list use cases the same way.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformBadges } from "@/components/shared/PlatformBadge";
import {
  Loader2, Boxes, Layers, Crosshair, Shield, Database, Search, X, ArrowRight,
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, ChevronDown, ShieldAlert, Terminal, Copy, Check, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { purpleSharpSupports } from "@/config/attack-libraries/purplesharp";

type Engine = "art" | "purplesharp";
interface Tech { id: string; name: string; tactic?: string; uid?: string; match?: string[] }
interface Group { name: string; domain?: string; description?: string; techniques: Tech[] }
interface Atomic {
  id: string; techniqueId: string; requestedId: string; techniqueName: string;
  testNumber: number; testName: string; executor: string; platforms: string[];
  command: string; cleanupCommand: string; elevationRequired: boolean; tactic: string; description: string;
}
// One table row = one use case: an ART atomic test, a PurpleSharp technique
// simulation, or a non-runnable coverage row. `engine` is null when neither
// engine can run it. Selectable rows carry a `selKey`.
interface Row {
  key: string; engine: Engine | null; runnable: boolean; selKey?: string;
  atomic?: Atomic;
  techniqueId: string; techniqueName: string; domain: string; tactic: string;
  testNumber?: number; testName: string; executor: string; platforms: string[];
  command?: string; cleanupCommand?: string; elevationRequired?: boolean; description?: string;
}
// What a ticked row contributes to the Campaign Designer handoff.
interface PickEntry { engine: Engine; techniqueId: string; testNumber: number }

const titleCase = (s: string) => (s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function AttackCatalogView({ moduleId }: { moduleId: string; sub: string[] }) {
  const router = useRouter();
  const [mod, setMod] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [atomicsByTech, setAtomicsByTech] = useState<Record<string, Atomic[]>>({});
  const [resolving, setResolving] = useState(false);

  // Filters / sort / selection / expansion
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [tactic, setTactic] = useState("");
  const [platform, setPlatform] = useState("");
  const [executor, setExecutor] = useState("");
  const [engineFilter, setEngineFilter] = useState("");
  const [sortBy, setSortBy] = useState<keyof Row>("techniqueId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [picked, setPicked] = useState<Record<string, PickEntry>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const d = await fetch(`/api/modules/${moduleId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setMod(d); setLoading(false);
    })();
  }, [moduleId]);

  const catalog: Group[] = mod?.manifest?.contributes?.catalog || [];

  // Windows-only disciplines (AD and the Windows escalation libraries) are scoped
  // to Windows atomic tests. This strips Linux/macOS/cloud tests that a shared
  // ATT&CK technique may also carry, keeping the library on-platform.
  const WIN_ONLY = new Set(["active-directory", "uac-bypass", "user-to-admin", "user-to-system"]);
  const platformScope: string[] | null = WIN_ONLY.has(mod?.category) ? ["windows"] : null;
  const inScope = (a: Atomic) => !platformScope || !(a.platforms?.length) || a.platforms.some((p) => platformScope.includes(p));

  // technique id → {domain, tactic, name} from the manifest (first group wins).
  // Keyed by `uid` (defaults to the ATT&CK id, so existing modules are unchanged).
  // A module may list several named entries under one ATT&CK id by giving each a
  // distinct `uid`; `match` then narrows that id's atomic tests to the ones whose
  // name contains any term ([] = coverage-only, no runnable atomic).
  const techMeta = useMemo(() => {
    const m = new Map<string, { tid: string; domain: string; tactic: string; name: string; match?: string[] }>();
    for (const g of catalog) for (const t of g.techniques) {
      const uid = t.uid || t.id;
      if (!m.has(uid)) m.set(uid, { tid: t.id, domain: g.domain || "General", tactic: g.name || t.tactic || "other", name: t.name, match: t.match });
    }
    return m;
  }, [catalog]);

  // Resolve ALL techniques in the module to their real atomic tests in one call.
  useEffect(() => {
    // Unique ATT&CK ids, most specific first, so a sub-technique's atomics are
    // attributed to it rather than to a parent id listed in the same module.
    const ids = [...new Set([...techMeta.values()].map((v) => v.tid))].sort((a, b) => b.length - a.length);
    if (!ids.length) return;
    setResolving(true);
    (async () => {
      const d = await fetch(`/api/attack/atomics?techniques=${ids.join(",")}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
      const map: Record<string, Atomic[]> = {};
      for (const a of (d.items || []) as Atomic[]) (map[a.requestedId] ||= []).push(a);
      setAtomicsByTech(map); setResolving(false);
    })();
  }, [techMeta]);

  // Flatten to rows. Per technique: one ART row per atomic test (where the
  // library has one); one PurpleSharp row if PurpleSharp supports the technique
  // (native AD adversary-simulation — the alternative engine, and the ONLY
  // engine for AD techniques that ship no atomic); else a non-runnable coverage
  // row. PurpleSharp runs on a Windows fleet node.
  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const claimed = new Set<string>();
    for (const [uid, meta] of techMeta) {
      const id = meta.tid;
      let atoms = (atomicsByTech[id] || []).filter(inScope);
      // Named-entry narrowing (see techMeta): keep only tests whose name contains
      // any `match` term; `[]` keeps none (coverage-only entry).
      if (meta.match) {
        const terms = meta.match.map((s) => s.toLowerCase());
        atoms = atoms.filter((a) => terms.some((s) => (a.testName || "").toLowerCase().includes(s)));
      }
      atoms = atoms.filter((a) => !claimed.has(a.id));
      for (const a of atoms) claimed.add(a.id);
      for (const a of atoms) rows.push({
        key: `${uid}:${a.id}`, engine: "art", runnable: !!a.command, selKey: a.command ? a.id : undefined, atomic: a,
        techniqueId: a.techniqueId || id, techniqueName: meta.name, domain: meta.domain, tactic: meta.tactic,
        testNumber: a.testNumber, testName: a.testName, executor: a.executor || "—", platforms: a.platforms || [],
        command: a.command, cleanupCommand: a.cleanupCommand, elevationRequired: a.elevationRequired, description: a.description,
      });
      // PurpleSharp row only for un-narrowed entries (a `match` entry is one named
      // variant, not the whole ATT&CK technique PurpleSharp simulates).
      if (meta.match === undefined && purpleSharpSupports(id)) {
        rows.push({
          key: `ps:${uid}`, engine: "purplesharp", runnable: true, selKey: `ps:${uid}`,
          techniqueId: id, techniqueName: meta.name, domain: meta.domain, tactic: meta.tactic,
          testNumber: 0, testName: "PurpleSharp technique simulation (native AD)", executor: "PurpleSharp", platforms: ["windows"],
          command: `PurpleSharp.exe /t ${id}`,
          description: "Executes this ATT&CK technique on a Windows fleet node via PurpleSharp, generating native AD telemetry for detection scoring.",
        });
      } else if (!atoms.length) {
        rows.push({
          key: `none:${uid}`, engine: null, runnable: false,
          techniqueId: id, techniqueName: meta.name, domain: meta.domain, tactic: meta.tactic,
          testName: "No ART atomic or PurpleSharp coverage", executor: "—", platforms: [],
        });
      }
    }
    return rows;
  }, [techMeta, atomicsByTech]);

  const domains = useMemo(() => [...new Set(allRows.map((r) => r.domain))].sort(), [allRows]);
  const tactics = useMemo(() => [...new Set(allRows.map((r) => r.tactic))].sort(), [allRows]);
  const platforms = useMemo(() => [...new Set(allRows.flatMap((r) => r.platforms))].sort(), [allRows]);
  const executors = useMemo(() => [...new Set(allRows.map((r) => r.executor).filter((e) => e && e !== "—"))].sort(), [allRows]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = allRows.filter((r) =>
      (!domain || r.domain === domain) &&
      (!tactic || r.tactic === tactic) &&
      (!platform || r.platforms.includes(platform)) &&
      (!executor || r.executor === executor) &&
      (!engineFilter || (engineFilter === "coverage" ? r.engine === null : r.engine === engineFilter)) &&
      (!q || r.techniqueId.toLowerCase().includes(q) || r.testName.toLowerCase().includes(q) || r.techniqueName.toLowerCase().includes(q))
    );
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => String(a[sortBy] ?? "").localeCompare(String(b[sortBy] ?? ""), undefined, { numeric: true }) * dir);
  }, [allRows, search, domain, tactic, platform, executor, engineFilter, sortBy, sortDir]);

  const toggleSort = (field: keyof Row) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };
  const entryOf = (r: Row): PickEntry => ({ engine: r.engine as Engine, techniqueId: r.techniqueId, testNumber: r.testNumber ?? 0 });
  const togglePick = (r: Row) => { if (!r.runnable || !r.selKey) return; setPicked((p) => { const n = { ...p }; if (n[r.selKey!]) delete n[r.selKey!]; else n[r.selKey!] = entryOf(r); return n; }); };
  const pickedCount = Object.keys(picked).length;
  const hasFilters = !!(search || domain || tactic || platform || executor || engineFilter);
  const clearFilters = () => { setSearch(""); setDomain(""); setTactic(""); setPlatform(""); setExecutor(""); setEngineFilter(""); };

  // Select / clear every currently-visible, runnable row.
  const visibleSel = rows.filter((r) => r.runnable && r.selKey);
  const allVisibleOn = visibleSel.length > 0 && visibleSel.every((r) => picked[r.selKey!]);
  const toggleAllVisible = () => setPicked((p) => {
    const n = { ...p };
    if (allVisibleOn) for (const r of visibleSel) delete n[r.selKey!];
    else for (const r of visibleSel) n[r.selKey!] = entryOf(r);
    return n;
  });

  const openInDesigner = () => {
    const sel = Object.values(picked);
    if (!sel.length) return;
    const techniques = [...new Set(sel.map((e) => e.techniqueId))];
    // Engine per technique: PurpleSharp wins if any PurpleSharp row is ticked for
    // it; otherwise ART. tests/testLists carry the ART test numbers.
    const engines: Record<string, Engine> = {};
    const testLists: Record<string, number[]> = {};
    const tests: Record<string, number> = {};
    for (const e of sel) {
      if (e.engine === "purplesharp") engines[e.techniqueId] = "purplesharp";
      else {
        if (engines[e.techniqueId] !== "purplesharp") engines[e.techniqueId] = "art";
        (testLists[e.techniqueId] ||= []).push(e.testNumber);
        if (tests[e.techniqueId] == null) tests[e.techniqueId] = e.testNumber;
      }
    }
    try {
      sessionStorage.setItem("attack.campaignHandoff", JSON.stringify({ techniques, tests, testLists, engines, label: mod?.name || "Attack library", source: moduleId }));
    } catch { /* ignore */ }
    router.push("/campaign-designer");
  };

  if (loading) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!mod || mod.error) return <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Module not found.</div>;

  const totalTechniques = techMeta.size;
  const totalUseCases = allRows.filter((r) => r.runnable).length;
  const psCount = allRows.filter((r) => r.engine === "purplesharp").length;

  return (
    <div className={cn("space-y-5", pickedCount > 0 && "pb-24")}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Boxes className="h-6 w-6" /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{mod.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mod.description}</p>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">{mod.moduleId} · {mod.category}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat icon={<Database className="h-4 w-4" />} label="Runnable use cases" value={String(totalUseCases)} color="text-foreground" />
        <Stat icon={<Layers className="h-4 w-4" />} label="Techniques" value={String(totalTechniques)} color="text-accent" />
        <Stat icon={<Crosshair className="h-4 w-4" />} label="Tactics" value={String(tactics.length)} color="text-warning" />
        <Stat icon={<Boxes className="h-4 w-4" />} label="Domains" value={String(domains.length)} color="text-purple" />
        <Stat icon={<Shield className="h-4 w-4" />} label="PurpleSharp-capable" value={String(psCount)} color="text-[#a855f7]" />
      </div>

      {/* Search + filters */}
      <div className="flex items-end gap-3 flex-wrap rounded-xl border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search use case, technique ID or name…"
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none" />
        </div>
        {domains.length > 1 && <Select label="Domain" value={domain} onChange={setDomain} options={domains.map((d) => ({ value: d, label: d }))} placeholder="All domains" />}
        <Select label="Tactic" value={tactic} onChange={setTactic} options={tactics.map((t) => ({ value: t, label: titleCase(t) }))} placeholder="All tactics" />
        <Select label="Platform" value={platform} onChange={setPlatform} options={platforms.map((p) => ({ value: p, label: titleCase(p) }))} placeholder="All platforms" />
        <Select label="Executor" value={executor} onChange={setExecutor} options={executors.map((e) => ({ value: e, label: e }))} placeholder="All executors" />
        <Select label="Engine" value={engineFilter} onChange={setEngineFilter} options={[{ value: "art", label: "Atomic Red Team" }, { value: "purplesharp", label: "PurpleSharp" }, { value: "coverage", label: "Coverage only" }]} placeholder="Any engine" />
        {hasFilters && <button onClick={clearFilters} className="flex items-center gap-1 h-8 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-card-hover"><X className="h-3 w-3" /> Clear</button>}
      </div>

      {/* Result count + select-all */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {resolving ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> resolving use cases…</span>
            : <>{rows.length.toLocaleString()} use case{rows.length === 1 ? "" : "s"}{hasFilters ? " (filtered)" : ""}</>}
        </p>
        {visibleSel.length > 0 && (
          <button onClick={toggleAllVisible} className="text-[11px] text-accent hover:underline">
            {allVisibleOn ? "Clear visible" : `Select all visible (${visibleSel.length})`}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-semibold uppercase text-muted-foreground tracking-wide border-b border-border">
          <div className="col-span-1" />
          <SortHead label="Technique" field="techniqueId" span={2} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
          <SortHead label="Use Case" field="testName" span={3} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
          <SortHead label="Engine" field="engine" span={1} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
          <SortHead label="Tactic" field="tactic" span={2} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
          <SortHead label="Domain" field="domain" span={1} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
          <div className="col-span-1">Platforms</div>
          <SortHead label="Executor" field="executor" span={1} sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
        </div>

        {resolving && rows.length === 0 ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No use cases match the filters.</div>
        ) : (
          rows.map((r) => {
            const on = r.selKey ? !!picked[r.selKey] : false;
            const isOpen = expanded === r.key;
            const canExpand = !!r.command;
            return (
              <div key={r.key} className={cn("border-b border-border/60 last:border-0", on && "bg-accent/[0.04]")}>
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center">
                  <div className="col-span-2 md:col-span-1 flex items-center gap-1.5">
                    {r.runnable && r.selKey ? (
                      <input type="checkbox" checked={on} onChange={() => togglePick(r)} className="accent-[#3b82f6]" title="Add to simulation queue" />
                    ) : <span className="w-3.5" title="Not runnable (coverage only)" />}
                    <button onClick={() => canExpand && setExpanded(isOpen ? null : r.key)} className={cn(canExpand ? "text-muted-foreground hover:text-foreground" : "opacity-30 cursor-default")}>
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="col-span-10 md:col-span-2 flex items-center gap-1.5">
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{r.techniqueId}</span>
                    {r.engine === "art" && <span className="text-[10px] text-muted-foreground">#{r.testNumber}</span>}
                  </div>
                  <div className="col-span-12 md:col-span-3 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("text-xs font-medium truncate", r.runnable ? "text-foreground" : "text-muted-foreground italic")}>{r.testName}</span>
                      {r.elevationRequired && <span className="inline-flex items-center gap-0.5 text-[9px] text-warning shrink-0"><ShieldAlert className="h-2.5 w-2.5" /> elev</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{r.techniqueName}</div>
                  </div>
                  <div className="col-span-6 md:col-span-1">
                    {r.engine === "art" && <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded border border-accent/40 text-accent bg-accent/10">ART</span>}
                    {r.engine === "purplesharp" && <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded border border-[#a855f7]/40 text-[#a855f7] bg-[#a855f7]/10">PurpleSharp</span>}
                    {r.engine === null && <span className="inline-block text-[9px] text-muted-foreground">—</span>}
                  </div>
                  <div className="col-span-6 md:col-span-2 text-[10px] text-muted-foreground">{titleCase(r.tactic)}</div>
                  <div className="col-span-6 md:col-span-1 text-[10px] text-muted-foreground truncate">{r.domain}</div>
                  <div className="col-span-6 md:col-span-1"><PlatformBadges platforms={r.platforms} size="xs" max={3} /></div>
                  <div className="col-span-6 md:col-span-1 text-[10px] text-muted-foreground truncate">{r.executor}</div>
                </div>

                {isOpen && canExpand && (
                  <div className="px-4 pb-3 md:pl-10 space-y-2 bg-background/30">
                    {r.description && <div className="text-[11px] text-muted-foreground">{r.description}</div>}
                    <CommandBlock label={r.engine === "purplesharp" ? "PurpleSharp command" : "Command"} text={r.command!} />
                    {r.cleanupCommand && <CommandBlock label="Cleanup" text={r.cleanupCommand} muted />}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each use case runs via <span className="text-accent font-medium">Atomic Red Team</span> (the atomic test) or <span className="text-[#a855f7] font-medium">PurpleSharp</span> (native Windows-AD adversary simulation of the whole technique, on a fleet node). Tick the ones to run; the Campaign Designer handles the target, execution and detection scoring. PurpleSharp requires a Windows fleet endpoint (installed by the agent prepare script). Authorized, isolated-lab use only.
      </p>

      {/* Sticky action bar → Campaign Designer */}
      {pickedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-xs text-muted-foreground"><strong className="text-foreground">{pickedCount}</strong> use case{pickedCount === 1 ? "" : "s"} queued</span>
            <button onClick={() => setPicked({})} className="text-[11px] text-muted-foreground hover:text-foreground">clear</button>
            <button onClick={openInDesigner} className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-[#60a5fa]">
              <Play className="h-3.5 w-3.5" /> Simulate in Campaign Designer <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── sub-components ── */
function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1"><span className="text-muted-foreground">{icon}</span><p className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</p></div>
      <p className={cn("text-xl font-bold", color)}>{value}</p>
    </div>
  );
}

function Select({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-accent focus:outline-none min-w-[120px] block">
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function SortHead({ label, field, span, sortBy, sortDir, onSort }: { label: string; field: keyof Row; span: number; sortBy: keyof Row; sortDir: string; onSort: (f: keyof Row) => void }) {
  const active = sortBy === field;
  return (
    <button onClick={() => onSort(field)} className={cn(`col-span-${span} flex items-center gap-1 hover:text-foreground transition-colors`, active && "text-accent")}>
      {label}
      {active ? (sortDir === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />) : <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}
    </button>
  );
}

function CommandBlock({ label, text, muted }: { label: string; text: string; muted?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); };
  return (
    <div className={cn("rounded-lg border border-border bg-background overflow-hidden", muted && "opacity-80")}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card-hover">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase"><Terminal className="h-3 w-3" /> {label}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">{copied ? <><Check className="h-3 w-3 text-success" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}</button>
      </div>
      <pre className="p-3 text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto max-h-56">{text}</pre>
    </div>
  );
}
