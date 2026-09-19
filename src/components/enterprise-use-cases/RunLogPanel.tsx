"use client";

import { useEffect, useState } from "react";
import {
  Activity, Loader2, RefreshCw, FileText, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertTriangle, Clock, Cloud, FlaskConical, Cpu, Terminal, GitBranch, Network, FileCode2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CoverageBadge, { type CoverageOutcome } from "./CoverageBadge";

interface StepResult {
  stepIndex: number;
  framework: string;
  displayName: string;
  status: "ok" | "failure" | "stubbed" | "skipped";
  exitCode: number;
  durationMs: number;
  stdoutPreview: string;
  notes: string;
}

interface DetectionResult {
  ruleTitle?: string;
  siemBackend?: string;
  integrationName?: string;
  query?: string;
  fired?: boolean;
  evidence?: string;
  queriedAt?: string;
  error?: string;
}

interface RunRow {
  id: string;
  scenarioId: string | null;
  environmentId: string | null;
  environmentName?: string | null;
  environmentKind?: string | null;
  testedLogicChoice: string;
  mode: string;
  status: string;
  validationOutcome: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  exitCode: number | null;
  stepResults: StepResult[];
  hasLogs: boolean;
  detectionResults: DetectionResult[];
  actor: string;
  createdAt: string;
}

const FRAMEWORK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  atomic: FlaskConical, purplesharp: FileCode2, stratus: Cloud, manual: Terminal,
  "reverse-shell": GitBranch, "bind-shell": Network, agent: Cpu,
};

const STATUS_STYLE: Record<string, string> = {
  success: "bg-success/15 text-success border-success/40",
  failure: "bg-danger/15 text-danger border-danger/40",
  timeout: "bg-warning/15 text-warning border-warning/40",
  running: "bg-info/15 text-info border-info/40",
  queued:  "bg-muted/15 text-muted-foreground border-border",
};

const STEP_STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle2, failure: XCircle, stubbed: AlertTriangle, skipped: Clock,
};

interface Props { packId: string; refreshKey?: number }

export default function RunLogPanel({ packId, refreshKey }: Props) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [logsById, setLogsById] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/runs?limit=30`);
      const data = await r.json();
      if (!r.ok) { setError(data.error || "load failed"); return; }
      setRows(data.items || []);
    } catch (err: any) {
      setError(err?.message || "load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId, refreshKey]);

  const toggle = async (runId: string) => {
    const next = new Set(expanded);
    if (next.has(runId)) next.delete(runId);
    else {
      next.add(runId);
      if (!logsById[runId]) {
        try {
          const r = await fetch(`/api/enterprise-use-cases/${packId}/runs/${runId}`);
          if (r.ok) {
            const detail = await r.json();
            setLogsById((m) => ({ ...m, [runId]: detail.logs || "" }));
          }
        } catch {}
      }
    }
    setExpanded(next);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Run history</h3>
        <span className="text-[10px] text-muted-foreground">{rows.length} run(s)</span>
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <Activity className="h-7 w-7 mx-auto mb-2 text-accent opacity-70" />
          <h3 className="text-sm font-semibold text-foreground">No runs yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Click <span className="font-mono">Run scenario</span> above to execute a scenario against an environment.
            Runs show per-step results, merged logs, and (in <span className="font-mono">simulate-and-validate</span>) detection coverage.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isOpen = expanded.has(r.id);
            const hasStubs = r.stepResults.some((s) => s.status === "stubbed");
            const allStubs = r.stepResults.length > 0 && r.stepResults.every((s) => s.status === "stubbed");
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-3 py-2.5 flex items-start gap-2">
                  <button onClick={() => toggle(r.id)} className="mt-0.5">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", STATUS_STYLE[r.status] || STATUS_STYLE.queued)}>
                        {r.status}
                      </span>
                      <CoverageBadge outcome={r.validationOutcome as CoverageOutcome} mode={r.mode as any} />
                      {allStubs && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border border-warning/40 bg-warning/10 text-warning">[STUB]</span>}
                      <span className="text-[10px] text-muted-foreground font-mono">{r.environmentName || r.environmentId?.slice(0, 8)} · {r.environmentKind}</span>
                      <span className="text-[10px] text-muted-foreground">mode: <span className="font-mono">{r.mode}</span></span>
                      <span className="text-[10px] text-muted-foreground">logic: <span className="font-mono text-accent">{r.testedLogicChoice}</span></span>
                      <span className="text-[10px] text-muted-foreground">{r.durationMs} ms</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.stepResults.length} step(s) · started {r.startedAt ? new Date(r.startedAt).toLocaleString() : "?"}
                      {r.actor && <> · by <span className="font-mono">{r.actor}</span></>}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border p-3 space-y-3 bg-background/30">
                    {/* Per-step results */}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Step results</div>
                      <div className="space-y-1">
                        {r.stepResults.length === 0 ? (
                          <div className="text-[11px] italic text-muted-foreground">No steps executed.</div>
                        ) : r.stepResults.map((s) => {
                          const FwIcon = FRAMEWORK_ICON[s.framework] || Terminal;
                          const StIcon = STEP_STATUS_ICON[s.status] || Clock;
                          const stColor = s.status === "ok" ? "text-success" : s.status === "failure" ? "text-danger" : s.status === "stubbed" ? "text-warning" : "text-muted-foreground";
                          return (
                            <details key={s.stepIndex} className="rounded border border-border bg-card">
                              <summary className="px-2 py-1.5 cursor-pointer flex items-center gap-2 text-[11px]">
                                <FwIcon className="h-3 w-3 text-muted-foreground" />
                                <span className="font-mono text-[10px] text-muted-foreground">{String(s.stepIndex + 1).padStart(2, "0")}</span>
                                <StIcon className={cn("h-3 w-3", stColor)} />
                                <span className={cn("uppercase font-bold text-[9px]", stColor)}>{s.status}</span>
                                <span className="text-foreground truncate flex-1">{s.displayName}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{s.durationMs}ms exit={s.exitCode}</span>
                              </summary>
                              {(s.stdoutPreview || s.notes) && (
                                <div className="border-t border-border px-2 py-1.5 text-[10px] font-mono space-y-1">
                                  {s.notes && <div className="text-warning">{s.notes}</div>}
                                  {s.stdoutPreview && (
                                    <pre className="text-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{s.stdoutPreview}</pre>
                                  )}
                                </div>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    </div>

                    {/* Detection coverage */}
                    {r.detectionResults.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">Detection coverage</div>
                        {r.detectionResults.map((d, i) => (
                          <div key={i} className="rounded border border-border bg-card px-2 py-1.5 text-[11px] space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {d.fired ? <CheckCircle2 className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-danger" />}
                              <span className="font-semibold text-foreground">{d.ruleTitle}</span>
                              {d.siemBackend && <span className="font-mono text-[10px] text-muted-foreground">{d.siemBackend}</span>}
                              {d.integrationName && <span className="font-mono text-[10px] text-muted-foreground">via {d.integrationName}</span>}
                            </div>
                            {d.evidence && <div className="text-foreground">{d.evidence}</div>}
                            {d.error && <div className="text-danger">⚠ {d.error}</div>}
                            {d.query && (
                              <details>
                                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">Query</summary>
                                <pre className="mt-1 text-[10px] font-mono text-foreground whitespace-pre-wrap break-words max-h-32 overflow-y-auto bg-background/60 p-1 rounded">{d.query}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Merged logs */}
                    {(logsById[r.id] || r.hasLogs) && (
                      <details>
                        <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          <FileText className="h-3 w-3" /> Merged logs
                        </summary>
                        <pre className="mt-1 text-[10px] font-mono text-foreground whitespace-pre-wrap break-words max-h-96 overflow-y-auto bg-background/60 p-2 rounded border border-border">
{logsById[r.id] || "(loading)"}
                        </pre>
                      </details>
                    )}
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
