"use client";

/**
 * Built-in view for the Attack Technique Libraries (ClickFix / Deceptive Delivery
 * & Execution, …). Dashboard-consistent with the other simulations: stat cards +
 * filters (category · platform · search) + a GRID of technique cards. Each card
 * shows what-it-is, how-it's-abused, platform tags, severity and ATT&CK. Opening a
 * card shows the kill-chain, lab-setup resources, and three tabs:
 *   • Simulate — the CURATED, directly-relevant Atomic Red Team tests (with a
 *     "why each is included" rationale) → Campaign Designer run + detection scoring.
 *   • Detect — curated detection summary, data sources, copyable Sigma/SPL.
 *   • Mitigate — attack-surface-reduction / hardening steps + references.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Crosshair, ShieldAlert, Target, Eye, Terminal, ArrowRight, ChevronLeft,
  ExternalLink, Copy, Check, Wrench, BookOpen, Link2, Skull, FlaskConical, Layers, AlertTriangle, Server, Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformBadge, PlatformBadges, canonicalPlatforms } from "@/components/shared/PlatformBadge";

interface DetectionQuery { format: string; title: string; query: string }
interface Mitigation { title: string; detail: string; kind: string; mitreId?: string }
interface Reference { title: string; url: string }
interface Technique {
  key: string; name: string; category: string; variant?: string; description: string;
  summary: string; abuse: string; labSetup: string[];
  attackTechniques: string[]; tactic: string; platforms: string[]; severity: string;
  chainNarrative: string[]; atomics: Array<{ techniqueId: string; why: string }>; simulateNote?: string; runnableOnSar: boolean;
  detection: { summary: string; dataSources: string[]; queries: DetectionQuery[] };
  mitigations: Mitigation[]; references: Reference[];
  origin?: "curated" | "ti-watcher"; sourceRef?: { url?: string; vendor?: string; reportId: string }; contributionId?: string;
}
interface Atomic { id: string; techniqueId: string; testNumber: number; testName: string; executor: string; platforms: string[]; elevationRequired: boolean; why: string }

const SEV_TONE: Record<string, string> = {
  critical: "border-danger/40 bg-danger/10 text-danger", high: "border-danger/40 bg-danger/10 text-danger",
  medium: "border-warning/40 bg-warning/10 text-warning", low: "border-success/40 bg-success/10 text-success",
};
const MIT_TONE: Record<string, string> = {
  gpo: "border-accent/40 text-accent", asr: "border-purple/40 text-purple", config: "border-accent/40 text-accent",
  network: "border-info/40 text-info", awareness: "border-warning/40 text-warning", edr: "border-purple/40 text-purple", allowlist: "border-success/40 text-success",
};

export default function AttackSimLibraryView({ moduleId }: { moduleId: string; sub: string[] }) {
  const router = useRouter();
  const [lib, setLib] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [platform, setPlatform] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/attack-sim/libraries?module=${encodeURIComponent(moduleId)}`)
      .then((r) => (r.ok ? r.json() : null)).then((d) => setLib(d?.library || null)).catch(() => {}).finally(() => setLoading(false));
  }, [moduleId]);

  const techniques: Technique[] = lib?.techniques || [];
  const categories = useMemo(() => ["all", ...[...new Set(techniques.map((t) => t.category))]], [techniques]);
  const allPlatforms = useMemo(() => canonicalPlatforms(techniques.flatMap((t) => t.platforms)), [techniques]);

  const shown = useMemo(() => techniques.filter((t) =>
    (category === "all" || t.category === category) &&
    (!platform || canonicalPlatforms(t.platforms).includes(platform)) &&
    (!q || `${t.name} ${t.summary} ${t.abuse} ${t.attackTechniques.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  ), [techniques, category, platform, q]);

  if (loading) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!lib) return <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Attack library not found.</div>;

  const selected = techniques.find((t) => t.key === sel) || null;
  if (selected) return <TechniqueDetail moduleId={moduleId} t={selected} onBack={() => setSel(null)} />;

  const runnable = techniques.filter((t) => t.runnableOnSar).length;
  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-danger/30 bg-danger/10 text-danger"><MousePointer /></span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{lib.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-3xl">{lib.description}</p>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Techniques", v: techniques.length },
          { l: "Simulatable", v: runnable },
          { l: "Categories", v: categories.length - 1 },
          { l: "Platforms", v: allPlatforms.length },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-bold text-foreground">{s.v}</div><div className="text-[11px] text-muted-foreground">{s.l}</div></div>
        ))}
      </div>

      {/* filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="h-4 w-4 text-accent" />
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cn("inline-flex items-center gap-1.5 h-7 px-3 text-[12px] font-medium rounded-full border transition-colors",
              category === c ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:text-foreground hover:border-accent/40")}>
              {c === "all" ? "All techniques" : c} <span className="text-[10px] opacity-70">{c === "all" ? techniques.length : techniques.filter((t) => t.category === c).length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Platform</span>
          {allPlatforms.map((p) => <PlatformBadge key={p} platform={p} active={platform === p} onClick={() => setPlatform(platform === p ? "" : p)} />)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search techniques…" className="ml-auto h-8 px-3 text-xs rounded-md border border-border bg-input text-foreground min-w-[180px]" />
        </div>
      </div>

      {/* grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map((t) => {
          const tone = t.severity === "high" || t.severity === "critical" ? "hover:border-danger/40" : "hover:border-accent/40";
          return (
            <button key={t.key} onClick={() => setSel(t.key)} className={cn("group text-left rounded-xl border border-border bg-card p-4 flex flex-col gap-2 hover:bg-card-hover transition-all", tone)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Crosshair className="h-4 w-4 text-accent shrink-0" />
                  <span className="text-sm font-semibold text-foreground">{t.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {t.origin === "ti-watcher" && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-purple/40 bg-purple/10 text-purple inline-flex items-center gap-1"><Radar className="h-2.5 w-2.5" /> TI</span>}
                  <span className={cn("text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full border", SEV_TONE[t.severity] || "border-border text-muted-foreground")}>{t.severity}</span>
                </div>
              </div>
              <PlatformBadges platforms={t.platforms} size="xs" />
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">What it is</div>
                <p className="text-[11px] text-foreground/90 line-clamp-2">{t.summary}</p>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1"><Skull className="h-2.5 w-2.5" /> How it's abused</div>
                <p className="text-[11px] text-muted-foreground line-clamp-3">{t.abuse}</p>
              </div>
              <div className="mt-auto flex items-center justify-between pt-1 text-[10px]">
                <span className="flex items-center gap-1">{t.attackTechniques.map((a) => <span key={a} className="font-mono px-1 py-0.5 rounded border border-accent/20 bg-accent/5 text-accent">{a}</span>)}</span>
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  {t.runnableOnSar ? <><FlaskConical className="h-3 w-3" /> {t.atomics.length} test set{t.atomics.length === 1 ? "" : "s"}</> : <span className="px-1.5 py-0.5 rounded-full border border-border">reference</span>}
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </span>
              </div>
            </button>
          );
        })}
        {shown.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-xs text-muted-foreground">No techniques match this filter.</div>}
      </div>
      <p className="text-[11px] text-muted-foreground">Simulation runs the platform's vetted, directly-relevant Atomic Red Team tests on the SAR lab via the Campaign Designer (execution + detection scoring). Authorized, isolated-lab use only. Lure hosting / payload delivery is operator-driven and not provisioned here.</p>
    </div>
  );
}

// ─── Technique detail ─────────────────────────────────────────────────────────
function TechniqueDetail({ moduleId, t, onBack }: { moduleId: string; t: Technique; onBack: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"simulate" | "detect" | "mitigate">("simulate");
  const [atoms, setAtoms] = useState<Atomic[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!t.runnableOnSar) { setAtoms([]); return; }
    fetch(`/api/attack-sim/atomics?module=${encodeURIComponent(moduleId)}&technique=${encodeURIComponent(t.key)}`)
      .then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setAtoms(d.items || [])).catch(() => setAtoms([]));
  }, [moduleId, t.key, t.runnableOnSar]);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openInDesigner = () => {
    const sel = (atoms || []).filter((a) => picked.has(a.id));
    if (!sel.length) return;
    const tids = [...new Set(sel.map((a) => a.techniqueId))];
    const tests: Record<string, number> = {};
    const testLists: Record<string, number[]> = {};
    for (const a of sel) {
      if (tests[a.techniqueId] == null) tests[a.techniqueId] = a.testNumber;
      (testLists[a.techniqueId] ||= []).push(a.testNumber);
    }
    try { sessionStorage.setItem("attack.campaignHandoff", JSON.stringify({ techniques: tids, tests, testLists, label: `ClickFix · ${t.name}`, source: moduleId })); } catch { /* ignore */ }
    router.push("/campaign-designer");
  };
  const copy = (id: string, text: string) => { try { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1200); } catch { /* ignore */ } };

  return (
    <div className="space-y-4 pb-24">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> All techniques</button>

      {/* header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2"><Crosshair className="h-5 w-5 text-accent" /><h1 className="text-xl font-bold text-foreground">{t.name}</h1>
            <span className={cn("text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full border", SEV_TONE[t.severity])}>{t.severity}</span>
          </div>
          <div className="flex items-center gap-1">{t.attackTechniques.map((a) => <a key={a} href={`https://attack.mitre.org/techniques/${a.replace(".", "/")}/`} target="_blank" rel="noreferrer" className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-accent/20 bg-accent/5 text-accent hover:underline">{a}</a>)}</div>
        </div>
        <div className="mt-2"><PlatformBadges platforms={t.platforms} /></div>
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-background/40 p-2.5"><div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">What it is</div><p className="text-[11px] text-foreground/90">{t.description}</p></div>
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-2.5"><div className="text-[10px] uppercase tracking-wide text-danger mb-1 inline-flex items-center gap-1"><Skull className="h-3 w-3" /> How bad actors misuse it</div><p className="text-[11px] text-muted-foreground">{t.abuse}</p></div>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-background/40 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 inline-flex items-center gap-1"><Target className="h-3 w-3" /> Attack chain</div>
          <ol className="space-y-1">{t.chainNarrative.map((s, i) => <li key={i} className="text-[11px] text-muted-foreground flex gap-2"><span className="text-accent font-mono shrink-0">{i + 1}.</span> {s}</li>)}</ol>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-background/40 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 inline-flex items-center gap-1"><Server className="h-3 w-3" /> Lab setup to replicate</div>
          <ul className="space-y-0.5">{t.labSetup.map((s, i) => <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5"><span className="text-accent">•</span> {s}</li>)}</ul>
        </div>
      </div>

      {/* tabs */}
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {([["simulate", "Simulate", Terminal], ["detect", "Detect", Eye], ["mitigate", "Mitigate", ShieldAlert]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium rounded-md", tab === k ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Icon className="h-3 w-3" /> {label}</button>
        ))}
      </div>

      {/* SIMULATE */}
      {tab === "simulate" && (
        <div className="space-y-2">
          {t.simulateNote && <p className="text-[11px] text-muted-foreground italic">{t.simulateNote}</p>}
          {!t.runnableOnSar ? (
            <div className="rounded-lg border border-dashed border-border bg-background/30 p-3 text-[11px] text-muted-foreground inline-flex items-start gap-2"><AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5" /> No directly-relevant Atomic Red Team test for this technique in the local library — catalogued for Detect & Mitigate. (We don't map unrelated tests to pad coverage.)</div>
          ) : atoms === null ? (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> resolving the relevant atomic tests…</div>
          ) : atoms.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/30 p-3 text-[11px] text-muted-foreground">The curated tests for this technique aren't in the local Atomic Test Library yet — sync it to enable Simulate.</div>
          ) : (
            <div className="space-y-1.5">
              {atoms.map((a) => {
                const on = picked.has(a.id);
                return (
                  <label key={a.id} className={cn("flex items-start gap-2 rounded-md border p-2 cursor-pointer", on ? "border-accent/50 bg-accent/5" : "border-border bg-background/40")}>
                    <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="mt-0.5 accent-[#3b82f6]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] text-accent">{a.techniqueId}</span>
                        <span className="text-[11px] font-medium text-foreground">#{a.testNumber} {a.testName}</span>
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-border text-muted-foreground">{a.executor || "manual"}</span>
                        <PlatformBadges platforms={a.platforms} size="xs" />
                        {a.elevationRequired && <span className="inline-flex items-center gap-0.5 text-[9px] text-warning"><ShieldAlert className="h-2.5 w-2.5" /> elevated</span>}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground"><span className="text-accent/80">Why:</span> {a.why}</p>
                    </div>
                  </label>
                );
              })}
              <p className="text-[10px] text-muted-foreground">Select tests, then run them through the Campaign Designer (target, execution & detection scoring) via the bar below.</p>
            </div>
          )}
        </div>
      )}

      {/* DETECT */}
      {tab === "detect" && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">{t.detection.summary}</p>
          {t.detection.dataSources.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center"><span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Data sources</span>
              {t.detection.dataSources.map((d) => <span key={d} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/10 text-muted-foreground">{d}</span>)}</div>
          )}
          {t.detection.queries.map((query, i) => {
            const id = `${t.key}:${i}`;
            return (
              <div key={id} className="rounded-lg border border-border bg-[#0b1020] overflow-hidden">
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/60">
                  <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5"><span className="uppercase font-semibold text-accent">{query.format}</span> {query.title}</span>
                  <button onClick={() => copy(id, query.query)} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">{copied === id ? <><Check className="h-3 w-3 text-success" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}</button>
                </div>
                <pre className="text-[10.5px] font-mono text-[#c7d2fe] p-2.5 overflow-x-auto whitespace-pre-wrap break-all">{query.query}</pre>
              </div>
            );
          })}
        </div>
      )}

      {/* MITIGATE */}
      {tab === "mitigate" && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1"><Wrench className="h-3 w-3" /> Reduce the attack surface</div>
          {t.mitigations.map((m, i) => (
            <div key={i} className="rounded-lg border border-border bg-background/40 p-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded-full border", MIT_TONE[m.kind] || "border-border text-muted-foreground")}>{m.kind}</span>
                <span className="text-[11px] font-medium text-foreground">{m.title}</span>
                {m.mitreId && <a href={`https://attack.mitre.org/mitigations/${m.mitreId}/`} target="_blank" rel="noreferrer" className="text-[9px] font-mono text-accent hover:underline">{m.mitreId}</a>}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{m.detail}</p>
            </div>
          ))}
          {t.references.length > 0 && (
            <div className="pt-1"><div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 inline-flex items-center gap-1"><BookOpen className="h-3 w-3" /> References</div>
              <div className="space-y-0.5">{t.references.map((r) => <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-accent hover:underline"><Link2 className="h-3 w-3 shrink-0" /> {r.title}</a>)}</div>
            </div>
          )}
        </div>
      )}

      {/* sticky run bar */}
      {t.runnableOnSar && (atoms?.length || 0) > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20">
          <div className="flex items-center gap-3 rounded-full border border-border bg-card/95 backdrop-blur px-4 py-2 shadow-lg">
            <span className="text-xs text-muted-foreground">{picked.size} atomic test{picked.size === 1 ? "" : "s"} selected</span>
            {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground">clear</button>}
            <button onClick={openInDesigner} disabled={picked.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-40">Open in Campaign Designer <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function MousePointer() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>;
}
