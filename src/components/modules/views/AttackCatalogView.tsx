"use client";

/**
 * Built-in module view for the hybrid attack libraries (Container & Orchestration,
 * Cloud, Active Directory, Hacktools). Faceted by `domain` → tactic group →
 * ATT&CK technique → the REAL Atomic Red Team tests (with the exact command the
 * Campaign Designer will execute). The analyst ticks the tests they want and
 * "Open in Campaign Designer", which hands the selection into the Designer's
 * normal technique flow (Step 2) where the environment is chosen and the run
 * happens — identical to every other simulation path. Techniques with no atomic
 * in the local library are shown for coverage but are not selectable.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Crosshair, Boxes, Layers, ChevronDown, ChevronRight, ArrowRight, ShieldAlert, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformBadges } from "@/components/shared/PlatformBadge";

interface Tech { id: string; name: string; tactic?: string }
interface Group { name: string; domain?: string; description?: string; techniques: Tech[] }
interface Atomic {
  id: string; techniqueId: string; requestedId: string; techniqueName: string;
  testNumber: number; testName: string; executor: string; platforms: string[];
  command: string; cleanupCommand: string; elevationRequired: boolean; tactic: string; description: string;
}

export default function AttackCatalogView({ moduleId }: { moduleId: string; sub: string[] }) {
  const router = useRouter();
  const [mod, setMod] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState<string>("");
  const [atomicsByTech, setAtomicsByTech] = useState<Record<string, Atomic[]>>({});
  const [resolving, setResolving] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openTech, setOpenTech] = useState<Set<string>>(new Set());
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const d = await fetch(`/api/modules/${moduleId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setMod(d); setLoading(false);
    })();
  }, [moduleId]);

  const catalog: Group[] = mod?.manifest?.contributes?.catalog || [];
  const domains = useMemo(() => {
    const seen: string[] = [];
    for (const g of catalog) { const dmn = g.domain || "General"; if (!seen.includes(dmn)) seen.push(dmn); }
    return seen;
  }, [catalog]);
  useEffect(() => { if (domains.length && !domain) setDomain(domains[0]); }, [domains, domain]);

  const groups = useMemo(() => catalog.filter((g) => (g.domain || "General") === domain), [catalog, domain]);

  // Resolve the real atomic tests for every technique in the active domain.
  useEffect(() => {
    if (!domain || !groups.length) return;
    const ids = [...new Set(groups.flatMap((g) => g.techniques.map((t) => t.id)))];
    if (!ids.length) return;
    setResolving(true);
    (async () => {
      const d = await fetch(`/api/attack/atomics?techniques=${ids.join(",")}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
      const map: Record<string, Atomic[]> = {};
      for (const a of (d.items || []) as Atomic[]) (map[a.requestedId] ||= []).push(a);
      setAtomicsByTech(map); setResolving(false);
    })();
  }, [domain, groups]);

  const atomicById = useMemo(() => {
    const m = new Map<string, Atomic>();
    for (const list of Object.values(atomicsByTech)) for (const a of list) m.set(a.id, a);
    return m;
  }, [atomicsByTech]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleTechOpen = (key: string) => setOpenTech((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const pickMany = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); for (const id of ids) on ? n.add(id) : n.delete(id); return n; });

  const openInDesigner = () => {
    const sel = [...picked].map((id) => atomicById.get(id)).filter(Boolean) as Atomic[];
    if (!sel.length) return;
    const techniques = [...new Set(sel.map((a) => a.techniqueId))];
    // `tests` = first picked test per technique (preview/default); `testLists` =
    // every picked test per technique so the Designer runs all of them.
    const tests: Record<string, number> = {};
    const testLists: Record<string, number[]> = {};
    for (const a of sel) {
      if (tests[a.techniqueId] == null) tests[a.techniqueId] = a.testNumber;
      (testLists[a.techniqueId] ||= []).push(a.testNumber);
    }
    try {
      sessionStorage.setItem("attack.campaignHandoff", JSON.stringify({ techniques, tests, testLists, label: `${mod?.name} · ${domain}`, source: moduleId }));
    } catch { /* ignore */ }
    router.push("/campaign-designer");
  };

  if (loading) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!mod || mod.error) return <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Module not found.</div>;

  const totalTechniques = catalog.reduce((n, g) => n + g.techniques.length, 0);
  const runnableInDomain = Object.values(atomicsByTech).reduce((n, l) => n + l.length, 0);

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Boxes className="h-6 w-6" /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{mod.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mod.description}</p>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">{mod.moduleId} · {mod.category} · {domains.length} domains · {totalTechniques} techniques</div>
        </div>
      </div>

      {/* Domain facet rail */}
      <div className="flex items-center gap-2 flex-wrap">
        <Layers className="h-4 w-4 text-accent" />
        {domains.map((dmn) => {
          const count = catalog.filter((g) => (g.domain || "General") === dmn).reduce((n, g) => n + g.techniques.length, 0);
          return (
            <button key={dmn} onClick={() => { setDomain(dmn); setAtomicsByTech({}); }}
              className={cn("inline-flex items-center gap-1.5 h-7 px-3 text-[12px] font-medium rounded-full border transition-colors",
                domain === dmn ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:text-foreground hover:border-accent/40")}>
              {dmn} <span className="text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
        <span className="text-[11px] text-muted-foreground ml-1">
          {resolving ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> resolving atomics…</span> : `${runnableInDomain} runnable atomic tests in ${domain}`}
        </span>
      </div>

      {/* Tactic groups → techniques → atomic tests */}
      <div className="space-y-4">
        {groups.map((g) => {
          const allIds = g.techniques.flatMap((t) => (atomicsByTech[t.id] || []).map((a) => a.id));
          const allOn = allIds.length > 0 && allIds.every((id) => picked.has(id));
          return (
            <div key={`${g.domain}:${g.name}`} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Crosshair className="h-4 w-4 text-accent shrink-0" />
                  <div className="text-sm font-semibold text-foreground">{g.name}</div>
                  <span className="text-[11px] text-muted-foreground truncate">{g.description}</span>
                </div>
                {allIds.length > 0 && (
                  <button onClick={() => pickMany(allIds, !allOn)} className="shrink-0 text-[11px] text-accent hover:underline">
                    {allOn ? "Clear" : `Select all (${allIds.length})`}
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {g.techniques.map((t) => {
                  const atoms = atomicsByTech[t.id] || [];
                  const key = `${g.domain}:${g.name}:${t.id}`;
                  const isOpen = openTech.has(key);
                  const pickedHere = atoms.filter((a) => picked.has(a.id)).length;
                  return (
                    <div key={key} className="rounded-lg border border-border/70 bg-background/40">
                      <button onClick={() => atoms.length && toggleTechOpen(key)} className={cn("w-full flex items-center gap-2 px-2.5 py-1.5 text-left", atoms.length ? "cursor-pointer" : "cursor-default opacity-70")}>
                        {atoms.length ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />) : <span className="w-3.5" />}
                        <span className="font-mono text-[11px] text-accent">{t.id}</span>
                        <span className="text-[12px] text-foreground truncate">{t.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                          {atoms.length ? <>{pickedHere ? <span className="text-accent font-semibold">{pickedHere}/</span> : null}{atoms.length} atomic{atoms.length > 1 ? "s" : ""}</> : "no atomic test"}
                        </span>
                      </button>
                      {isOpen && atoms.length > 0 && (
                        <div className="px-2.5 pb-2 space-y-1.5">
                          {atoms.map((a) => {
                            const on = picked.has(a.id);
                            const cmdOpen = expandedCmd === a.id;
                            return (
                              <div key={a.id} className={cn("rounded-md border p-2", on ? "border-accent/50 bg-accent/5" : "border-border bg-card")}>
                                <div className="flex items-start gap-2">
                                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="mt-0.5 accent-[#3b82f6]" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-[11px] font-medium text-foreground">#{a.testNumber} {a.testName}</span>
                                      <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border border-border text-muted-foreground">{a.executor || "manual"}</span>
                                      <PlatformBadges platforms={a.platforms} size="xs" max={3} />
                                      {a.elevationRequired && <span className="inline-flex items-center gap-0.5 text-[9px] text-warning"><ShieldAlert className="h-2.5 w-2.5" /> elevated</span>}
                                    </div>
                                    {a.command ? (
                                      <pre onClick={() => setExpandedCmd(cmdOpen ? null : a.id)} title="click to expand/collapse"
                                        className={cn("mt-1 cursor-pointer rounded bg-[#0b1020] text-[#c7d2fe] text-[10.5px] font-mono p-2 overflow-x-auto whitespace-pre-wrap break-all", !cmdOpen && "max-h-16 overflow-hidden")}>
                                        <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground"><Terminal className="h-2.5 w-2.5" /> command</span>{"\n"}{a.command}
                                      </pre>
                                    ) : <div className="mt-1 text-[10px] text-muted-foreground italic">manual test — no inline command</div>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky action bar → Campaign Designer */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 backdrop-blur px-4 py-2 shadow-lg">
          <span className="text-xs text-muted-foreground">{picked.size} atomic test{picked.size === 1 ? "" : "s"} selected</span>
          {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">clear</button>}
          <button onClick={openInDesigner} disabled={picked.size === 0}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-40">
            Open in Campaign Designer <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Commands are the real Atomic Red Team tests from the local library; select the ones to run and the Campaign Designer handles the target environment, execution and detection scoring. Authorized, isolated-lab use only.
      </p>
    </div>
  );
}
