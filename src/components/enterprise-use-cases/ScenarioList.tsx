"use client";

import { useEffect, useState } from "react";
import {
  ListChecks, Wand2, Plus, Loader2, Edit2, Trash2, FlaskConical, FileCode2, Cloud,
  Terminal, Cpu, Network, GitBranch, AlertTriangle, RefreshCw, ChevronRight, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ScenarioEditor from "./ScenarioEditor";
import ScenarioLibraryDialog from "./ScenarioLibraryDialog";
import type { Step, Framework } from "./StepCard";

interface Scenario {
  id: string;
  ordinal: number;
  name: string;
  description: string;
  steps: Step[];
  source: string;
  createdAt?: string;
  updatedAt?: string;
}

const FRAMEWORK_META: Record<Framework, { label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  atomic:        { label: "ART",         Icon: FlaskConical, color: "border-accent/40 bg-accent/10 text-accent" },
  purplesharp:   { label: "PurpleSharp", Icon: FileCode2,    color: "border-purple/40 bg-purple/10 text-purple" },
  stratus:       { label: "Stratus",     Icon: Cloud,        color: "border-info/40 bg-info/10 text-info" },
  manual:        { label: "Manual",      Icon: Terminal,     color: "border-muted/40 bg-muted/10 text-muted-foreground" },
  "reverse-shell": { label: "Reverse",   Icon: GitBranch,    color: "border-warning/40 bg-warning/10 text-warning" },
  "bind-shell":  { label: "Bind",        Icon: Network,      color: "border-warning/40 bg-warning/10 text-warning" },
  agent:         { label: "Agent",       Icon: Cpu,          color: "border-info/40 bg-info/10 text-info" },
};

interface Props {
  packId: string;
  techniques: string[];
  onCountChange?: (n: number) => void;
}

export default function ScenarioList({ packId, techniques, onCountChange }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoReplace, setAutoReplace] = useState(false);
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [creating, setCreating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/scenarios`);
      const data = await r.json();
      if (!r.ok) { setError(data.error || "load failed"); return; }
      const items = (data.items || []) as Scenario[];
      setScenarios(items);
      onCountChange?.(items.length);
    } catch (err: any) {
      setError(err?.message || "load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId]);

  const autoSuggest = async () => {
    if (autoReplace && !confirm("Replace all existing auto-suggested scenarios? (Manual edits are preserved.)")) return;
    setAutoBusy(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/scenarios/auto-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceExisting: autoReplace }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "auto-suggest failed"); return; }
      await load();
    } catch (err: any) {
      setError(err?.message || "auto-suggest failed");
    } finally { setAutoBusy(false); }
  };

  const remove = async (sid: string) => {
    if (!confirm("Delete this scenario?")) return;
    const r = await fetch(`/api/enterprise-use-cases/${packId}/scenarios/${sid}`, { method: "DELETE" });
    if (r.ok) await load();
  };

  const toggle = (sid: string) => {
    const next = new Set(expanded);
    if (next.has(sid)) next.delete(sid); else next.add(sid);
    setExpanded(next);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
        <ListChecks className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Attack scenarios</h3>
        <span className="text-[10px] text-muted-foreground">
          {scenarios.length} defined · techniques: {techniques.length ? techniques.slice(0, 4).join(", ") : "none mapped"}{techniques.length > 4 ? ` +${techniques.length - 4}` : ""}
        </span>
        <div className="ml-auto inline-flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={autoReplace} onChange={(e) => setAutoReplace(e.target.checked)} className="accent-accent" />
            replace existing auto
          </label>
          <button
            onClick={autoSuggest}
            disabled={autoBusy || techniques.length === 0}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium rounded border border-info/40 text-info hover:bg-info/10 disabled:opacity-50"
            title={techniques.length === 0 ? "No MITRE techniques mapped — auto-suggest needs at least one technique" : "Auto-suggest scenarios from ART / PurpleSharp / Stratus catalogues"}
          >
            {autoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Auto-suggest
          </button>
          <button
            onClick={() => { setLibraryOpen(true); setCreating(false); setEditing(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium rounded border border-accent/40 text-accent hover:bg-accent/10"
            title="Browse ART, Detection Packs, and PurpleSharp catalogues"
          >
            <Plus className="h-3 w-3" /> From library
          </button>
          <button
            onClick={() => { setCreating(true); setEditing(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium rounded bg-accent text-white hover:bg-[#60a5fa]"
          >
            <Plus className="h-3 w-3" /> Add scenario
          </button>
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {creating && (
        <ScenarioEditor
          packId={packId}
          scenario={{ ordinal: scenarios.length + 1, name: "", description: "", steps: [] }}
          onSaved={() => { setCreating(false); load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {editing && (
        <ScenarioEditor
          packId={packId}
          scenario={editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {libraryOpen && (
        <ScenarioLibraryDialog
          packId={packId}
          techniqueHints={techniques}
          onClose={() => setLibraryOpen(false)}
          onAdded={() => { setLibraryOpen(false); load(); }}
        />
      )}

      {loading && scenarios.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : scenarios.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <ListChecks className="h-7 w-7 mx-auto mb-2 text-accent opacity-70" />
          <h3 className="text-sm font-semibold text-foreground">No scenarios yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Click <span className="font-mono">Auto-suggest</span> to build 1-4 scenario drafts from this use case's techniques, or
            <span className="font-mono"> Add scenario</span> to author one manually. Phase 3 will run these against environments.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.map((s) => {
            const isOpen = expanded.has(s.id);
            const stepBuckets = new Map<Framework, number>();
            for (const st of s.steps) stepBuckets.set(st.framework, (stepBuckets.get(st.framework) || 0) + 1);
            return (
              <div key={s.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-3 py-2.5 flex items-start gap-2">
                  <button onClick={() => toggle(s.id)} className="mt-0.5">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">#{String(s.ordinal).padStart(2, "0")}</span>
                      <span className="text-sm font-semibold text-foreground">{s.name}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[9px] uppercase font-bold border",
                        s.source === "auto" ? "border-info/40 bg-info/10 text-info"
                        : s.source === "manual-edit" ? "border-success/40 bg-success/10 text-success"
                        : "border-warning/40 bg-warning/10 text-warning",
                      )}>{s.source}</span>
                    </div>
                    {s.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{s.description}</p>}
                    {s.steps.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        {[...stepBuckets.entries()].map(([fw, n]) => {
                          const m = FRAMEWORK_META[fw] || FRAMEWORK_META.manual;
                          return (
                            <span key={fw} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", m.color)}>
                              <m.Icon className="h-2.5 w-2.5" />
                              {m.label} × {n}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditing(s); setCreating(false); }} className="inline-flex items-center gap-1 text-[11px] h-6 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
                      <Edit2 className="h-2.5 w-2.5" /> Edit
                    </button>
                    <button onClick={() => remove(s.id)} className="inline-flex items-center gap-1 text-[11px] h-6 px-2 rounded text-danger hover:bg-danger/10">
                      <Trash2 className="h-2.5 w-2.5" /> Delete
                    </button>
                  </div>
                </div>
                {isOpen && s.steps.length > 0 && (
                  <div className="px-4 py-2 border-t border-border bg-background/30 space-y-1">
                    {s.steps.map((st, i) => {
                      const m = FRAMEWORK_META[st.framework] || FRAMEWORK_META.manual;
                      return (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className="font-mono text-[9px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase", m.color)}>
                            <m.Icon className="h-2.5 w-2.5" /> {m.label}
                          </span>
                          {st.techniqueId && <span className="font-mono text-[10px] text-accent">{st.techniqueId}</span>}
                          <span className="text-foreground truncate flex-1">{st.displayName}</span>
                          {st.expectedSignal && <span className="text-[10px] text-muted-foreground truncate">signal: {st.expectedSignal}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
