"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, X, Package, ShieldAlert, CheckCircle2, AlertTriangle, Download } from "lucide-react";

interface Dep { description: string; klass: "auto" | "manual" }
interface PrereqItem { tech: string; num: number; testName: string; deps: Dep[]; klass: "auto" | "manual" }
interface StageResult { tech: string; num: number; status: string; tail: string }

interface Props {
  /** Technique IDs about to be simulated (e.g. ["T1046","T1003.001"]). */
  techniques: string[];
  /** Platform to gate tests by. Defaults to "windows". */
  platform?: string;
  /** EnvironmentTarget id to install onto; null disables auto-install. */
  environmentId: string | null;
  /** Proceed to launch (after staging, or on skip). */
  onProceed: () => void;
  /** Dismiss without launching. */
  onCancel: () => void;
}

const key = (i: { tech: string; num: number }) => `${i.tech}#${i.num}`;

/**
 * Pre-launch dependency chooser. Before a simulation runs, it previews the
 * external tool prerequisites the selected techniques declare and lets the user
 * pick which to install (auto-installable ones are pre-ticked; licensed/manual
 * ones are flagged and cannot be ticked). On confirm it stages the selected
 * prerequisites via /api/atomic-prereqs, then proceeds to launch. "Skip" launches
 * without installing anything.
 */
export default function DependencyPrompt({ techniques, platform = "windows", environmentId, onProceed, onCancel }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PrereqItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [staging, setStaging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<StageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/atomic-prereqs/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ techniques, platform }),
        });
        const data = await res.json();
        if (cancelled) return;
        const list: PrereqItem[] = data.items || [];
        setItems(list);
        // Pre-tick auto-installable items.
        const init: Record<string, boolean> = {};
        for (const i of list) init[key(i)] = i.klass === "auto";
        setChecked(init);
        // Nothing declares a dependency → proceed straight to launch.
        if (list.length === 0) onProceed();
      } catch {
        if (!cancelled) setError("Could not load dependency info.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = items.filter((i) => checked[key(i)] && i.klass === "auto");

  const installAndLaunch = useCallback(async () => {
    if (!environmentId || selected.length === 0) { onProceed(); return; }
    setStaging(true); setError(null);
    const all: StageResult[] = [];
    const chunks: PrereqItem[][] = [];
    for (let i = 0; i < selected.length; i += 25) chunks.push(selected.slice(i, i + 25));
    setProgress({ done: 0, total: selected.length });
    try {
      for (const chunk of chunks) {
        const res = await fetch("/api/atomic-prereqs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            environmentId,
            techniques: chunk.map((c) => ({ tech: c.tech, num: c.num })),
            budgetSec: 150,
          }),
        });
        if (!res.ok) { throw new Error((await res.json().catch(() => ({}))).error || `stage error ${res.status}`); }
        const data = await res.json();
        for (const r of data.results || []) all.push(r);
        setProgress({ done: all.length, total: selected.length });
      }
      setResults(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Staging failed.");
    } finally {
      setStaging(false);
    }
  }, [environmentId, selected, onProceed]);

  const staged = results
    ? { ok: results.filter((r) => r.status === "satisfied").length, miss: results.filter((r) => r.status !== "satisfied").length }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Package className="h-4 w-4 text-accent" /> Install dependencies before simulating
          </p>
          <button onClick={onCancel} className="text-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking what these use cases need…
            </div>
          ) : results ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Staged {staged?.ok}/{results.length} — {staged?.miss ? `${staged.miss} still unmet` : "all satisfied"}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {results.map((r) => (
                  <div key={key(r)} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                    <span className="font-mono text-foreground">{r.tech} #{r.num}</span>
                    <span className={r.status === "satisfied" ? "text-success" : "text-warning"}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {items.length} selected use case{items.length !== 1 ? "s" : ""} declare external tool dependencies.
                Tick the ones to download/install onto the target now; untick to skip (that use case still runs, but
                may report its prerequisites as unmet).
              </p>
              {!environmentId && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-start gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  No installable WinRM environment resolved for this target — dependencies can&apos;t be auto-installed. You can still skip and launch.
                </div>
              )}
              <div className="space-y-1.5">
                {items.map((i) => {
                  const k = key(i);
                  const manual = i.klass === "manual";
                  return (
                    <label key={k} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${manual ? "border-border bg-card/40 cursor-default" : "border-border bg-card/60 cursor-pointer hover:border-accent/40"}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-accent"
                        disabled={manual || !environmentId}
                        checked={!!checked[k] && !manual}
                        onChange={(e) => setChecked((p) => ({ ...p, [k]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-accent">{i.tech} #{i.num}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{i.testName}</span>
                          {manual && (
                            <span className="ml-auto inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                              <AlertTriangle className="h-3 w-3" /> manual
                            </span>
                          )}
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {i.deps.map((d, idx) => (
                            <li key={idx} className="text-[10.5px] text-muted leading-snug">• {d.description}</li>
                          ))}
                        </ul>
                        {manual && (
                          <p className="mt-1 text-[10px] text-warning/80">Licensed/interactive — provision by hand (see the dependency punch-list).</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {error && <p className="text-[11px] text-danger">{error}</p>}
          {staging && progress && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing… {progress.done}/{progress.total}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {results ? (
            <button onClick={onProceed} className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent/90">
              Continue to launch
            </button>
          ) : (
            <>
              <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card-hover">Cancel</button>
              <button onClick={onProceed} disabled={staging} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-card-hover disabled:opacity-50">
                Skip &amp; launch
              </button>
              <button
                onClick={installAndLaunch}
                disabled={staging || loading || !environmentId || selected.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-40"
              >
                {staging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Install {selected.length > 0 ? `${selected.length} ` : ""}&amp; launch
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
