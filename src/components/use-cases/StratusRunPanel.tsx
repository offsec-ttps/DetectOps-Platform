"use client";

import { useEffect, useState } from "react";
import {
  Cloud, Loader2, Play, ShieldAlert, X, CheckCircle2, AlertTriangle, FlaskConical, KeyRound,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  kind: string;
  refId: string;
  techniqueId: string;
  displayName: string;
}

interface Credential {
  id: string;
  provider: string;
  label: string;
}

interface ExecutionRow {
  id: string;
  attackId: string;
  phase: string;
  status: string;
  exitCode: number | null;
  durationMs: number;
  logs: string;
}

const PHASE_HELP: Record<string, string> = {
  "dry-run": "Safe — prints what would run without spawning the binary or contacting any cloud.",
  warmup: "Provisions the prerequisites in your cloud account. Reversible via cleanup.",
  detonate: "DESTRUCTIVE — executes the technique against your live cloud account.",
  cleanup: "Tears down whatever warmup provisioned.",
};

export default function StratusRunPanel({ useCaseId, steps }: { useCaseId: string; steps: Step[] }) {
  const stratusSteps = steps.filter((s) => s.kind === "stratus");
  const [creds, setCreds] = useState<Credential[]>([]);
  const [stratusInfo, setStratusInfo] = useState<{ found: boolean; version: string | null; binary: string; installHint: string | null } | null>(null);
  const [selectedStep, setSelectedStep] = useState<string>("");
  const [selectedCred, setSelectedCred] = useState<string>("");
  const [phase, setPhase] = useState<"dry-run" | "warmup" | "detonate" | "cleanup">("dry-run");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExecutionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (stratusSteps.length === 0) return;
    Promise.all([
      fetch("/api/cloud-credentials").then((r) => r.json()).catch(() => ({})),
      fetch("/api/stratus/execute").then((r) => r.json()).catch(() => ({})),
    ]).then(([credData, statusData]) => {
      setCreds(credData.items || []);
      setStratusInfo({
        found: !!statusData.found,
        version: statusData.version,
        binary: statusData.binary,
        installHint: statusData.installHint,
      });
    });
    if (stratusSteps[0]) setSelectedStep(stratusSteps[0].id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [useCaseId]);

  if (stratusSteps.length === 0) return null;

  const stepRow = stratusSteps.find((s) => s.id === selectedStep) || stratusSteps[0];
  const isDetonate = phase === "detonate";
  const needsCred = phase !== "dry-run";

  const run = async () => {
    if (!stepRow) return;
    if (isDetonate && !confirm(`Detonate ${stepRow.refId || stepRow.techniqueId} against your live cloud account?`)) return;
    setBusy(true); setResult(null); setError(null);
    try {
      const res = await fetch("/api/stratus/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useCaseId,
          stepId: stepRow.id,
          attackId: stepRow.refId || stepRow.techniqueId,
          phase,
          credentialId: needsCred ? (selectedCred || undefined) : undefined,
          confirmDetonate: isDetonate ? true : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Execution failed"); return; }
      setResult(data.execution);
    } catch (err: any) {
      setError(err?.message || "Execution failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Cloud className="h-4 w-4 text-info" />
        <h2 className="text-sm font-semibold text-foreground">Run Stratus</h2>
        {stratusInfo && (
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded font-mono ml-2",
            stratusInfo.found ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}>
            {stratusInfo.found ? `binary ${stratusInfo.version || "OK"}` : "binary not found"}
          </span>
        )}
      </div>
      <div className="p-4 space-y-3">
        {stratusInfo && !stratusInfo.found && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{stratusInfo.installHint || "Stratus CLI not installed. Dry-run will still work."}</span>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3 text-xs">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Stratus step</span>
            <select value={selectedStep} onChange={(e) => setSelectedStep(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
              {stratusSteps.map((s) => (
                <option key={s.id} value={s.id}>{s.refId || s.techniqueId} — {s.displayName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value as any)}
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
              <option value="dry-run">dry-run (safe)</option>
              <option value="warmup">warmup</option>
              <option value="detonate">detonate (DESTRUCTIVE)</option>
              <option value="cleanup">cleanup</option>
            </select>
          </label>
          {needsCred && (
            <label className="block md:col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Credential</span>
              {creds.length === 0 ? (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <KeyRound className="h-3 w-3" />
                  No credentials saved.
                  <Link href="/settings/cloud-credentials" className="text-accent hover:text-[#60a5fa]">Add one →</Link>
                </div>
              ) : (
                <select value={selectedCred} onChange={(e) => setSelectedCred(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                  <option value="">— pick a credential —</option>
                  {creds.map((c) => (
                    <option key={c.id} value={c.id}>{c.provider.toUpperCase()} · {c.label}</option>
                  ))}
                </select>
              )}
            </label>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{PHASE_HELP[phase]}</p>

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
          </div>
        )}

        {result && (
          <div className="rounded-md border border-border bg-background/50 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                result.status === "success" ? "bg-success/15 text-success" :
                result.status === "failure" ? "bg-danger/15 text-danger" :
                result.status === "timeout" ? "bg-warning/15 text-warning" :
                "bg-muted/15 text-muted-foreground",
              )}>
                {result.status}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {result.phase} · exit {result.exitCode ?? "?"} · {(result.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <pre className="text-[10px] font-mono text-emerald-300 bg-[#0d1117] p-2 rounded max-h-[280px] overflow-auto whitespace-pre-wrap">
              {result.logs || "(no output)"}
            </pre>
          </div>
        )}

        <button
          onClick={run}
          disabled={busy || (needsCred && creds.length === 0)}
          className={cn(
            "inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md transition-colors",
            isDetonate
              ? "bg-danger text-white hover:bg-danger/90"
              : "bg-accent text-white hover:bg-[#60a5fa]",
            "disabled:opacity-50",
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> :
           isDetonate ? <ShieldAlert className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isDetonate ? "Detonate" : `Run ${phase}`}
        </button>
      </div>
    </div>
  );
}
