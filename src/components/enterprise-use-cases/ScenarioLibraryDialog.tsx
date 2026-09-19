"use client";

import { useEffect, useState } from "react";
import {
  Library, Search, X, Loader2, Plus, CheckSquare, Square, FlaskConical, FileCode2, ShieldAlert, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LibrarySource = "" | "art" | "detection-pack" | "purplesharp";

interface LibraryItem {
  libraryId: string;
  source: "art" | "detection-pack" | "purplesharp";
  framework: "atomic" | "purplesharp" | "stratus" | "manual";
  refId: string;
  techniqueId: string;
  techniqueName?: string;
  displayName: string;
  description: string;
  executor?: string;
  command?: string;
  platforms?: string[];
  elevationRequired?: boolean;
  inputArguments?: Record<string, any>;
  rationale?: string;
  packId?: string;
  tactic?: string;
  requiresUrl?: boolean;
  requiresCommand?: boolean;
  requiredParams?: string[];
  testNumber?: number;
}

interface Props {
  packId: string;
  techniqueHints?: string[];        // pre-fill technique filter w/ the use case's mapped techniques
  onClose: () => void;
  onAdded: (count: number) => void;
}

const SOURCE_META: Record<Exclude<LibrarySource, "">, { label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  art:              { label: "Atomic Red Team",  Icon: FlaskConical, color: "border-accent/40 bg-accent/10 text-accent" },
  "detection-pack": { label: "Detection Packs",  Icon: ShieldAlert,  color: "border-success/40 bg-success/10 text-success" },
  purplesharp:      { label: "PurpleSharp",      Icon: FileCode2,    color: "border-warning/40 bg-warning/10 text-warning" },
};

function itemToStep(it: LibraryItem) {
  if (it.source === "art") {
    return {
      framework: "atomic",
      refId: it.refId,
      techniqueId: it.techniqueId,
      displayName: it.displayName.slice(0, 200),
      parameters: {
        testGuid: it.refId,
        executor: it.executor,
        elevation: it.elevationRequired,
        inputArguments: it.inputArguments || {},
      },
      expectedSignal: "",
      notes: `From ART library · technique ${it.techniqueName || it.techniqueId}`,
    };
  }
  if (it.source === "purplesharp") {
    return {
      framework: "purplesharp",
      refId: it.refId,
      techniqueId: it.techniqueId,
      displayName: it.displayName.slice(0, 200),
      parameters: {
        variationRowId: it.refId,
        requiredParams: it.requiredParams || [],
      },
      expectedSignal: "",
      notes: `From PurpleSharp library · ${it.tactic || ""}`,
    };
  }
  // detection-pack
  return {
    framework: it.framework === "manual" ? "manual" : it.framework,
    refId: it.refId,
    techniqueId: it.techniqueId,
    displayName: it.displayName.slice(0, 200),
    parameters: {},
    expectedSignal: "",
    notes: it.rationale || "From Detection Pack library",
  };
}

export default function ScenarioLibraryDialog({ packId, techniqueHints, onClose, onAdded }: Props) {
  const [tab, setTab] = useState<Exclude<LibrarySource, "">>("art");
  const [q, setQ] = useState("");
  const [technique, setTechnique] = useState<string>(techniqueHints?.[0] || "");
  const [platform, setPlatform] = useState<string>("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [makeNewScenario, setMakeNewScenario] = useState(true);
  const [newScenarioName, setNewScenarioName] = useState("Library picks");
  const [existingScenarios, setExistingScenarios] = useState<Array<{ id: string; ordinal: number; name: string }>>([]);
  const [appendToScenarioId, setAppendToScenarioId] = useState<string>("");

  // Load existing scenarios for the "append to" option
  useEffect(() => {
    fetch(`/api/enterprise-use-cases/${packId}/scenarios`)
      .then((r) => r.json())
      .then((d) => setExistingScenarios(d.items || []))
      .catch(() => setExistingScenarios([]));
  }, [packId]);

  useEffect(() => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (tab) params.set("source", tab);
    if (q) params.set("q", q);
    if (technique) params.set("technique", technique);
    if (platform) params.set("platform", platform);
    params.set("limit", "60");
    const t = setTimeout(() => {
      fetch(`/api/scenario-library?${params}`)
        .then((r) => r.json())
        .then((d) => { setItems(d.items || []); setCounts(d.counts || {}); })
        .catch((err) => setError(err?.message || "load failed"))
        .finally(() => setLoading(false));
    }, 220);                                  // debounce search input
    return () => clearTimeout(t);
  }, [tab, q, technique, platform]);

  const toggleSel = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };
  const clearSel = () => setSelected(new Set());
  const selectVisible = () => setSelected(new Set([...selected, ...items.map((i) => i.libraryId)]));

  const add = async () => {
    if (selected.size === 0) return;
    setAdding(true); setError(null);
    try {
      const picks = items.filter((i) => selected.has(i.libraryId));
      const steps = picks.map(itemToStep);

      let scenarioId = appendToScenarioId;
      if (makeNewScenario || !scenarioId) {
        // Create a new scenario with these steps
        const r = await fetch(`/api/enterprise-use-cases/${packId}/scenarios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newScenarioName.trim() || "Library picks",
            description: `${picks.length} simulation(s) added from the library on ${new Date().toISOString().slice(0, 10)}.`,
            steps,
          }),
        });
        const d = await r.json();
        if (!r.ok) { setError(d.error || "add failed"); return; }
        scenarioId = d.id;
      } else {
        // Fetch existing scenario, append steps, PATCH
        const cur = await fetch(`/api/enterprise-use-cases/${packId}/scenarios`).then((r) => r.json());
        const target = (cur.items || []).find((s: any) => s.id === scenarioId);
        if (!target) { setError("target scenario not found"); return; }
        const merged = [...(target.steps || []), ...steps].slice(0, 30);
        const r = await fetch(`/api/enterprise-use-cases/${packId}/scenarios/${scenarioId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: merged }),
        });
        if (!r.ok) { const d = await r.json(); setError(d.error || "append failed"); return; }
      }
      onAdded(picks.length);
    } catch (err: any) {
      setError(err?.message || "add failed");
    } finally { setAdding(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Library className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Scenario library</h2>
          <span className="text-[10px] text-muted-foreground">Browse + add simulations from ART, Detection Packs, or PurpleSharp</span>
          <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 border-b border-danger/30 bg-danger/10 text-xs text-danger inline-flex items-center gap-2 w-full">
            {error}
          </div>
        )}

        <div className="px-5 py-2 border-b border-border flex items-center gap-1 overflow-x-auto">
          {(["art", "detection-pack", "purplesharp"] as const).map((s) => {
            const m = SOURCE_META[s];
            const count = counts[s] || 0;
            return (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px whitespace-nowrap",
                  tab === s ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <m.Icon className="h-3.5 w-3.5" />
                {m.label}
                <span className={cn("font-mono px-1.5 rounded text-[10px]",
                  tab === s ? "bg-accent/15 text-accent" : "bg-muted/15 text-muted-foreground",
                )}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-2 border-b border-border flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / description / command…"
              className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <select value={technique} onChange={(e) => setTechnique(e.target.value)} className="text-xs rounded-md border border-border bg-input text-foreground px-2 py-1.5 focus:outline-none focus:border-accent font-mono">
            <option value="">All techniques</option>
            {[...new Set([...(techniqueHints || []), "T1003.001", "T1140", "T1059.001", "T1218.011", "T1505.003", "T1136.003"])].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {tab === "art" && (
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="text-xs rounded-md border border-border bg-input text-foreground px-2 py-1.5 focus:outline-none focus:border-accent">
              <option value="">All platforms</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="macos">macOS</option>
            </select>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {selected.size} selected
            {selected.size > 0 && <button onClick={clearSel} className="ml-2 text-accent hover:underline">clear</button>}
            <button onClick={selectVisible} className="ml-2 text-accent hover:underline">select all visible</button>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No results. Try a different technique or search term.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((it) => {
                const isSel = selected.has(it.libraryId);
                const meta = SOURCE_META[it.source];
                return (
                  <button
                    key={it.libraryId}
                    onClick={() => toggleSel(it.libraryId)}
                    className={cn(
                      "w-full text-left px-5 py-2.5 flex items-start gap-2 hover:bg-card-hover transition-colors",
                      isSel && "bg-accent/5",
                    )}
                  >
                    {isSel ? <CheckSquare className="h-3.5 w-3.5 text-accent mt-0.5" /> : <Square className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border", meta.color)}>{meta.label}</span>
                        <span className="font-mono text-[10px] text-accent">{it.techniqueId}</span>
                        <span className="text-xs font-semibold text-foreground truncate">{it.displayName}</span>
                        {it.executor && <span className="font-mono text-[9px] text-muted-foreground">{it.executor}</span>}
                        {it.platforms && it.platforms.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">platforms: <span className="font-mono">{it.platforms.join(", ")}</span></span>
                        )}
                        {it.elevationRequired && <span className="text-[9px] uppercase font-bold text-warning">elevated</span>}
                      </div>
                      {it.description && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{it.description}</div>}
                      {it.command && (
                        <pre className="mt-1 text-[10px] font-mono text-foreground bg-background/40 rounded px-2 py-1 max-h-16 overflow-hidden whitespace-pre-wrap break-words border border-border">
{it.command.slice(0, 200)}{it.command.length > 200 ? "…" : ""}
                        </pre>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 space-y-2 bg-background/40">
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" checked={makeNewScenario} onChange={() => setMakeNewScenario(true)} className="accent-accent" />
              Create new scenario
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" checked={!makeNewScenario} onChange={() => setMakeNewScenario(false)} className="accent-accent" disabled={existingScenarios.length === 0} />
              Append to existing
            </label>
            {makeNewScenario ? (
              <input
                type="text" value={newScenarioName} onChange={(e) => setNewScenarioName(e.target.value)}
                placeholder="Scenario name" className="flex-1 px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              />
            ) : (
              <select value={appendToScenarioId} onChange={(e) => setAppendToScenarioId(e.target.value)} className="flex-1 text-xs rounded border border-border bg-input text-foreground px-2 py-1 focus:outline-none focus:border-accent">
                <option value="">(choose…)</option>
                {existingScenarios.map((s) => (
                  <option key={s.id} value={s.id}>#{String(s.ordinal).padStart(2, "0")} {s.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">Cancel</button>
            <button
              onClick={add}
              disabled={selected.size === 0 || adding || (!makeNewScenario && !appendToScenarioId)}
              className="inline-flex items-center gap-1.5 text-xs h-8 px-4 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add {selected.size} as step{selected.size === 1 ? "" : "s"} <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
