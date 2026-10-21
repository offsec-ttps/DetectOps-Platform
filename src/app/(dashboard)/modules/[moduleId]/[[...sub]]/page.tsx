"use client";

/**
 * Catch-all page for an installed simulation module. Modules ship DECLARATIVE
 * metadata (not React), so this single page renders any module's contributes:
 * its scenarios (with a Run control that goes through the existing runner),
 * permissions, and metadata.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Blocks, Loader2, Play, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, ChevronLeft, Server, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isBuiltinModuleView } from "@/lib/modules/views";
import RansomwareIntelView from "@/components/modules/views/RansomwareIntelView";
import TechniqueCatalogView from "@/components/modules/views/TechniqueCatalogView";
import PhishingSimulationView from "@/components/modules/views/PhishingSimulationView";
import AptCatalogView from "@/components/modules/views/AptCatalogView";
import AttackCatalogView from "@/components/modules/views/AttackCatalogView";
import AttackSimLibraryView from "@/components/modules/views/AttackSimLibraryView";

export default function ModulePage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = String(params.moduleId || "");
  const sub = Array.isArray(params.sub) ? params.sub.map(String) : params.sub ? [String(params.sub)] : [];
  const [mod, setMod] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<{ scenario: string; envId: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [d, sc, ev] = await Promise.all([
        fetch(`/api/modules/${moduleId}`).then((r) => r.ok ? r.json() : null),
        fetch(`/api/modules/${moduleId}/scenarios`).then((r) => r.ok ? r.json() : { scenarios: [] }).catch(() => ({ scenarios: [] })),
        fetch(`/api/environment-targets`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]);
      setMod(d);
      setScenarios(sc?.scenarios || (d?.manifest?.contributes?.scenarios ?? []));
      setEnvs(ev?.items || ev?.environments || []);
      setLoading(false);
    })();
  }, [moduleId]);

  const launch = async (scenarioName: string, environmentId: string) => {
    setRunning(true); setError(null); setResult(null);
    try {
      const r = await fetch(`/api/modules/${moduleId}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioName, environmentId, mode: "simulate-only" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "run failed"); return; }
      setResult(d);
    } finally { setRunning(false); }
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading module…</div>;
  if (!mod || mod.error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Marketplace</Link>
      <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Module "{moduleId}" not found or not live.</div>
    </div>
  );

  // If the module declares a built-in rich view, render it instead of the generic list.
  // The Back control goes to a DETERMINISTIC destination rather than router.back():
  // from a sub-page (e.g. a ransomware gang detail) it returns to the module
  // directory, and from the directory it returns to the Attack Simulations list.
  // (router.back() looped here because sub-views also push history via <Link>, so a
  // history-relative back oscillated between the detail page and the directory.)
  const viewId = mod?.manifest?.contributes?.view;
  if (isBuiltinModuleView(viewId)) {
    const inSubView = sub.length > 0;
    const backHref = inSubView ? `/modules/${moduleId}` : "/simulations";
    const backLabel = inSubView ? "Back" : "Back to Attack Simulations";
    const BackBar = (
      <button onClick={() => router.push(backHref)} className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> {backLabel}
      </button>
    );
    if (viewId === "ransomware-intel") return <div className="p-6 max-w-6xl mx-auto">{BackBar}<RansomwareIntelView moduleId={moduleId} sub={sub} /></div>;
    if (viewId === "technique-catalog") return <div className="p-6 max-w-6xl mx-auto">{BackBar}<TechniqueCatalogView moduleId={moduleId} sub={sub} /></div>;
    if (viewId === "phishing-sim") return <div className="p-6 max-w-6xl mx-auto">{BackBar}<PhishingSimulationView /></div>;
    if (viewId === "apt-catalog") return <div className="p-6 max-w-6xl mx-auto">{BackBar}<AptCatalogView moduleId={moduleId} sub={sub} /></div>;
    // attack-catalog is a full-width table (like the Atomic Test Library). The
    // shell's <main> already applies p-6, so this wrapper adds no padding/max-width
    // and the table uses the whole content area instead of a centered column.
    if (viewId === "attack-catalog") return <div>{BackBar}<AttackCatalogView moduleId={moduleId} sub={sub} /></div>;
    if (viewId === "attack-sim") return <div className="p-6 max-w-6xl mx-auto">{BackBar}<AttackSimLibraryView moduleId={moduleId} sub={sub} /></div>;
  }

  const perms = mod.permissions || {};
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Marketplace</Link>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Blocks className="h-6 w-6" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {mod.name}
            <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border border-success/30 bg-success/10 text-success">{mod.status}</span>
            {mod.signatureState === "verified" && <span className="inline-flex items-center gap-1 text-[10px] text-success"><ShieldCheck className="h-3 w-3" /> signed</span>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{mod.description}</p>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">{mod.moduleId} · v{mod.version} · {mod.category} · by {mod.author}</div>
        </div>
      </div>

      {/* Permissions */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold text-foreground mb-2">Declared capabilities</div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {(perms.frameworks || []).map((f: string) => <span key={f} className="px-2 py-0.5 rounded-md border border-border bg-muted/10 text-muted-foreground font-mono">framework: {f}</span>)}
          {(perms.integrations || []).map((f: string) => <span key={f} className="px-2 py-0.5 rounded-md border border-border bg-muted/10 text-muted-foreground font-mono">integration: {f}</span>)}
        </div>
      </div>

      {/* Scenarios */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><Zap className="h-4 w-4 text-accent" /> Scenarios</h2>
        {scenarios.length === 0 && <p className="text-xs text-muted-foreground">This module contributes no scenarios.</p>}
        {scenarios.map((sc: any) => (
          <div key={sc.name} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-foreground">{sc.name}</div>
                {sc.description && <div className="text-[11px] text-muted-foreground">{sc.description}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">{(sc.steps || []).length} step(s): {(sc.steps || []).map((s: any) => s.framework).join(", ")}</div>
              </div>
              <button onClick={() => setRun(run?.scenario === sc.name ? null : { scenario: sc.name, envId: envs[0]?.id || "" })}
                className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa]">
                <Play className="h-3 w-3" /> Run
              </button>
            </div>
            {run && run.scenario === sc.name && (
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <select value={run.envId} onChange={(e) => setRun({ ...run, scenario: run.scenario, envId: e.target.value })} className="flex-1 h-8 px-2 text-xs rounded border border-border bg-input text-foreground">
                  <option value="">Select environment…</option>
                  {envs.map((e: any) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}
                </select>
                <button onClick={() => launch(sc.name, run.envId)} disabled={!run.envId || running}
                  className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa] disabled:opacity-50">
                  {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Launch (simulate-only)
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger inline-flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> {error}</div>}
      {result && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="text-sm font-semibold text-foreground flex items-center gap-2">
            {result.status === "success" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />} Run {result.status} · {result.runId?.slice(0, 8)}
          </div>
          {(result.stepResults || []).map((s: any, i: number) => (
            <div key={i} className="text-[11px] font-mono text-muted-foreground">
              <span className={cn("uppercase font-bold", s.status === "ok" ? "text-success" : s.status === "stubbed" ? "text-warning" : "text-danger")}>{s.status}</span> · {s.framework} · {(s.notes || "").slice(0, 80)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
