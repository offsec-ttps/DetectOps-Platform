"use client";

/**
 * Built-in module view: a curated ATT&CK technique catalogue + "Simulate".
 * Used by category modules that aren't gang-centric (LOTL, Phishing, …). Reads
 * `manifest.contributes.catalog` (technique groups) and runs a chosen group via
 * the generic /api/simulations/run bridge (techniques → atomic tests → runner).
 */

import { useEffect, useState } from "react";
import {
  Crosshair, Loader2, Play, Server, CheckCircle2, XCircle, AlertTriangle, Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function TechniqueCatalogView({ moduleId }: { moduleId: string; sub: string[] }) {
  const [mod, setMod] = useState<any>(null);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [envId, setEnvId] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const [d, ev] = await Promise.all([
        fetch(`/api/modules/${moduleId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/environment-targets`).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
      ]);
      setMod(d); setEnvs(ev?.items || ev?.environments || []); setLoading(false);
    })();
  }, [moduleId]);

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

      {catalog.length === 0 && <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">This module has no technique catalogue yet.</div>}

      {/* shared environment picker */}
      {catalog.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Target:</span>
          <select value={envId} onChange={(e) => setEnvId(e.target.value)} className="flex-1 min-w-[220px] h-8 px-2 text-xs rounded border border-border bg-input text-foreground">
            <option value="">Select environment…</option>
            {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}
          </select>
        </div>
      )}

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
  );
}
