"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Plus, Loader2, X, Play, Download, Trash2, StopCircle, ShieldCheck,
  Target, Eye, EyeOff, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileText,
} from "lucide-react";

// ── Types ──
interface Assessment {
  id: string; name: string; assessor: string; client: string; lab: string; status: string;
  atomicsTotal: number; processed: number; executedCount: number; visibleCount: number;
  genericCount: number; absentCount: number; naCount: number; failedCount: number;
  // Nested by report type: { executive:{md,docx,pdf}, technical:{md,docx,pdf} }
  // (older rows may still be flat {md,docx,pdf} = technical).
  reportPaths: Record<string, any>; error?: string | null; createdAt: string; completedAt?: string | null;
}
interface Options {
  environments: { id: string; name: string; kind: string; shellMode: string; hostname: string }[];
  siemConnections: { id: string; name: string; kind: string; isDefault: boolean }[];
  libraries: { moduleId: string; label: string; techniqueCount: number }[];
}
interface Metrics {
  total: number; runnable: number; executed: number; visible: number; generic: number; absent: number; na: number; failed: number;
  visibilityPct: number;
  byTactic: Array<{ key: string; atomics: number; executed: number; visible: number; generic: number; absent: number; pct: number }>;
  byLibrary: Array<{ key: string; atomics: number; executed: number; visible: number; generic: number; absent: number; pct: number }>;
  blindSpots: Array<{ tech: string; num: number; name: string; tactic: string; library: string; indicators: string[] }>;
}

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted/10 text-muted", running: "bg-accent/10 text-accent",
  rendering: "bg-warning/10 text-warning", completed: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger", cancelled: "bg-muted/10 text-muted",
};
const ACTIVE = (s: string) => s === "queued" || s === "running" || s === "rendering";

export default function CoverageAssessmentTab() {
  const [list, setList] = useState<Assessment[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, { metrics: Metrics | null; reportMd: string }>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [form, setForm] = useState({
    name: "", assessor: "RuSecure", client: "", lab: "", environmentId: "", siemConnectionId: "",
    scopeMode: "libraries" as "full" | "libraries" | "techniques",
    libraries: [] as string[], techniques: "", detectionNote: "",
  });

  const fetchList = useCallback(async () => {
    try {
      const r = await fetch("/api/coverage-assessments");
      if (r.ok) { const d = await r.json(); setList(d.items || []); }
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  const fetchOptions = useCallback(async () => {
    try {
      const r = await fetch("/api/coverage-assessments/options");
      if (r.ok) setOptions(await r.json());
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchList(); fetchOptions(); }, [fetchList, fetchOptions]);

  // Poll while anything is active.
  useEffect(() => {
    const anyActive = list.some((a) => ACTIVE(a.status));
    if (anyActive && !pollRef.current) {
      pollRef.current = setInterval(fetchList, 4000);
    } else if (!anyActive && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => { if (pollRef.current && !list.some((a) => ACTIVE(a.status))) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [list, fetchList]);

  const loadDetail = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    try {
      const r = await fetch(`/api/coverage-assessments/${id}`);
      if (r.ok) { const d = await r.json(); setDetail((p) => ({ ...p, [id]: { metrics: d.metrics, reportMd: d.reportMd || "" } })); }
    } catch { /* */ }
  };

  const create = async () => {
    if (!form.name || !form.environmentId) return;
    setCreating(true);
    try {
      const scope: any = { mode: form.scopeMode };
      if (form.scopeMode === "libraries") scope.libraries = form.libraries;
      if (form.scopeMode === "techniques") scope.techniques = form.techniques.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      const r = await fetch("/api/coverage-assessments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name, assessor: form.assessor, client: form.client, lab: form.lab,
          environmentId: form.environmentId, siemConnectionId: form.siemConnectionId || undefined,
          scope, detectionNote: form.detectionNote,
        }),
      });
      if (r.ok) {
        setShowForm(false);
        setForm((f) => ({ ...f, name: "", techniques: "", detectionNote: "" }));
        await fetchList();
      } else {
        const e = await r.json().catch(() => ({}));
        alert(`Could not start assessment: ${e.error || r.status}`);
      }
    } finally { setCreating(false); }
  };

  const cancel = async (id: string) => { await fetch(`/api/coverage-assessments/${id}/cancel`, { method: "POST" }); fetchList(); };
  const remove = async (id: string) => { await fetch(`/api/coverage-assessments/${id}`, { method: "DELETE" }); fetchList(); };

  const toggleLib = (id: string) =>
    setForm((f) => ({ ...f, libraries: f.libraries.includes(id) ? f.libraries.filter((x) => x !== id) : [...f.libraries, id] }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Run the Atomic Red Team library against an environment; the platform detonates each atomic over the
          configured transport and measures whether its activity is <strong>visible in the SIEM</strong> (the
          prerequisite for detection). Destructive and credential-dumping atomics are excluded automatically.
          Results render to a branded Markdown / DOCX / PDF report.
        </p>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors shrink-0">
          <Plus className="h-4 w-4" /> New Assessment
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <Target className="h-10 w-10 text-muted mb-3" />
          <h3 className="text-lg font-semibold text-foreground">No Coverage Assessments Yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">Start an assessment to sweep the ATT&CK library against a lab and generate a coverage report.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((a) => {
            const isExp = expandedId === a.id;
            const pct = a.atomicsTotal ? Math.round((100 * a.processed) / a.atomicsTotal) : 0;
            const d = detail[a.id];
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => loadDetail(a.id)} className="text-muted hover:text-foreground shrink-0">
                    {isExp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                      <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize", STATUS_COLORS[a.status])}>{a.status}</span>
                      {a.client && <span className="text-[10px] text-muted-foreground">{a.client}</span>}
                      {a.lab && <span className="text-[10px] text-muted-foreground">· {a.lab}</span>}
                    </div>
                    {/* progress */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 max-w-xs rounded-full bg-border overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", a.status === "failed" ? "bg-danger" : a.status === "completed" ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{a.processed}/{a.atomicsTotal}</span>
                      {ACTIVE(a.status) && <Loader2 className="h-3 w-3 animate-spin text-accent" />}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-0.5"><Play className="h-2.5 w-2.5" /> exec {a.executedCount}</span>
                      <span className="flex items-center gap-0.5 text-success"><Eye className="h-2.5 w-2.5" /> visible {a.visibleCount}</span>
                      <span className="flex items-center gap-0.5"><EyeOff className="h-2.5 w-2.5" /> indeterminate {a.genericCount}</span>
                      <span className="flex items-center gap-0.5 text-warning"><AlertTriangle className="h-2.5 w-2.5" /> blind {a.absentCount}</span>
                      <span>n/a {a.naCount}</span>
                      {a.failedCount > 0 && <span className="text-danger">failed {a.failedCount}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.status === "completed" && (["executive", "technical"] as const).map((rtype) => {
                      const set = a.reportPaths?.[rtype] || (rtype === "technical" ? a.reportPaths : null);
                      const fmts = (["md", "docx", "pdf"] as const).filter((f) => set?.[f]);
                      if (!fmts.length) return null;
                      return (
                        <div key={rtype} className="flex items-center gap-1">
                          <span className="text-[9px] font-semibold text-muted uppercase">{rtype === "executive" ? "Exec" : "Tech"}</span>
                          {fmts.map((fmt) => (
                            <a key={fmt} href={`/api/coverage-assessments/${a.id}/download?format=${fmt}&type=${rtype}`}
                              title={`${rtype === "executive" ? "Executive Summary" : "Technical report"} — ${fmt.toUpperCase()}`}
                              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors uppercase">
                              <Download className="h-3 w-3" /> {fmt}
                            </a>
                          ))}
                        </div>
                      );
                    })}
                    {ACTIVE(a.status) && (
                      <button onClick={() => cancel(a.id)} title="Cancel" className="rounded p-1.5 text-muted hover:text-danger hover:bg-danger/10 transition-colors"><StopCircle className="h-3.5 w-3.5" /></button>
                    )}
                    {!ACTIVE(a.status) && (
                      <button onClick={() => remove(a.id)} title="Delete" className="rounded p-1.5 text-muted hover:text-danger hover:bg-danger/10 transition-colors"><Trash2 className="h-3 w-3" /></button>
                    )}
                  </div>
                </div>

                {isExp && (
                  <div className="border-t border-border bg-background px-4 py-4 space-y-4">
                    {a.error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{a.error}</div>}
                    {!d ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> loading…</div>
                    ) : d.metrics ? (
                      <MetricsView m={d.metrics} />
                    ) : (
                      <p className="text-xs text-muted-foreground">No metrics yet — the sweep is still running.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && options && (
        <NewAssessmentModal
          options={options} form={form} setForm={setForm} toggleLib={toggleLib}
          creating={creating} onClose={() => setShowForm(false)} onCreate={create}
        />
      )}
    </div>
  );
}

function MetricsView({ m }: { m: Metrics }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Executed" value={`${m.executed}/${m.runnable}`} sub="on endpoint" color="text-foreground" />
        <Stat label="Telemetry-visible" value={`${m.visibilityPct}%`} sub={`${m.visible}/${m.visible + m.absent} distinctive`} color="text-success" />
        <Stat label="Indeterminate" value={String(m.generic)} sub="generic shell only" color="text-muted-foreground" />
        <Stat label="Blind spots" value={String(m.absent)} sub="ran, no log" color="text-warning" />
      </div>
      <Table title="By ATT&CK tactic" rows={m.byTactic} />
      <Table title="By library" rows={m.byLibrary} />
      {m.blindSpots.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted uppercase mb-1">Telemetry blind spots</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-card"><tr className="text-left text-muted"><th className="px-2 py-1">Technique</th><th className="px-2 py-1">Atomic</th><th className="px-2 py-1">Indicator</th></tr></thead>
              <tbody>
                {m.blindSpots.slice(0, 15).map((b, i) => (
                  <tr key={i} className="border-t border-border"><td className="px-2 py-1 font-mono text-foreground">{b.tech}</td><td className="px-2 py-1 text-muted-foreground">{b.name}</td><td className="px-2 py-1 font-mono text-muted-foreground">{(b.indicators || []).slice(0, 2).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: Metrics["byTactic"] }) {
  if (!rows?.length) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted uppercase mb-1">{title}</p>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-card"><tr className="text-left text-muted"><th className="px-2 py-1">Name</th><th className="px-2 py-1 text-right">Atomics</th><th className="px-2 py-1 text-right">Exec</th><th className="px-2 py-1 text-right">Visible</th><th className="px-2 py-1 text-right">Indet.</th><th className="px-2 py-1 text-right">Blind</th><th className="px-2 py-1 text-right">Vis%</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-2 py-1 text-foreground">{r.key}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.atomics}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.executed}</td>
                <td className="px-2 py-1 text-right tabular-nums text-success">{r.visible}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.generic}</td>
                <td className="px-2 py-1 text-right tabular-nums text-warning">{r.absent}</td>
                <td className="px-2 py-1 text-right tabular-nums font-semibold">{r.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[9px] font-semibold text-muted uppercase">{label}</p>
      <p className={cn("text-xl font-bold mt-0.5", color)}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function NewAssessmentModal({ options, form, setForm, toggleLib, creating, onClose, onCreate }: {
  options: Options; form: any; setForm: any; toggleLib: (id: string) => void;
  creating: boolean; onClose: () => void; onCreate: () => void;
}) {
  const envs = options.environments.filter((e) => e.kind === "our-template-deployed" && e.shellMode === "winrm");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-12 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg m-4">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> New Coverage Assessment</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assessment name *" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} placeholder="Q4 ATT&CK coverage" />
            <Field label="Client" value={form.client} onChange={(v: string) => setForm({ ...form, client: v })} placeholder="UnicornSecrets" />
            <Field label="Assessor" value={form.assessor} onChange={(v: string) => setForm({ ...form, assessor: v })} />
            <Field label="Lab label (report)" value={form.lab} onChange={(v: string) => setForm({ ...form, lab: v })} placeholder="Splunk SAR" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted uppercase">Environment *</label>
              <select value={form.environmentId} onChange={(e) => setForm({ ...form, environmentId: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-input-focus focus:outline-none">
                <option value="">Select a WinRM endpoint…</option>
                {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.hostname})</option>)}
              </select>
              {envs.length === 0 && <p className="text-[9px] text-warning">No WinRM environments configured.</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-muted uppercase">SIEM connection</label>
              <select value={form.siemConnectionId} onChange={(e) => setForm({ ...form, siemConnectionId: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-input-focus focus:outline-none">
                <option value="">None (execution only)</option>
                {options.siemConnections.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
              </select>
            </div>
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-muted uppercase">Scope</label>
            <div className="flex gap-2">
              {(["libraries", "techniques", "full"] as const).map((m) => (
                <button key={m} onClick={() => setForm({ ...form, scopeMode: m })}
                  className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    form.scopeMode === m ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-card-hover")}>
                  {m === "full" ? "Full library" : m}
                </button>
              ))}
            </div>
            {form.scopeMode === "libraries" && (
              <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {options.libraries.map((l) => (
                  <label key={l.moduleId} className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={form.libraries.includes(l.moduleId)} onChange={() => toggleLib(l.moduleId)} className="h-3 w-3" />
                    <span className="truncate">{l.label}</span><span className="text-muted">({l.techniqueCount})</span>
                  </label>
                ))}
              </div>
            )}
            {form.scopeMode === "techniques" && (
              <textarea value={form.techniques} onChange={(e) => setForm({ ...form, techniques: e.target.value })}
                placeholder="T1082, T1016, T1059.001 …" rows={2}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
            )}
            {form.scopeMode === "full" && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> Full library can take ~2 hours. Credential-dumping and destructive atomics are excluded automatically.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-muted uppercase">Detection measurement note (optional)</label>
            <textarea value={form.detectionNote} onChange={(e) => setForm({ ...form, detectionNote: e.target.value })}
              placeholder="Results of a tuned-rule sample, Sysmon config notes, etc. — appears in the report's Detection section." rows={3}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
          <button onClick={onCreate} disabled={creating || !form.name || !form.environmentId}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted uppercase">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
    </div>
  );
}
